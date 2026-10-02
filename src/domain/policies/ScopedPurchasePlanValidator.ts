import { ScopedPurchasePlan, MIN_POLL_INTERVAL_MS } from '../entities/ScopedPurchasePlan';
import { EventCatalog } from '../entities/EventCatalog';
import { TicketCatalogSnapshot } from '../entities/PurchasePlan';

export interface ScopedPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a ScopedPurchasePlan against business rules and optional discovered catalog.
 * Zero Chrome or DOM dependencies.
 *
 * Rules:
 * - BR-S02: Whitelist cannot be empty (targets and ticketTypeIds must not be empty).
 * - BR-S03: pollIntervalMs >= 1500ms; maxDurationMinutes > 0; maxAttempts > 0.
 * - Ranks must be unique across targets.
 * - Quantity must be > 0.
 * - BR-S07 & AC-11: Quantity <= maxQtyPerOrder of each ticket type and <= attendeeCount (if declared).
 * - Showing and ticket IDs must exist in catalog if catalog is provided.
 */
export class ScopedPurchasePlanValidator {
  public static validate(
    plan: ScopedPurchasePlan,
    catalog?: EventCatalog | TicketCatalogSnapshot | null,
    attendeeCount?: number | null
  ): ScopedPlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Whitelist empty check (BR-S02, AC-09)
    if (!plan.targets || plan.targets.length === 0) {
      errors.push('Whitelist is empty: At least one scoped target is required.');
    } else {
      const totalTickets = plan.targets.reduce((sum, t) => sum + (t.ticketTypeIds?.length ?? 0), 0);
      if (totalTickets === 0) {
        errors.push('Whitelist is empty: At least one ticket type must be selected.');
      }
    }

    // 2. Quantity validation
    if (!plan.quantity || plan.quantity <= 0) {
      errors.push('Quantity must be greater than 0.');
    }

    // 3. Attendee count check (BR-S07)
    if (attendeeCount !== undefined && attendeeCount !== null && attendeeCount > 0) {
      if (plan.quantity > attendeeCount) {
        errors.push(
          `Quantity (${plan.quantity}) exceeds declared attendee count (${attendeeCount}).`
        );
      }
    }

    // 4. Persistence policy validation (BR-S03)
    if (!plan.persistence) {
      errors.push('Persistence policy is missing.');
    } else {
      if (
        typeof plan.persistence.pollIntervalMs !== 'number' ||
        isNaN(plan.persistence.pollIntervalMs) ||
        plan.persistence.pollIntervalMs < MIN_POLL_INTERVAL_MS
      ) {
        errors.push(
          `pollIntervalMs (${plan.persistence.pollIntervalMs}ms) is below the minimum allowed floor of ${MIN_POLL_INTERVAL_MS}ms.`
        );
      }
      if (
        typeof plan.persistence.maxDurationMinutes !== 'number' ||
        isNaN(plan.persistence.maxDurationMinutes) ||
        plan.persistence.maxDurationMinutes <= 0
      ) {
        errors.push('maxDurationMinutes must be greater than 0.');
      } else if (plan.persistence.maxDurationMinutes > 240) {
        errors.push(
          `maxDurationMinutes (${plan.persistence.maxDurationMinutes}) exceeds maximum ceiling of 240.`
        );
      }

      if (
        typeof plan.persistence.maxAttempts !== 'number' ||
        isNaN(plan.persistence.maxAttempts) ||
        plan.persistence.maxAttempts <= 0
      ) {
        errors.push('maxAttempts must be greater than 0.');
      } else if (plan.persistence.maxAttempts > 5000) {
        errors.push(
          `maxAttempts (${plan.persistence.maxAttempts}) exceeds maximum ceiling of 5000.`
        );
      }
      if (
        typeof plan.persistence.jitterRatio !== 'number' ||
        isNaN(plan.persistence.jitterRatio) ||
        plan.persistence.jitterRatio < 0 ||
        plan.persistence.jitterRatio > 1
      ) {
        errors.push('jitterRatio must be between 0 and 1.');
      }
      if (plan.persistence.stopAt) {
        const stopTime = Date.parse(plan.persistence.stopAt);
        if (isNaN(stopTime)) {
          errors.push(`Invalid stopAt timestamp: '${plan.persistence.stopAt}'.`);
        } else if (stopTime <= Date.now()) {
          warnings.push(`stopAt timestamp '${plan.persistence.stopAt}' is in the past.`);
        }
      }
    }

