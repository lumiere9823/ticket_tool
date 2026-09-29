import { BookingSummary, CurrentSelection } from '../entities/BookingJourneyModels';

export interface SummaryVerificationResult {
  isValid: boolean;
  errors: string[];
}

export class BookingSummaryVerifier {
  /**
   * Compares the actual observed BookingSummary against the intended CurrentSelection.
   * Strictly enforces Section 15 and 16:
   * - Ticket name matches
   * - Quantity matches
   * - Subtotal matches expected price * quantity
   * - Seats match expected seats (if seated)
   */
  public static verify(
    summary: BookingSummary | null,
    expected: CurrentSelection
  ): SummaryVerificationResult {
    const errors: string[] = [];

    if (!summary) {
      return {
        isValid: false,
        errors: ['Booking summary panel was not detected on the page'],
      };
    }

    if (summary.items.length === 0) {
      return {
        isValid: false,
        errors: ['Booking summary contains 0 selected items'],
      };
    }

    // Find the item matching expected ticket name
    const cleanExpected = this.cleanString(expected.name);
    const matchedItem = summary.items.find((item) => {
      const cleanActual = this.cleanString(item.ticket);
      return cleanActual === cleanExpected || cleanActual.includes(cleanExpected);
    });

    if (!matchedItem) {
      errors.push(
        `Summary ticket name mismatch. Expected ticket '${expected.name}' not found in summary items: ${summary.items
          .map((i) => `'${i.ticket}'`)
          .join(', ')}`
      );
    } else {
      // Quantity check
      if (matchedItem.quantity !== expected.quantity) {
        if (
          expected.allowPartialQuantity &&
          matchedItem.quantity > 0 &&
          matchedItem.quantity < expected.quantity
        ) {
          // Partial quantity allowed by user configuration
        } else {
          errors.push(
            `Summary quantity mismatch for '${expected.name}'. Expected ${expected.quantity}, but summary has ${matchedItem.quantity}`
          );
        }
      }

      // Seats check if seated
      if (expected.mode === 'SEATED' && expected.seats && expected.seats.length > 0) {
        if (matchedItem.seats && matchedItem.seats.length > 0) {
          const expectedSeatsClean = expected.seats.map((s) => s.toUpperCase());
          const actualSeatsClean = matchedItem.seats.map((s) => s.toUpperCase());
          for (const seat of expectedSeatsClean) {
            if (!actualSeatsClean.includes(seat)) {
              errors.push(
                `Expected seat '${seat}' not confirmed in booking summary: [${actualSeatsClean.join(', ')}]`
              );
            }
          }
        }
      }
    }

    // Subtotal check
    const effectiveQty =
      expected.allowPartialQuantity && matchedItem && matchedItem.quantity < expected.quantity
        ? matchedItem.quantity
        : expected.quantity;
    const expectedSubtotal = expected.price * effectiveQty;
    if (summary.subtotal > 0 && Math.abs(summary.subtotal - expectedSubtotal) > 1) {
      errors.push(
        `Summary subtotal mismatch. Expected ${expectedSubtotal} ${expected.currency}, but summary shows ${summary.subtotal} ${summary.currency}`
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private static cleanString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
