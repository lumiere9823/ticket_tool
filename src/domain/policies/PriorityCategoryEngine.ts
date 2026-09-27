import { JourneyTicketType } from '../entities/BookingJourneyModels';

export interface PriorityDecisionResult {
  selectedTicket: JourneyTicketType | null;
  reason: string;
  matchedPriorityIndex: number;
  fallbackUsed: boolean;
}

export class PriorityCategoryEngine {
  /**
   * Evaluates available tickets against a list of prioritized categories.
   * Strictly enforces:
   * 1. Ignores unavailable tickets (SOLD_OUT, OFFLINE_SALE, NOT_STARTED, CLOSED, UNKNOWN, non-selectable).
   * 2. Matches exact normalized names first.
   * 3. Matches explicitly supported normalized tokens (e.g. "CAT 1" matches "CAT 1 - Seated", but NOT "CAT 10").
   * 4. Does not use fuzzy matching that could accidentally select another ticket.
   * 5. If no priority ticket is available and allowFallback=true: selects according to configured fallback policy.
   * 6. If allowFallback=false: returns null with reason, signaling WAITING.
   */
  public static evaluate(
    tickets: JourneyTicketType[],
    priorityCategories: string[],
    allowFallback: boolean,
    requestedQuantity = 1
  ): PriorityDecisionResult {
    // 1. Filter tickets to only strictly AVAILABLE and selectable tickets
    const availableTickets = tickets.filter(
      (t) => t.availability === 'AVAILABLE' && t.selectable
    );

    if (availableTickets.length === 0) {
      return {
        selectedTicket: null,
        reason: 'No available tickets found on page',
        matchedPriorityIndex: -1,
        fallbackUsed: false,
      };
    }

    // 2. Validate quantity constraints if observable
    const eligibleTickets = availableTickets.filter((t) => {
      if (t.maxQuantity !== null && requestedQuantity > t.maxQuantity) {
        return false;
      }
      if (t.minQuantity !== null && requestedQuantity < t.minQuantity) {
        return false;
      }
      return true;
    });

    if (eligibleTickets.length === 0) {
      return {
        selectedTicket: null,
        reason: `Available tickets cannot satisfy requested quantity of ${requestedQuantity}`,
        matchedPriorityIndex: -1,
        fallbackUsed: false,
      };
    }

    // Normalize priority list
    const normalizedPriorities = priorityCategories
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (normalizedPriorities.length === 0) {
      // No priorities configured: if fallback allowed, pick first eligible ticket
      if (allowFallback && eligibleTickets.length > 0) {
        return {
          selectedTicket: eligibleTickets[0]!,
          reason: 'No priority categories specified; selected first available eligible ticket',
          matchedPriorityIndex: -1,
          fallbackUsed: true,
        };
      }
      return {
        selectedTicket: null,
        reason: 'No priority categories specified and fallback is disabled',
        matchedPriorityIndex: -1,
        fallbackUsed: false,
      };
    }

    // 3. Evaluate each priority category in strict order
    for (let pIdx = 0; pIdx < normalizedPriorities.length; pIdx++) {
      const priority = normalizedPriorities[pIdx]!;
      const isAny = priority.toUpperCase() === 'ANY';

      if (isAny) {
        // 'ANY' matches any eligible available ticket
        return {
          selectedTicket: eligibleTickets[0]!,
          reason: `Matched wildcard ANY at priority index ${pIdx}`,
          matchedPriorityIndex: pIdx,
          fallbackUsed: pIdx > 0,
        };
      }

      // Step 2a: Exact normalized match
      const exactMatch = eligibleTickets.find((t) =>
        this.isExactNormalizedMatch(t.name, priority)
      );
      if (exactMatch) {
        const isFallback = pIdx > 0;
        if (isFallback && !allowFallback) {
          // Fallback not allowed, but top priority was missed
          return {
            selectedTicket: null,
            reason: `Top priority '${normalizedPriorities[0]}' unavailable and fallback is disabled`,
            matchedPriorityIndex: -1,
            fallbackUsed: false,
          };
        }
        return {
          selectedTicket: exactMatch,
          reason: `Exact match for priority '${priority}' at index ${pIdx}`,
          matchedPriorityIndex: pIdx,
          fallbackUsed: isFallback,
        };
      }

      // Step 2b: Explicitly supported normalized boundary match
      const tokenMatch = eligibleTickets.find((t) =>
        this.isSupportedTokenMatch(t.name, priority)
      );
      if (tokenMatch) {
        const isFallback = pIdx > 0;
        if (isFallback && !allowFallback) {
          return {
            selectedTicket: null,
            reason: `Top priority '${normalizedPriorities[0]}' unavailable and fallback is disabled`,
            matchedPriorityIndex: -1,
            fallbackUsed: false,
          };
        }
        return {
          selectedTicket: tokenMatch,
          reason: `Token match for priority '${priority}' at index ${pIdx}`,
          matchedPriorityIndex: pIdx,
          fallbackUsed: isFallback,
        };
      }
    }

    // 4. No configured priority matched any available eligible ticket
    if (allowFallback) {
      // Pick first eligible available ticket under fallback policy
      return {
        selectedTicket: eligibleTickets[0]!,
        reason: 'All configured priority tickets unavailable; fell back to next available ticket',
        matchedPriorityIndex: -1,
        fallbackUsed: true,
      };
    }

    // Fallback is false: remain waiting
    return {
      selectedTicket: null,
      reason: 'No configured priority ticket is currently available and fallback is disabled',
      matchedPriorityIndex: -1,
      fallbackUsed: false,
    };
  }

  private static isExactNormalizedMatch(ticketName: string, priority: string): boolean {
    return this.cleanString(ticketName) === this.cleanString(priority);
  }

  private static isSupportedTokenMatch(ticketName: string, priority: string): boolean {
    const cleanTicket = this.cleanString(ticketName);
    const cleanPriority = this.cleanString(priority);

    if (cleanTicket === cleanPriority) return true;

    // Word boundary pattern: e.g. "cat 1" must match "cat 1 (standing)" or "cat 1 - khu a",
    // but MUST NOT match "cat 10" or "cat 12" or "cat 1a"
    const escaped = cleanPriority.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[\\-_(/])${escaped}($|\\s|[\\-_)/])`, 'i');

    return regex.test(cleanTicket);
  }

  private static cleanString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip diacritics for uniform matching
      .replace(/\s+/g, ' ')
      .trim();
  }
}
