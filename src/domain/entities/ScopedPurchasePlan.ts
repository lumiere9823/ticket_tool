import { EventCatalog, TicketType, TicketAvailability, TicketMode } from './EventCatalog';
import { ScopeViolationError } from '../errors/DomainError';

export type PriorityStrategy = 'BY_TARGET_ORDER' | 'SHOWING_FIRST' | 'TIER_FIRST';

export interface ScopedTarget {
  showingId: string;
  ticketTypeIds: string[];
  rank: number;
}

export interface PersistencePolicy {
  maxDurationMinutes: number; // default 30
  maxAttempts: number; // default 200
  pollIntervalMs: number; // default 2000, minimum floor: 1500
  jitterRatio: number; // default 0.2
  stopAt?: string | undefined; // ISO timestamp string, optional
  startAt?: string | undefined; // ISO timestamp string — scheduled ARM time, optional
}

export interface ScopedPurchasePlan {
  eventId: string;
  targets: ScopedTarget[];
  quantity: number;
  strategy: PriorityStrategy; // default 'BY_TARGET_ORDER'
  persistence: PersistencePolicy;
  allowPartialQuantity?: boolean; // default false
}

export const MIN_POLL_INTERVAL_MS = 1500;

export const DEFAULT_PERSISTENCE_POLICY: PersistencePolicy = {
  maxDurationMinutes: 120,
  maxAttempts: 1000,
  pollIntervalMs: 2000,
  jitterRatio: 0.2,
};

export function createDefaultScopedPurchasePlan(eventId = ''): ScopedPurchasePlan {
  return {
    eventId,
    targets: [],
    quantity: 1,
    strategy: 'BY_TARGET_ORDER',
    persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    allowPartialQuantity: false,
  };
}

export interface ScopeCandidate {
  showingId: string;
  showingName?: string | null | undefined;
  ticketId: string;
  ticketName: string;
  price: number;
  mode: TicketMode;
  availability: TicketAvailability;
  selectable: boolean;
  minQuantity: number | null;
  maxQuantity: number | null;
  rank: number;
  inScope: boolean;
  canAttemptSelection: boolean;
  ticket: TicketType;
  rejectionReason?: string | undefined;
}

export interface ScopeFilterResult {
  /** Candidates that are both in whitelist and currently eligible/available to attempt selection */
  validCandidates: ScopeCandidate[];
  /** All candidates that belong to the whitelist, regardless of current inventory availability */
  inScopeCandidates: ScopeCandidate[];
  /** Candidates rejected because they are outside the whitelist or violated quantity constraints */
  rejectedCandidates: Array<{
    showingId: string | null;
    ticketId: string | null;
    ticketName: string;
    reason: string;
  }>;
}

/**
 * Pure domain function to filter an EventCatalog strictly according to a ScopedPurchasePlan.
 * Zero Chrome/DOM dependencies.
 *
 * Invariants:
 * - BR-S01: Hard Scope Guard. Only (showingId, ticketTypeId) pairs inside plan.targets are accepted.
 * - Out-of-whitelist candidates are rejected with explicit reasons for sanitized audit logging.
 */
