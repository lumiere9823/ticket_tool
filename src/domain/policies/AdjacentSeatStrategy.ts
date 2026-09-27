import {
  Seat,
  SeatPreferencePolicy,
  NonAdjacentFallbackPolicy,
} from '../entities/BookingJourneyModels';

export interface SeatSelectionDecision {
  selectedSeats: Seat[];
  isAdjacent: boolean;
  status: 'SUCCESS' | 'WAIT' | 'STOP' | 'INSUFFICIENT_SEATS';
  reason: string;
}

export class AdjacentSeatStrategy {
  /**
   * Selects candidate seats prioritizing adjacent seating within the same area and row.
   * Conforms strictly to Sections 12 and 13.
   */
  public static selectSeats(
    availableSeats: Seat[],
    quantity: number,
    targetArea?: string,
    preference: SeatPreferencePolicy = 'ANY_AVAILABLE',
    fallbackPolicy: NonAdjacentFallbackPolicy = 'SELECT_NON_ADJACENT'
  ): SeatSelectionDecision {
    if (quantity <= 0) {
      return {
        selectedSeats: [],
        isAdjacent: false,
        status: 'STOP',
        reason: 'Requested quantity must be at least 1',
      };
    }

    // 1. Filter seats to available and selectable, optionally scoped by targetArea
    const eligibleSeats = availableSeats.filter((seat) => {
      if (seat.status !== 'AVAILABLE' || !seat.selectable) {
        return false;
      }
      if (targetArea && seat.area && seat.area !== targetArea) {
        return false;
      }
      return true;
    });

    if (eligibleSeats.length < quantity) {
      return {
        selectedSeats: [],
        isAdjacent: false,
        status: 'INSUFFICIENT_SEATS',
        reason: `Only ${eligibleSeats.length} available seats found, requested ${quantity}`,
      };
    }

    // Single seat request is inherently "adjacent"
    if (quantity === 1) {
      const chosen = eligibleSeats[0]!;
      return {
        selectedSeats: [chosen],
        isAdjacent: true,
        status: 'SUCCESS',
        reason: `Selected seat ${chosen.label}`,
      };
    }

    // 2. Group candidate seats by area and row
    const seatsByAreaAndRow = new Map<string, Seat[]>();

    for (const seat of eligibleSeats) {
      const groupKey = `${seat.area || 'default'}::${seat.row || 'default'}`;
      const group = seatsByAreaAndRow.get(groupKey) ?? [];
      group.push(seat);
      seatsByAreaAndRow.set(groupKey, group);
    }

    // 3. Search for adjacent seat blocks of length == quantity
    const adjacentCandidates: Seat[][] = [];

    for (const group of seatsByAreaAndRow.values()) {
      if (group.length < quantity) continue;

      // Sort seats by numeric number
      group.sort((a, b) => a.number - b.number);

      // Slide window of length `quantity`
      for (let i = 0; i <= group.length - quantity; i++) {
        let isContiguous = true;
        for (let j = 0; j < quantity - 1; j++) {
          if (group[i + j + 1]!.number !== group[i + j]!.number + 1) {
            isContiguous = false;
            break;
          }
        }

        if (isContiguous) {
          adjacentCandidates.push(group.slice(i, i + quantity));
        }
      }
    }

    // 4. If adjacent seats found, pick candidate based on preference policy
    if (adjacentCandidates.length > 0) {
      const chosen = this.rankCandidates(adjacentCandidates, preference)[0]!;
      const labels = chosen.map((s) => s.label).join(', ');
      return {
        selectedSeats: chosen,
        isAdjacent: true,
        status: 'SUCCESS',
        reason: `Found and selected ${quantity} adjacent seats: ${labels}`,
      };
    }

    // 5. No adjacent seats found across any row. Apply fallback policy.
    if (fallbackPolicy === 'WAIT') {
      return {
        selectedSeats: [],
        isAdjacent: false,
        status: 'WAIT',
        reason: `Adjacent seats for quantity ${quantity} not available; remaining in WAIT according to policy`,
      };
    }

    if (fallbackPolicy === 'STOP') {
      return {
        selectedSeats: [],
        isAdjacent: false,
        status: 'STOP',
        reason: `Adjacent seats for quantity ${quantity} not available; stopped according to policy`,
      };
    }

    // fallbackPolicy === 'SELECT_NON_ADJACENT'
    // Select closest available seats in the same area
    const nonAdjacentSeats = eligibleSeats.slice(0, quantity);
    const nonAdjacentLabels = nonAdjacentSeats.map((s) => s.label).join(', ');

    return {
      selectedSeats: nonAdjacentSeats,
      isAdjacent: false,
      status: 'SUCCESS',
      reason: `Adjacent seats unavailable; selected non-adjacent seats under fallback policy: ${nonAdjacentLabels}`,
    };
  }

  private static rankCandidates(candidates: Seat[][], preference: SeatPreferencePolicy): Seat[][] {
    switch (preference) {
      case 'SAME_ROW':
      case 'NEAREST_STAGE':
        return candidates.sort((a, b) => {
          // Sort rows alphabetically (Row A before Row B)
          const rowA = a[0]?.row ?? '';
          const rowB = b[0]?.row ?? '';
          const rowComp = rowA.localeCompare(rowB);
          if (rowComp !== 0) return rowComp;

          // Then lower seat numbers
          const numA = a[0]?.number ?? 0;
          const numB = b[0]?.number ?? 0;
          return numA - numB;
        });

      case 'ANY_AVAILABLE':
      default:
        return candidates;
    }
  }
}
