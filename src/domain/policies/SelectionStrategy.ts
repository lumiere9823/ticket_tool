import { CandidateTicket } from '../entities/CandidateTicket';
import { TicketPreference } from '../entities/TicketPreference';
import { ScopedPurchasePlan } from '../entities/ScopedPurchasePlan';

export interface SelectionResult {
  candidate: CandidateTicket;
  matchedPriorityIndex: number;
  isFallback: boolean;
}

/**
 * Deterministic selection strategy implementing business rules from PRD FR-006.
 * Pure domain logic: zero DOM dependencies.
 */
export class SelectionStrategy {
  /**
   * Evaluates available candidates against configured ticket preferences.
   * Returns the best candidate or null if no valid candidate exists.
   */
  public static selectCandidate(
    candidates: readonly CandidateTicket[],
    preference: TicketPreference,
    scopedPlan?: ScopedPurchasePlan | null
  ): SelectionResult | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    let candidatePool = candidates;
    if (scopedPlan && scopedPlan.targets && scopedPlan.targets.length > 0) {
      candidatePool = candidates.filter((c) => {
        return scopedPlan.targets.some((target) => {
          return (
            target.ticketTypeIds.includes(c.id) || target.ticketTypeIds.includes(c.categoryName)
          );
        });
      });
      if (candidatePool.length === 0) {
        return null;
      }
    }

    const availableCandidates = candidatePool.filter(
      (c) => c.isAvailable && c.availableQuantity >= preference.quantity.value
    );

    if (availableCandidates.length === 0) {
      return null;
    }

    // Evaluate priorities in configured order
    for (let i = 0; i < preference.categoryPriority.length; i++) {
      const priorityCategory = preference.categoryPriority[i]!.trim().toLowerCase();

      // Find candidates matching this priority level
      const matching = availableCandidates.filter((c) => {
        if (priorityCategory === 'any') return true;
        const cat = c.categoryName.trim().toLowerCase();
        const cid = c.id.trim().toLowerCase();
        return cat === priorityCategory || cat.includes(priorityCategory) || cid === priorityCategory;
      });

      if (matching.length > 0) {
        // Deterministic secondary sort: lowest price first, then stable identifier
        matching.sort((a, b) => {
          if (a.price.amount !== b.price.amount) {
            return a.price.amount - b.price.amount;
          }
          return a.id.localeCompare(b.id);
        });

        const selected = matching[0]!;
        const isFallback = i > 0;

        // If fallback occurred, verify preference allows it
        if (isFallback && !preference.allowFallback) {
          return null;
        }

        return {
          candidate: selected,
          matchedPriorityIndex: i,
          isFallback,
        };
      }
    }

    return null;
  }
}