export function filterByScope(catalog: EventCatalog, plan: ScopedPurchasePlan): ScopeFilterResult {
  const validCandidates: ScopeCandidate[] = [];
  const inScopeCandidates: ScopeCandidate[] = [];
  const rejectedCandidates: ScopeFilterResult['rejectedCandidates'] = [];

  // Index targets by showingId
  const targetsByShowing = new Map<string, ScopedTarget[]>();
  for (const target of plan.targets) {
    const list = targetsByShowing.get(target.showingId) ?? [];
    list.push(target);
    targetsByShowing.set(target.showingId, list);
  }

  for (const showing of catalog.showings) {
    const showingId = showing.id;
    let matchingTargets = showingId ? targetsByShowing.get(showingId) : undefined;

    // Fallback: If target was saved with 'default' showing ID
    if (!matchingTargets && targetsByShowing.has('default')) {
      matchingTargets = targetsByShowing.get('default');
    }

    if (!showingId || !matchingTargets || matchingTargets.length === 0) {
      // Entire showing is outside whitelist
      for (const ticket of showing.ticketTypes) {
        rejectedCandidates.push({
          showingId,
          ticketId: ticket.id,
          ticketName: ticket.name,
          reason: `SHOWING_NOT_IN_WHITELIST: Showing '${showing.name ?? showingId ?? 'unknown'}' (${showingId}) is outside scoped targets`,
        });
      }
      continue;
    }

    // Count ticket names within this showing to detect duplicate / ambiguous names
    const ticketNameCounts = new Map<string, number>();
    for (const t of showing.ticketTypes) {
      const norm = t.name.trim().toLowerCase();
      ticketNameCounts.set(norm, (ticketNameCounts.get(norm) ?? 0) + 1);
    }

    // Showing is in whitelist: evaluate each ticket type
    for (const ticket of showing.ticketTypes) {
      const normName = ticket.name.trim().toLowerCase();
      const isNameAmbiguous = (ticketNameCounts.get(normName) ?? 0) > 1;

      // Primary key matching: check if target matched by ID or by Name
      const matchingTarget = matchingTargets.find((t) => {
        if (ticket.id && t.ticketTypeIds.includes(ticket.id)) {
          return true;
        }
        if (t.ticketTypeIds.includes(ticket.name)) {
          return true;
        }
        if (t.ticketTypeIds.some((id) => id.toLowerCase().trim() === normName)) {
          return true;
        }
        return false;
      });

      if (!matchingTarget) {
        rejectedCandidates.push({
          showingId,
          ticketId: ticket.id,
          ticketName: ticket.name,
          reason: `TICKET_NOT_IN_WHITELIST: Ticket '${ticket.name}' (${ticket.id}) is outside scoped targets for showing ${showingId}`,
        });
        continue;
      }

      // If matched by name (or ticket.id equals name/missing), reject if ambiguous in this showing
      const matchedById = Boolean(
        ticket.id && matchingTarget.ticketTypeIds.includes(ticket.id) && ticket.id !== ticket.name
      );
      if (!matchedById && isNameAmbiguous) {
        rejectedCandidates.push({
          showingId,
          ticketId: ticket.id,
          ticketName: ticket.name,
          reason: `AMBIGUOUS_MATCH: Ticket name '${ticket.name}' is not unique within showing '${showing.name ?? showingId}' (${showingId})`,
        });
        continue;
      }

      // Ticket is in whitelist
      const ticketId = ticket.id ?? ticket.name;
      const rejectionReasons: string[] = [];

      if (ticket.availability !== 'AVAILABLE') {
        rejectionReasons.push(`AVAILABILITY_${ticket.availability}`);
      }
      if (!ticket.selectable) {
        rejectionReasons.push('NOT_SELECTABLE');
      }
      if (
        !plan.allowPartialQuantity &&
        ticket.maxQuantity !== null &&
        plan.quantity > ticket.maxQuantity
      ) {
        rejectionReasons.push(`QUANTITY_EXCEEDS_MAX: ${plan.quantity} > ${ticket.maxQuantity}`);
      }
      if (ticket.minQuantity !== null && plan.quantity < ticket.minQuantity) {
        rejectionReasons.push(`QUANTITY_BELOW_MIN: ${plan.quantity} < ${ticket.minQuantity}`);
      }

      const canAttemptSelection = rejectionReasons.length === 0;

      const candidate: ScopeCandidate = {
        showingId,
        showingName: showing.name,
        ticketId,
        ticketName: ticket.name,
        price: ticket.price.amount,
        mode: ticket.mode,
        availability: ticket.availability,
        selectable: ticket.selectable,
        minQuantity: ticket.minQuantity,
        maxQuantity: ticket.maxQuantity,
        rank: matchingTarget.rank,
        inScope: true,
        canAttemptSelection,
        ticket,
        ...(rejectionReasons.length > 0 ? { rejectionReason: rejectionReasons.join(', ') } : {}),
      };

      inScopeCandidates.push(candidate);

      if (canAttemptSelection) {
        validCandidates.push(candidate);
      } else {
        rejectedCandidates.push({
          showingId,
          ticketId: ticket.id,
          ticketName: ticket.name,
          reason: rejectionReasons.join(', '),
        });
      }
    }
  }

  return {
    validCandidates,
    inScopeCandidates,
    rejectedCandidates,
  };
}

