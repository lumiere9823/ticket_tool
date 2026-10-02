import { EventCatalog, TicketType, TicketAvailability, TicketMode } from './EventCatalog';
import { ScopeViolationError } from '../errors/DomainError';

export type PriorityStrategy = 'BY_TARGET_ORDER' | 'SHOWING_FIRST' | 'TIER_FIRST';

export interface ScopedTarget {
  showingId: string;
  ticketTypeIds: string[];
  rank: number;
}

export interface PersistencePolicy {
  maxDurationMinutes: number; // default 120 (see DEFAULT_PERSISTENCE_POLICY below)
  maxAttempts: number; // default 1000 (see DEFAULT_PERSISTENCE_POLICY below)
  pollIntervalMs: number; // default 2000, minimum floor: 1500
  jitterRatio: number; // default 0.2
  stopAt?: string | undefined; // ISO timestamp string, optional
  startAt?: string | undefined; // ISO timestamp string — scheduled ARM time, optional
  maxPricePerTicket?: number | undefined; // Price ceiling per ticket in VND
  maxTotal?: number | undefined; // Price ceiling for total subtotal in VND
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
export const MAX_DURATION_MINUTES_LIMIT = 240;
export const MAX_ATTEMPTS_LIMIT = 5000;

export const DEFAULT_PERSISTENCE_POLICY: PersistencePolicy = {
  maxDurationMinutes: 120,
  maxAttempts: 1000,
  pollIntervalMs: 2000,
  jitterRatio: 0.2,
};

/**
 * Resolves persistence policy values strictly against hard boundaries:
 * - maxDurationMinutes: default 120 if missing or <= 0, clamped to <= 240
 * - maxAttempts: default 1000 if missing or <= 0, clamped to <= 5000
 * - pollIntervalMs: default 2000 if missing, clamped to >= 1500
 */
export function sanitizePersistencePolicy(
  policy?: Partial<PersistencePolicy> | null
): PersistencePolicy {
  let maxDuration = policy?.maxDurationMinutes;
  if (typeof maxDuration !== 'number' || isNaN(maxDuration) || maxDuration <= 0) {
    maxDuration = DEFAULT_PERSISTENCE_POLICY.maxDurationMinutes;
  } else {
    maxDuration = Math.min(maxDuration, MAX_DURATION_MINUTES_LIMIT);
  }

  let maxAttempts = policy?.maxAttempts;
  if (typeof maxAttempts !== 'number' || isNaN(maxAttempts) || maxAttempts <= 0) {
    maxAttempts = DEFAULT_PERSISTENCE_POLICY.maxAttempts;
  } else {
    maxAttempts = Math.min(maxAttempts, MAX_ATTEMPTS_LIMIT);
  }

  let pollInterval = policy?.pollIntervalMs;
  if (
    typeof pollInterval !== 'number' ||
    isNaN(pollInterval) ||
    pollInterval < MIN_POLL_INTERVAL_MS
  ) {
    pollInterval =
      typeof pollInterval === 'number' && !isNaN(pollInterval) && pollInterval > 0
        ? Math.max(pollInterval, MIN_POLL_INTERVAL_MS)
        : DEFAULT_PERSISTENCE_POLICY.pollIntervalMs;
  }

  const jitterRatio =
    typeof policy?.jitterRatio === 'number' &&
    !isNaN(policy.jitterRatio) &&
    policy.jitterRatio >= 0 &&
    policy.jitterRatio <= 1
      ? policy.jitterRatio
      : DEFAULT_PERSISTENCE_POLICY.jitterRatio;

  return {
    maxDurationMinutes: maxDuration,
    maxAttempts,
    pollIntervalMs: pollInterval,
    jitterRatio,
    stopAt: policy?.stopAt,
    startAt: policy?.startAt,
    maxPricePerTicket: policy?.maxPricePerTicket,
    maxTotal: policy?.maxTotal,
  };
}

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

export interface TicketScopeMatchContext {
  uniqueShowingCount?: number;
  isNameAmbiguousWithinShowing?: boolean;
}

export interface TicketScopeMatchResult {
  matched: boolean;
  matchedTarget?: ScopedTarget;
  rejectionReason?: string;
}

/**
 * Pure domain authoritative matching function for a ticket against a ScopedPurchasePlan.
 * Reused across filterByScope and PriorityCategoryEngine to guarantee fail-closed consistency (P2-2).
 */
export function matchTicketToScope(
  ticket: { id: string | null; name: string; showingId: string | null },
  plan: ScopedPurchasePlan,
  context?: TicketScopeMatchContext
): TicketScopeMatchResult {
  if (!plan.targets || plan.targets.length === 0) {
    return { matched: true };
  }

  // Rule 1: Fail-closed on missing showingId (P2-2)
  if (!ticket.showingId) {
    return {
      matched: false,
      rejectionReason: `SHOWING_ID_MISSING: Ticket '${ticket.name}' has no showingId and scopedPlan is active`,
    };
  }

  const showingId = ticket.showingId;
  const uniqueShowings = context?.uniqueShowingCount ?? 1;

  // Rule 2: Find target for this showing (showingId match or 'default' only if uniqueShowings === 1)
  const matchingTargets = plan.targets.filter((target) => {
    if (target.showingId === showingId) return true;
    if (target.showingId === 'default' && uniqueShowings === 1) return true;
    return false;
  });

  if (matchingTargets.length === 0) {
    return {
      matched: false,
      rejectionReason: `SHOWING_NOT_IN_WHITELIST: Showing '${showingId}' is outside scoped targets (target default disallowed when multiple showings exist)`,
    };
  }

  const normName = ticket.name.trim().toLowerCase();

  // Rule 3: Check matching target by ticket ID or name
  for (const target of matchingTargets) {
    const matchedById = Boolean(
      ticket.id &&
      target.ticketTypeIds.some(
        (id) => id === ticket.id || id.toLowerCase().trim() === ticket.id!.toLowerCase().trim()
      ) &&
      ticket.id !== ticket.name
    );

    if (matchedById) {
      return { matched: true, matchedTarget: target };
    }

    const matchedByName =
      target.ticketTypeIds.includes(ticket.name) ||
      target.ticketTypeIds.some((id) => id.toLowerCase().trim() === normName);

    if (matchedByName) {
      // Rule 4: If matched only by name, verify name is not ambiguous within the showing
      if (context?.isNameAmbiguousWithinShowing) {
        return {
          matched: false,
          rejectionReason: `AMBIGUOUS_MATCH: Ticket name '${ticket.name}' is not unique within showing '${showingId}'`,
        };
      }
      return { matched: true, matchedTarget: target };
    }
  }

  return {
    matched: false,
    rejectionReason: `TICKET_NOT_IN_WHITELIST: Ticket '${ticket.name}' (${ticket.id}) is outside scoped targets for showing '${showingId}'`,
  };
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

  const totalShowings = catalog.showings.length;

  for (const showing of catalog.showings) {
    const showingId = showing.id;
    if (!showingId) {
      for (const ticket of showing.ticketTypes) {
        rejectedCandidates.push({
          showingId: '',
          ticketId: ticket.id,
          ticketName: ticket.name,
          reason: `SHOWING_ID_MISSING: Showing '${showing.name ?? 'unknown'}' has no showingId`,
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

    // Showing evaluation for each ticket type
    for (const ticket of showing.ticketTypes) {
      const normName = ticket.name.trim().toLowerCase();
      const isNameAmbiguous = (ticketNameCounts.get(normName) ?? 0) > 1;

      const matchResult = matchTicketToScope(
        { id: ticket.id, name: ticket.name, showingId },
        plan,
        {
          uniqueShowingCount: totalShowings,
          isNameAmbiguousWithinShowing: isNameAmbiguous,
        }
      );

      if (!matchResult.matched || !matchResult.matchedTarget) {
        rejectedCandidates.push({
          showingId,
          ticketId: ticket.id,
          ticketName: ticket.name,
          reason: matchResult.rejectionReason ?? 'TICKET_NOT_IN_WHITELIST',
        });
        continue;
      }

      const matchingTarget = matchResult.matchedTarget;

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
 * Ignores query strings and fragments so dates (e.g. ?date=2026-10-02) do not corrupt extraction.
 */
export function extractEventIdFromUrl(url: string): string | null {
  if (!url) return null;

  // 1. Strip query parameters and hash fragments
  const cleanUrl = url.split(/[?#]/)[0] ?? '';
  if (!cleanUrl) return null;

  // 2. Extract pathname
  let pathname = cleanUrl;
  try {
    pathname = new URL(cleanUrl).pathname;
  } catch {
    // If not a full URL, strip protocol / domain if present or use as pathname
    pathname = cleanUrl.replace(/^[a-zA-Z]+:\/\/[^/]+/, '');
  }

  // 3. Priority A: /events/:id or /event/:id
  // e.g. /events/26624/bookings/... or /events/conan-movie-premiere or /event/special-show-2026/booking
  const matchEventRoute = pathname.match(/\/events?\/([^/]+)/i);
  if (matchEventRoute && matchEventRoute[1]) {
    const segment = matchEventRoute[1];
    // If the segment itself has a trailing numeric slug (e.g. nhac-hoi-mua-thu-12345 or special-show-2026)
    const slugInSegment = segment.match(/-(\d+)$/);
    if (slugInSegment && slugInSegment[1]) {
      return slugInSegment[1];
    }
    return segment;
  }

  // 4. Priority B: root event slug e.g. /the-aura-26624 or /event-54321/select-ticket
  const matchRootSlug = pathname.match(/(?:^|\/)([a-zA-Z0-9_]+)-(\d+)(?:\/|$)/);
  if (matchRootSlug && matchRootSlug[2]) {
    return matchRootSlug[2];
  }

  // 5. Fallback: any -(\d+) in path
  const matchAnySlug = pathname.match(/-(\d+)(?:\/|$)/);
  if (matchAnySlug && matchAnySlug[1]) {
    return matchAnySlug[1];
  }

  return null;
}
