import { EventCatalog, TicketCandidate } from '../entities/EventCatalog';
import { TicketPreference } from '../entities/TicketPreference';

export interface SelectionEvaluationResult {
  selectedCandidate: TicketCandidate | null;
  allCandidates: TicketCandidate[];
  isFallback: boolean;
  reason?: string | undefined;
}

/**
 * Domain policy for selecting the best ticket candidate from a discovered EventCatalog.
 * Enforces:
 * - Priority preservation
 * - Rejection of SOLD_OUT, UNKNOWN, NOT_STARTED, CLOSED, non-selectable tickets
 * - Quantity constraint verification
 * - Strict allowFallback behavior
 * - Never selects arbitrary categories outside configured policy
 */
export class TicketCandidateSelector {
  /**
   * Builds candidate evaluation records for all tickets in the catalog.
   */
  public static buildCandidates(
    catalog: EventCatalog,
    preference: TicketPreference
  ): TicketCandidate[] {
    const candidates: TicketCandidate[] = [];
    const requestedQty = preference.quantity.value;

    for (const showing of catalog.showings) {
      for (const ticket of showing.ticketTypes) {
        const priorityIndex = this.findPriorityIndex(ticket.name, preference.categoryPriority);
        const rejectionReasons: string[] = [];

        // 1. Must match preference category
        if (priorityIndex === -1) {
          rejectionReasons.push('NOT_IN_PREFERENCES');
        }

        // 2. Reject non-available states
        if (ticket.availability === 'SOLD_OUT') {
          rejectionReasons.push('SOLD_OUT');
        } else if (ticket.availability === 'UNKNOWN') {
          rejectionReasons.push('UNKNOWN_AVAILABILITY');
        } else if (ticket.availability === 'NOT_STARTED') {
          rejectionReasons.push('NOT_STARTED');
        } else if (ticket.availability === 'CLOSED') {
          rejectionReasons.push('CLOSED');
        }

        // 3. Reject non-selectable
        if (!ticket.selectable) {
          rejectionReasons.push('NOT_SELECTABLE');
        }

        // 4. Verify quantity constraints when observable
        if (ticket.maxQuantity !== null && requestedQty > ticket.maxQuantity) {
          rejectionReasons.push(`QUANTITY_EXCEEDS_MAX: ${requestedQty} > ${ticket.maxQuantity}`);
        }
        if (ticket.minQuantity !== null && requestedQty < ticket.minQuantity) {
          rejectionReasons.push(`QUANTITY_BELOW_MIN: ${requestedQty} < ${ticket.minQuantity}`);
        }

        // 5. Verify max price if configured
        if (
          preference.maxPricePerTicket &&
          ticket.price.amount > preference.maxPricePerTicket.amount
        ) {
          rejectionReasons.push(
            `PRICE_EXCEEDS_MAX: ${ticket.price.amount} > ${preference.maxPricePerTicket.amount}`
          );
        }

        const canAttemptSelection = rejectionReasons.length === 0;

        candidates.push({
          ticket,
          requestedQuantity: requestedQty,
          priority: priorityIndex !== -1 ? priorityIndex : 9999,
          availability: ticket.availability,
          canAttemptSelection,
          rejectionReasons,
        });
      }
    }

    return candidates;
  }

  /**
   * Selects the highest priority candidate matching the user's preferences.
   */
  public static selectBestCandidate(
    catalog: EventCatalog,
    preference: TicketPreference
  ): SelectionEvaluationResult {
    const allCandidates = this.buildCandidates(catalog, preference);

    // Filter only candidates configured in preferences, sorted by priority (lowest index = highest priority)
    const matchingCandidates = allCandidates
      .filter((c) => c.priority < 9999)
      .sort((a, b) => a.priority - b.priority);

    if (matchingCandidates.length === 0) {
      return {
        selectedCandidate: null,
        allCandidates,
        isFallback: false,
        reason: 'No ticket in catalog matched configured category priorities',
      };
    }

    const topPriorityCandidate = matchingCandidates[0]!;

    // If top preferred category is selectable, choose it
    if (topPriorityCandidate.canAttemptSelection) {
      return {
        selectedCandidate: topPriorityCandidate,
        allCandidates,
        isFallback: false,
      };
    }

    // Top priority is not available. Check fallback policy
    if (!preference.allowFallback) {
      return {
        selectedCandidate: null,
        allCandidates,
        isFallback: false,
        reason: `Top priority '${topPriorityCandidate.ticket.name}' is unavailable and allowFallback is false`,
      };
    }

    // allowFallback is true: find next selectable candidate in priority order
    for (let i = 1; i < matchingCandidates.length; i++) {
      const candidate = matchingCandidates[i]!;
      if (candidate.canAttemptSelection) {
        return {
          selectedCandidate: candidate,
          allCandidates,
          isFallback: true,
          reason: `Fell back from '${topPriorityCandidate.ticket.name}' to '${candidate.ticket.name}'`,
        };
      }
    }

    return {
      selectedCandidate: null,
      allCandidates,
      isFallback: false,
      reason: 'All configured priority tickets are unavailable or rejected',
    };
  }

  private static findPriorityIndex(ticketName: string, priorities: readonly string[]): number {
    const normalizedTicket = ticketName.trim().toLowerCase();

    for (let i = 0; i < priorities.length; i++) {
      const target = priorities[i]!.trim().toLowerCase();
      if (target === 'any') return i;
      if (normalizedTicket === target) return i;
      if (normalizedTicket.includes(target) || target.includes(normalizedTicket)) return i;
    }

    return -1;
  }
}