/**
 * Pure domain assertion guard.
 * Must be executed immediately before any ticket selection, drawer opening,
 * calendar date click, or direct navigation (/bookings/{showingId}/select-ticket).
 * Violations immediately throw ScopeViolationError (DomainError) to abort execution.
 */
export function assertInScope(
  plan: ScopedPurchasePlan | null | undefined,
  showingId?: string | null,
  ticketTypeId?: string | null
): void {
  if (!plan || !plan.targets || plan.targets.length === 0) {
    return;
  }

  if (showingId) {
    const targetsForShowing = plan.targets.filter(
      (t) =>
        t.showingId === showingId ||
        t.showingId === 'default' ||
        showingId === 'default' ||
        !t.showingId
    );
    if (targetsForShowing.length === 0) {
      throw new ScopeViolationError(`Showing ${showingId} is outside whitelist`);
    }

    if (ticketTypeId) {
      const ticketInScope = targetsForShowing.some(
        (t) =>
          t.ticketTypeIds.includes(ticketTypeId) ||
          t.ticketTypeIds.some(
            (id) => id.toLowerCase().trim() === ticketTypeId.toLowerCase().trim()
          )
      );
      if (!ticketInScope) {
        throw new ScopeViolationError(`Ticket ${ticketTypeId} is outside whitelist`);
      }
    }
    return;
  }

  if (ticketTypeId) {
    const ticketInScope = plan.targets.some((t) => t.ticketTypeIds.includes(ticketTypeId));
    if (!ticketInScope) {
      throw new ScopeViolationError(`Ticket ${ticketTypeId} is outside whitelist`);
    }
  }
}

/**
 * Pure domain strategy function to pick the best eligible candidate from filtered candidates.
 *
 * Strategies:
 * - BY_TARGET_ORDER: follows user target configuration order (rank 1, 2, 3...) and picks the first available.
 * - SHOWING_FIRST: prioritizes the best showing (by appearance in targets), then best tier in that showing.
 * - TIER_FIRST: prioritizes the best tier globally (by appearance in targets) across any available showing.
 *
 * "Best" is strictly defined by the user configuration in plan.targets, NEVER by price.
 */
