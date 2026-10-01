import { BookingSummary, CurrentSelection, SummaryItem } from '../entities/BookingJourneyModels';

export interface SummaryVerificationResult {
  isValid: boolean;
  errors: string[];
}

export class BookingSummaryVerifier {
  /**
   * Compares the actual observed BookingSummary against the intended CurrentSelection.
   * Strictly enforces Section 15 and 16 (fail-closed):
   * - Ticket name matches (exact normalized or word-boundary delimited, no compound overrides)
   * - No unexpected extra items in summary
   * - Quantity matches
   * - Subtotal matches expected price * quantity (> 0 for paid tickets)
   * - Currency matches
   * - Item price matches (> 0 for paid tickets)
   * - Seats match expected seats (if seated) with exact seat count
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

    // 1. Currency check
    if (expected.currency && summary.currency) {
      if (expected.currency.trim().toUpperCase() !== summary.currency.trim().toUpperCase()) {
        errors.push(
          `Summary currency mismatch. Expected '${expected.currency}', but summary shows '${summary.currency}'`
        );
      }
    }

    // 2. Extra items check (Fail-closed: unexpected items in summary)
    const matchingItems: SummaryItem[] = [];
    const unexpectedItems: SummaryItem[] = [];

    for (const item of summary.items) {
      if (this.isTicketNameMatch(item.ticket, expected.name, expected.ticketId)) {
        matchingItems.push(item);
      } else {
        unexpectedItems.push(item);
      }
    }

    if (matchingItems.length === 0) {
      errors.push(
        `Summary ticket name mismatch. Expected ticket '${expected.name}' not found in summary items: ${summary.items
          .map((i) => `'${i.ticket}'`)
          .join(', ')}`
      );
      return { isValid: false, errors };
    }

    if (unexpectedItems.length > 0) {
      errors.push(
        `Unexpected items in booking summary: ${unexpectedItems.map((i) => `'${i.ticket}'`).join(', ')}. Expected only items matching '${expected.name}'`
      );
    }

    if (matchingItems.length > 1) {
      errors.push(
        `Summary contains multiple matching items (${matchingItems.length}) for single ticket selection '${expected.name}'`
      );
    }

    const matchedItem = matchingItems[0]!;

    // 3. Item price check (Fail-closed: missing or <= 0 price for paid tickets)
    if (expected.price > 0) {
      if (matchedItem.price === undefined || matchedItem.price === null || matchedItem.price <= 0) {
        errors.push(
          `Summary item price must be greater than 0 for paid ticket '${expected.name}' (got ${matchedItem.price})`
        );
      } else if (Math.abs(matchedItem.price - expected.price) > 1) {
        errors.push(
          `Summary item price mismatch for '${expected.name}'. Expected ${expected.price}, but got ${matchedItem.price}`
        );
      }
    }

    // 4. Quantity check
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

    const effectiveQty =
      expected.allowPartialQuantity && matchedItem.quantity < expected.quantity
        ? matchedItem.quantity
        : expected.quantity;

    // 5. Seats check if seated
    if (expected.mode === 'SEATED') {
      if (!matchedItem.seats || matchedItem.seats.length === 0) {
        errors.push(
          `Summary is missing seat list for seated ticket '${expected.name}'. Expected ${effectiveQty} seats.`
        );
      } else {
        if (matchedItem.seats.length !== effectiveQty) {
          errors.push(
            `Summary seats count (${matchedItem.seats.length}) does not match expected quantity (${effectiveQty})`
          );
        }

        if (expected.seats && expected.seats.length > 0) {
          const expectedSeatsClean = expected.seats.map((s) => s.trim().toUpperCase());
          const actualSeatsClean = matchedItem.seats.map((s) => s.trim().toUpperCase());
          for (const seat of expectedSeatsClean) {
            if (!actualSeatsClean.includes(seat)) {
              errors.push(
                `Expected seat '${seat}' not confirmed in booking summary: [${actualSeatsClean.join(', ')}]`
              );
            }
          }
          for (const seat of actualSeatsClean) {
            if (!expectedSeatsClean.includes(seat)) {
              errors.push(
                `Unexpected seat '${seat}' in booking summary not present in expected selection: [${expectedSeatsClean.join(', ')}]`
              );
            }
          }
        }
      }
    }

    // 6. Subtotal check (Fail-closed: subtotal <= 0 for paid tickets)
    const expectedSubtotal = expected.price * effectiveQty;
    if (expectedSubtotal > 0) {
      if (summary.subtotal <= 0) {
        errors.push(
          `Summary subtotal must be greater than 0 for paid ticket (got ${summary.subtotal})`
        );
      } else if (Math.abs(summary.subtotal - expectedSubtotal) > 1) {
        errors.push(
          `Summary subtotal mismatch. Expected ${expectedSubtotal} ${expected.currency}, but summary shows ${summary.subtotal} ${summary.currency}`
        );
      }
    } else {
      if (Math.abs(summary.subtotal - expectedSubtotal) > 1) {
        errors.push(
          `Summary subtotal mismatch. Expected ${expectedSubtotal} ${expected.currency}, but summary shows ${summary.subtotal} ${summary.currency}`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  public static isTicketNameMatch(
    actual: string,
    expected: string,
    expectedId?: string | null
  ): boolean {
    const cleanActual = this.cleanString(actual);
    const cleanExpected = this.cleanString(expected);

    if (cleanActual === cleanExpected) return true;
    if (expectedId && cleanActual === this.cleanString(expectedId)) return true;

    const stripPrefix = (s: string) =>
      s.replace(/^(?:ve|hang ve|loai ve|ticket|ticket tier)\s+/i, '').trim();
    const strippedActual = stripPrefix(cleanActual);
    const strippedExpected = stripPrefix(cleanExpected);

    if (strippedActual === strippedExpected) return true;

    // Word boundary match:
    // Only allow if actual starts with expected followed by boundary delimiter like "-", "–", "/", "(",
    // and does NOT contain compound tier modifiers like "plus", "pro", "super", "ultra", etc.
    const escaped = strippedExpected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundaryRegex = new RegExp(`^${escaped}(?:\\s*[-–—/]\\s*|\\s*\\().*`, 'i');
    if (boundaryRegex.test(strippedActual)) {
      const suffix = strippedActual.slice(strippedExpected.length).trim();
      const hasTierModifier = /\b(?:plus|pro|gold|diamond|super|ultra|premium|max)\b/i.test(suffix);
      if (!hasTierModifier) {
        return true;
      }
    }

    return false;
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
