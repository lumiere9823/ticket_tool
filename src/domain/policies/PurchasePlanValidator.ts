import { PurchasePlan, TicketOption, PurchasePlanValidationResult } from '../entities/PurchasePlan';

/**
 * PurchasePlanValidator
 *
 * Validates a PurchasePlan against the currently-discovered TicketCatalog.
 * Does NOT modify DOM, perform network calls, or mutate state.
 *
 * Invariants checked:
 * 1. At least one TicketRule must exist.
 * 2. Each TicketRule.ticketId must be found in the catalog.
 * 3. Each quantity must be within [minQuantity, maxQuantity].
 * 4. At least one rule must reference an AVAILABLE, selectable ticket.
 * 5. If allowFallback=false, the top-priority ticket must be available.
 *
 * Conforms to: AI Engineering Rules 02, 05, 10 and docs/ticketbox/04-state-machine.md.
 */
export class PurchasePlanValidator {
  /**
   * Validates a PurchasePlan against a discovered ticket catalog.
   */
  public static validate(
    plan: PurchasePlan,
    catalogTickets: TicketOption[]
  ): PurchasePlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const invalidRuleIndices: number[] = [];
    const unavailableRuleIndices: number[] = [];
    const outOfRangeRuleIndices: number[] = [];

    // Rule: at least one ticket rule must exist
    if (plan.ticketRules.length === 0) {
      errors.push('At least one ticket rule is required.');
      return {
        valid: false,
        errors,
        warnings,
        invalidRuleIndices,
        unavailableRuleIndices,
        outOfRangeRuleIndices,
        hasActionableRule: false,
      };
    }

    // Index the catalog for O(1) lookups
    const catalogById = new Map<string, TicketOption>();
    for (const ticket of catalogTickets) {
      if (ticket.id) {
        catalogById.set(ticket.id, ticket);
      }
    }

    let hasActionableRule = false;

    for (let i = 0; i < plan.ticketRules.length; i++) {
      const rule = plan.ticketRules[i]!;

      // 1. TicketID must exist in catalog
      const catalogEntry = rule.ticketId ? catalogById.get(rule.ticketId) : undefined;
      if (!catalogEntry) {
        // Also try by name for catalogs that returned null IDs
        const byName = catalogTickets.find((t) => t.name === rule.ticketName);
        if (!byName) {
          errors.push(`Rule ${i + 1}: Ticket "${rule.ticketName}" not found in current catalog.`);
          invalidRuleIndices.push(i);
          continue;
        }
        // Found by name; warn but continue
        warnings.push(
          `Rule ${i + 1}: Ticket "${rule.ticketName}" matched by name (no stable ID). May be unreliable if page changes.`
        );
      }

      const ticket = catalogEntry ?? catalogTickets.find((t) => t.name === rule.ticketName)!;

      // 2. Quantity range validation
      const min = ticket.minQuantity ?? 1;
      const max = ticket.maxQuantity ?? 10; // conservative default
      if (rule.quantity < min || rule.quantity > max) {
        errors.push(
          `Rule ${i + 1}: Quantity ${rule.quantity} is outside allowed range [${min}, ${max}] for "${ticket.name}".`
        );
        outOfRangeRuleIndices.push(i);
        continue;
      }

      // 3. Availability check
      if (ticket.availability !== 'AVAILABLE' || !ticket.selectable) {
        if (i === 0 && !plan.allowFallback) {
          errors.push(
            `Top-priority ticket "${ticket.name}" is ${ticket.availability} and fallback is disabled.`
          );
        } else {
          warnings.push(
            `Rule ${i + 1}: Ticket "${ticket.name}" is currently ${ticket.availability}.`
          );
        }
        unavailableRuleIndices.push(i);
      } else {
        hasActionableRule = true;
      }
    }

    // 4. Fallback policy consistency
    if (!plan.allowFallback && plan.fallbackPolicy !== 'STOP_AND_NOTIFY') {
      warnings.push(
        'allowFallback is false but fallbackPolicy is not STOP_AND_NOTIFY. ' +
          'STOP_AND_NOTIFY will be used.'
      );
    }

