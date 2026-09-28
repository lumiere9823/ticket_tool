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
      if (targetArea) {
        const matchesArea =
          seat.area === targetArea ||
          seat.area?.toLowerCase() === targetArea.toLowerCase() ||
          (seat.areaId &&
            (seat.areaId === targetArea || seat.areaId.toLowerCase() === targetArea.toLowerCase()));
        if (!matchesArea) return false;
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

      // Sort seats by position index if available, or horizontal coordinate x, or numeric number
      const hasPositions = group.every((s) => typeof s.position === 'number');
      const hasCoords = group.every((s) => typeof s.x === 'number');

      if (hasPositions) {
        group.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      } else if (hasCoords) {
        group.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      } else {
        group.sort((a, b) => a.number - b.number);
      }

      // Slide window of length `quantity`
      for (let i = 0; i <= group.length - quantity; i++) {
        let isContiguous = true;
        for (let j = 0; j < quantity - 1; j++) {
          if (!this.areContiguous(group[i + j]!, group[i + j + 1]!)) {
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

  private static areContiguous(s1: Seat, s2: Seat): boolean {
    // 1. If explicit row position index is provided (e.g. from Seatmap API)
    if (typeof s1.position === 'number' && typeof s2.position === 'number') {
      return Math.abs(s2.position - s1.position) === 1;
    }

    // 2. If SVG coordinates are present on the same horizontal row
    if (
      typeof s1.x === 'number' &&
      typeof s2.x === 'number' &&
      typeof s1.y === 'number' &&
      typeof s2.y === 'number' &&
      Math.abs(s1.y - s2.y) <= 5
    ) {
      return Math.abs(s2.x - s1.x) <= 25;
    }

    // 3. Standard sequential seat numbering (1, 2, 3...)
    if (s2.number === s1.number + 1) {
      return true;
    }

    return false;
  }
}
