import { PurchaseState } from '../states/PurchaseState';

export type BookingErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'SHOWING_NOT_FOUND'
  | 'NO_TICKETS'
  | 'NO_AVAILABLE_TICKET'
  | 'TICKET_SELECTION_FAILED'
  | 'BOOKING_MODE_UNKNOWN'
  | 'QUANTITY_CONTROL_NOT_FOUND'
  | 'QUANTITY_LIMIT_EXCEEDED'
  | 'AREA_SELECTION_FAILED'
  | 'SEAT_MAP_NOT_FOUND'
  | 'NO_AVAILABLE_SEATS'
  | 'SEAT_SELECTION_FAILED'
  | 'SUMMARY_MISMATCH'
  | 'FORM_NOT_FOUND'
  | 'REQUIRED_FIELD_MISSING'
  | 'CONSENT_REQUIRED'
  | 'PAYMENT_REQUIRED'
  | 'PAGE_CHANGED'
  | 'STALE_ELEMENT'
  | 'PROCEED_FAILED'
  | 'SEAT_UNAVAILABLE'
  | 'ALL_AREAS_EXHAUSTED'
  | 'UNSUPPORTED_FLOW';

export class BookingError extends Error {
  public readonly code: BookingErrorCode;
  public readonly state: PurchaseState;
  public readonly evidence: Record<string, unknown>;
  public readonly recoverable: boolean;

  constructor(params: {
    code: BookingErrorCode;
    message: string;
    state: PurchaseState;
    evidence?: Record<string, unknown> | undefined;
    recoverable?: boolean | undefined;
  }) {
    super(params.message);
    this.name = 'BookingError';
    this.code = params.code;
    this.state = params.state;
    this.evidence = params.evidence ?? {};
    this.recoverable = params.recoverable ?? false;
    Object.setPrototypeOf(this, BookingError.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      state: this.state,
      evidence: this.evidence,
      recoverable: this.recoverable,
    };
  }
}