    // 5. Execution limits validation (if specified)
    if (plan.limits) {
      if (plan.limits.maxDurationMinutes !== undefined) {
        if (
          typeof plan.limits.maxDurationMinutes !== 'number' ||
          isNaN(plan.limits.maxDurationMinutes) ||
          plan.limits.maxDurationMinutes <= 0
        ) {
          errors.push('maxDurationMinutes must be greater than 0.');
        } else if (plan.limits.maxDurationMinutes > 240) {
          errors.push(
            `maxDurationMinutes (${plan.limits.maxDurationMinutes}) exceeds maximum ceiling of 240.`
          );
        }
      }

      if (plan.limits.maxAttempts !== undefined) {
        if (
          typeof plan.limits.maxAttempts !== 'number' ||
          isNaN(plan.limits.maxAttempts) ||
          plan.limits.maxAttempts <= 0
        ) {
          errors.push('maxAttempts must be greater than 0.');
        } else if (plan.limits.maxAttempts > 5000) {
          errors.push(`maxAttempts (${plan.limits.maxAttempts}) exceeds maximum ceiling of 5000.`);
        }
      }
    }

    const valid = errors.length === 0;
    return {
      valid,
      errors,
      warnings,
      invalidRuleIndices,
      unavailableRuleIndices,
      outOfRangeRuleIndices,
      hasActionableRule,
    };
  }

  /**
   * Checks if the PurchasePlan is structurally ready to ARM (has at least one rule
   * with a valid ticketId and a valid quantity, regardless of availability).
   */
  public static isReadyToArm(plan: PurchasePlan): boolean {
    return (
      plan.ticketRules.length > 0 &&
      plan.ticketRules.every((r) => r.ticketId.length > 0 && r.quantity >= 1)
    );
  }

  /**
   * Evaluates the plan at runtime against current catalog tickets.
   * Returns the first TicketRule that has an available, selectable ticket,
   * respecting priority order and fallback policy.
   */
  public static selectBestRule(
    plan: PurchasePlan,
    catalogTickets: TicketOption[]
  ): { rule: (typeof plan.ticketRules)[number]; ticket: TicketOption; isFallback: boolean } | null {
    if (plan.ticketRules.length === 0) return null;

    const catalogById = new Map<string, TicketOption>();
    const catalogByName = new Map<string, TicketOption>();
    for (const ticket of catalogTickets) {
      if (ticket.id) catalogById.set(ticket.id, ticket);
      catalogByName.set(ticket.name, ticket);
    }

    for (let i = 0; i < plan.ticketRules.length; i++) {
      const rule = plan.ticketRules[i]!;
      const ticket = catalogById.get(rule.ticketId) ?? catalogByName.get(rule.ticketName);
      if (!ticket) continue;

      if (ticket.availability === 'AVAILABLE' && ticket.selectable) {
        const min = ticket.minQuantity ?? 1;
        const max = ticket.maxQuantity ?? 10;
        if (rule.quantity >= min && rule.quantity <= max) {
          const isFallback = i > 0;
          if (isFallback && !plan.allowFallback) {
            return null; // Fallback disabled — do not select
          }
          return { rule, ticket, isFallback };
        }
      }
    }

    // No priority matched; apply global fallback
    if (plan.allowFallback && plan.fallbackPolicy === 'ANY_AVAILABLE') {
      const anyTicket = catalogTickets.find((t) => t.availability === 'AVAILABLE' && t.selectable);
      if (anyTicket) {
        const qty = Math.max(anyTicket.minQuantity ?? 1, 1);
        const rule = plan.ticketRules[0]!;
        return {
          rule: { ...rule, ticketId: anyTicket.id ?? '', quantity: qty },
          ticket: anyTicket,
          isFallback: true,
        };
      }
    }

    return null;
  }
}