export function pickTarget(
  candidates: ScopeCandidate[],
  plan: ScopedPurchasePlan
): ScopeCandidate | null {
  if (
    !candidates ||
    candidates.length === 0 ||
    !plan ||
    !plan.targets ||
    plan.targets.length === 0
  ) {
    return null;
  }

  const eligible = candidates.filter((c) => c.inScope && c.canAttemptSelection);
  if (eligible.length === 0) {
    return null;
  }

  const strategy = plan.strategy || 'BY_TARGET_ORDER';

  switch (strategy) {
    case 'BY_TARGET_ORDER': {
      const sortedTargets = [...plan.targets].sort((a, b) => a.rank - b.rank);
      for (const target of sortedTargets) {
        const targetCandidates = eligible.filter(
          (c) =>
            (c.showingId === target.showingId ||
              target.showingId === 'default' ||
              !target.showingId) &&
            (target.ticketTypeIds.includes(c.ticketId) ||
              target.ticketTypeIds.includes(c.ticketName) ||
              target.ticketTypeIds.some(
                (id) =>
                  id.toLowerCase().trim() === c.ticketId.toLowerCase().trim() ||
                  id.toLowerCase().trim() === c.ticketName.toLowerCase().trim()
              ))
        );
        if (targetCandidates.length > 0) {
          targetCandidates.sort((a, b) => {
            const idxA = Math.min(
              target.ticketTypeIds.indexOf(a.ticketId) === -1
                ? 9999
                : target.ticketTypeIds.indexOf(a.ticketId),
              target.ticketTypeIds.indexOf(a.ticketName) === -1
                ? 9999
                : target.ticketTypeIds.indexOf(a.ticketName)
            );
            const idxB = Math.min(
              target.ticketTypeIds.indexOf(b.ticketId) === -1
                ? 9999
                : target.ticketTypeIds.indexOf(b.ticketId),
              target.ticketTypeIds.indexOf(b.ticketName) === -1
                ? 9999
                : target.ticketTypeIds.indexOf(b.ticketName)
            );
            return idxA - idxB;
          });
          return targetCandidates[0] ?? null;
        }
      }
      return null;
    }

    case 'SHOWING_FIRST': {
      const sortedTargets = [...plan.targets].sort((a, b) => a.rank - b.rank);
      const showingOrder: string[] = [];
      for (const t of sortedTargets) {
        if (!showingOrder.includes(t.showingId)) {
          showingOrder.push(t.showingId);
        }
      }

      for (const showingId of showingOrder) {
        const showingCandidates = eligible.filter((c) => c.showingId === showingId);
        if (showingCandidates.length > 0) {
          const target = sortedTargets.find((t) => t.showingId === showingId);
          showingCandidates.sort((a, b) => {
            if (a.rank !== b.rank) {
              return a.rank - b.rank;
            }
            if (target) {
              const idxA = Math.min(
                target.ticketTypeIds.indexOf(a.ticketId) === -1
                  ? 9999
                  : target.ticketTypeIds.indexOf(a.ticketId),
                target.ticketTypeIds.indexOf(a.ticketName) === -1
                  ? 9999
                  : target.ticketTypeIds.indexOf(a.ticketName)
              );
              const idxB = Math.min(
                target.ticketTypeIds.indexOf(b.ticketId) === -1
                  ? 9999
                  : target.ticketTypeIds.indexOf(b.ticketId),
                target.ticketTypeIds.indexOf(b.ticketName) === -1
                  ? 9999
                  : target.ticketTypeIds.indexOf(b.ticketName)
              );
              return idxA - idxB;
            }
            return 0;
          });
          return showingCandidates[0] ?? null;
        }
      }
      return null;
    }

    case 'TIER_FIRST': {
      const sortedTargets = [...plan.targets].sort((a, b) => a.rank - b.rank);
      const tierOrder: string[] = [];
      for (const t of sortedTargets) {
        for (const tid of t.ticketTypeIds) {
          if (!tierOrder.includes(tid)) {
            tierOrder.push(tid);
          }
        }
      }

      const showingOrder: string[] = [];
      for (const t of sortedTargets) {
        if (!showingOrder.includes(t.showingId)) {
          showingOrder.push(t.showingId);
        }
      }

      for (const tierId of tierOrder) {
        const matchingCandidates = eligible.filter(
          (c) =>
            c.ticketId === tierId ||
            c.ticketName === tierId ||
            c.ticketId?.toLowerCase().trim() === tierId.toLowerCase().trim() ||
            c.ticketName?.toLowerCase().trim() === tierId.toLowerCase().trim()
        );
        if (matchingCandidates.length > 0) {
          matchingCandidates.sort((a, b) => {
            const idxA = showingOrder.indexOf(a.showingId);
            const idxB = showingOrder.indexOf(b.showingId);
            return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
          });
          return matchingCandidates[0] ?? null;
        }
      }
      return null;
    }

    default:
      return eligible[0] ?? null;
  }
}

/**
 * Authoritatively extracts the event ID from a Ticketbox URL.
 * Handles both slug-based IDs (e.g. "rock-concert-12345" or "event-12345")
 * and /events/:id or /event/:id route formats.
 */
export function extractEventIdFromUrl(url: string): string | null {
  if (!url) return null;
  const matchSlug = url.match(/-(\d+)(?:[/?#]|$)/);
  if (matchSlug && matchSlug[1]) return matchSlug[1];
  const matchEvent = url.match(/\/events?\/([a-zA-Z0-9_-]+)/i);
  if (matchEvent && matchEvent[1]) return matchEvent[1];
  return null;
}