    // 5. Rank uniqueness check
    if (plan.targets && plan.targets.length > 0) {
      const seenRanks = new Set<number>();
      for (const target of plan.targets) {
        if (typeof target.rank !== 'number' || target.rank < 1) {
          errors.push(`Target rank must be a positive integer (found ${target.rank}).`);
        } else if (seenRanks.has(target.rank)) {
          errors.push(`Duplicate rank ${target.rank} detected across scoped targets.`);
        } else {
          seenRanks.add(target.rank);
        }
      }
    }

    // 6. Cross-reference with Catalog when available (AC-11 & target existence)
    if (catalog && plan.targets && plan.targets.length > 0) {
      // Normalize showings from EventCatalog or TicketCatalogSnapshot
      const catalogShowings = this.normalizeCatalogShowings(catalog);

      const showingMap = new Map<
        string,
        {
          id: string;
          name?: string | null | undefined;
          tickets: Map<
            string,
            {
              id: string | null;
              name: string;
              maxQuantity: number | null;
              minQuantity: number | null;
            }
          >;
        }
      >();

      for (const s of catalogShowings) {
        if (!s.id) continue;
        const ticketMap = new Map<
          string,
          {
            id: string | null;
            name: string;
            maxQuantity: number | null;
            minQuantity: number | null;
          }
        >();
        for (const t of s.tickets) {
          if (t.id) ticketMap.set(t.id, t);
          ticketMap.set(t.name, t);
        }
        showingMap.set(s.id, { id: s.id, name: s.name, tickets: ticketMap });
      }

      for (let tIdx = 0; tIdx < plan.targets.length; tIdx++) {
        const target = plan.targets[tIdx]!;
        const showingEntry = showingMap.get(target.showingId);

        if (!showingEntry) {
          errors.push(
            `Target ${tIdx + 1}: Showing '${target.showingId}' does not exist in the current event catalog.`
          );
          continue;
        }

        for (const ticketTypeId of target.ticketTypeIds) {
          const ticketEntry = showingEntry.tickets.get(ticketTypeId);
          if (!ticketEntry) {
            errors.push(
              `Target ${tIdx + 1}: Ticket type '${ticketTypeId}' does not exist in showing '${target.showingId}'.`
            );
            continue;
          }

          // AC-11: qty exceeds maxQtyPerOrder (maxQuantity)
          if (ticketEntry.maxQuantity !== null && plan.quantity > ticketEntry.maxQuantity) {
            errors.push(
              `Quantity (${plan.quantity}) exceeds maxQtyPerOrder (${ticketEntry.maxQuantity}) for ticket '${ticketEntry.name}' in showing '${showingEntry.name ?? target.showingId}'.`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private static normalizeCatalogShowings(catalog: EventCatalog | TicketCatalogSnapshot): Array<{
    id: string | null;
    name?: string | null | undefined;
    tickets: Array<{
      id: string | null;
      name: string;
      maxQuantity: number | null;
      minQuantity: number | null;
    }>;
  }> {
    if ('showings' in catalog && Array.isArray(catalog.showings)) {
      return catalog.showings.map((s) => {
        // EventCatalog format: ShowingSnapshot with ticketTypes
        if ('ticketTypes' in s && Array.isArray(s.ticketTypes)) {
          return {
            id: s.id,
            name: s.name,
            tickets: s.ticketTypes.map((t) => ({
              id: t.id,
              name: t.name,
              maxQuantity: t.maxQuantity,
              minQuantity: t.minQuantity,
            })),
          };
        }
        // TicketCatalogSnapshot format: showings with tickets
        if ('tickets' in s && Array.isArray(s.tickets)) {
          return {
            id: s.id,
            name: s.name,
            tickets: s.tickets.map((t) => ({
              id: t.id,
              name: t.name,
              maxQuantity: t.maxQuantity ?? null,
              minQuantity: t.minQuantity ?? null,
            })),
          };
        }
        return { id: s.id, name: s.name, tickets: [] };
      });
    }
    return [];
  }
}
