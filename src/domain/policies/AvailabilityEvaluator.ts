import { TicketAvailability, TicketMode, TicketType } from '../entities/EventCatalog';

export interface RawAvailabilitySignals {
  visibleText?: string | undefined;
  isDisabled?: boolean | undefined;
  isAriaDisabled?: boolean | undefined;
  dataAvailability?: string | undefined;
  buttonLabel?: string | undefined;
  isControlEnabled?: boolean | undefined;
  mode?: TicketMode | undefined;
  hasSeatMap?: boolean | undefined;
  availableSeatCount?: number | undefined;
}

export interface AvailabilityEvaluationResult {
  availability: TicketAvailability;
  selectable: boolean;
  evidence: string[];
}

export interface BookingRevalidationSignals {
  isSelectableInBooking: boolean;
  bookingErrorText?: string | undefined;
  isQuantityAvailable?: boolean | undefined;
  isSeatConfirmed?: boolean | undefined;
}

export interface BookingRevalidationResult {
  isConfirmedAvailable: boolean;
  reason?: string | undefined;
  evidence: string[];
}

/**
 * Domain policy evaluating ticket availability from passive evidence.
 * Strictly separates preliminary catalog availability from authoritative booking availability.
 * Enforces: UNKNOWN is NEVER silently converted to AVAILABLE.
 */
export class AvailabilityEvaluator {
  /**
   * Evaluates availability from raw DOM and observable UI signals.
   */
  public static evaluateAvailability(
    signals: RawAvailabilitySignals
  ): AvailabilityEvaluationResult {
    const evidence: string[] = [];
    const textCorpus = [
      signals.visibleText ?? '',
      signals.buttonLabel ?? '',
      signals.dataAvailability ?? '',
    ]
      .join(' ')
      .toLowerCase();

    // 1. Explicit SOLD_OUT signals
    const isSoldOutText =
      textCorpus.includes('hết vé') ||
      textCorpus.includes('sold out') ||
      textCorpus.includes('soldout') ||
      signals.dataAvailability?.toLowerCase() === 'sold_out';

    if (isSoldOutText || (signals.isDisabled && textCorpus.includes('hết'))) {
      evidence.push('EXPLICIT_SOLD_OUT_SIGNAL');
      if (signals.isDisabled) evidence.push('CONTROL_DISABLED');
      return {
        availability: 'SOLD_OUT',
        selectable: false,
        evidence,
      };
    }

    // 2. Explicit NOT_STARTED / COMING_SOON signals
    const isNotStarted =
      textCorpus.includes('sắp mở bán') ||
      textCorpus.includes('coming soon') ||
      textCorpus.includes('chưa mở bán') ||
      textCorpus.includes('mở bán lúc') ||
      textCorpus.includes('sale starts') ||
      signals.dataAvailability?.toLowerCase() === 'not_started';

    if (isNotStarted) {
      evidence.push('EXPLICIT_NOT_STARTED_SIGNAL');
      return {
        availability: 'NOT_STARTED',
        selectable: false,
        evidence,
      };
    }

    // 3. Explicit CLOSED / ENDED signals
    const isClosed =
      textCorpus.includes('đã kết thúc') ||
      textCorpus.includes('closed') ||
      textCorpus.includes('ngừng bán') ||
      textCorpus.includes('tạm đóng') ||
      signals.dataAvailability?.toLowerCase() === 'closed';

    if (isClosed) {
      evidence.push('EXPLICIT_CLOSED_SIGNAL');
      return {
        availability: 'CLOSED',
        selectable: false,
        evidence,
      };
    }

    // 4. Seated / Zone boundary check:
    // The presence of a seated zone is NOT proof that seats are available.
    if (signals.mode === 'SEATED' || signals.mode === 'ZONE') {
      if (signals.hasSeatMap && signals.availableSeatCount !== undefined) {
        if (signals.availableSeatCount <= 0) {
          evidence.push('SEAT_MAP_NO_AVAILABLE_SEATS');
          return {
            availability: 'SOLD_OUT',
            selectable: false,
            evidence,
          };
        } else {
          evidence.push(`SEAT_MAP_SEATS_OBSERVED_${signals.availableSeatCount}`);
        }
      }
    }

    // 5. Explicit AVAILABLE signals
    const hasExplicitSaleSignal =
      textCorpus.includes('đang mở bán') ||
      textCorpus.includes('on sale') ||
      textCorpus.includes('còn vé') ||
      textCorpus.includes('mua ngay') ||
      textCorpus.includes('chọn vé') ||
      signals.dataAvailability?.toLowerCase() === 'available';

    const isControlActive =
      signals.isControlEnabled === true && !signals.isDisabled && !signals.isAriaDisabled;

    if (hasExplicitSaleSignal && isControlActive) {
      evidence.push('EXPLICIT_ON_SALE_SIGNAL');
      evidence.push('CONTROL_ENABLED_ACTIVE');
      return {
        availability: 'AVAILABLE',
        selectable: true,
        evidence,
      };
    }

    if (isControlActive && !signals.isDisabled) {
      // Enabled interactive control without explicit sold out / closed
      evidence.push('INTERACTIVE_CONTROL_ENABLED');
      return {
        availability: 'AVAILABLE',
        selectable: true,
        evidence,
      };
    }

    // 6. Insufficient evidence -> UNKNOWN (NEVER silently converted to AVAILABLE)
    evidence.push('INSUFFICIENT_EVIDENCE_FOR_AVAILABILITY');
    return {
      availability: 'UNKNOWN',
      selectable: false,
      evidence,
    };
  }

  /**
   * Revalidates an event-page catalog ticket after entering the booking flow.
   * Catalog availability is preliminary; transaction availability requires booking revalidation.
   */
  public static revalidateInBooking(
    catalogTicket: TicketType,
    bookingSignals: BookingRevalidationSignals
  ): BookingRevalidationResult {
    const evidence: string[] = [];

    if (!bookingSignals.isSelectableInBooking) {
      evidence.push('BOOKING_SELECTION_CONTROL_DISABLED');
      return {
        isConfirmedAvailable: false,
        reason: bookingSignals.bookingErrorText ?? 'Ticket is not selectable on booking page',
        evidence,
      };
    }

    if (bookingSignals.isQuantityAvailable === false) {
      evidence.push('BOOKING_QUANTITY_NOT_AVAILABLE');
      return {
        isConfirmedAvailable: false,
        reason: 'Selected quantity exceeds available inventory in booking flow',
        evidence,
      };
    }

    if (catalogTicket.mode === 'SEATED' && bookingSignals.isSeatConfirmed === false) {
      evidence.push('BOOKING_SEATED_NOT_CONFIRMED');
      return {
        isConfirmedAvailable: false,
        reason: 'Seat assignment not confirmed in seated zone',
        evidence,
      };
    }

    evidence.push('BOOKING_SELECTION_CONFIRMED_SELECTABLE');
    return {
      isConfirmedAvailable: true,
      evidence,
    };
  }
}
