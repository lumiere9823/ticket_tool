/**
 * Authoritative lifecycle states for Ticketbox Purchase Assistant.
 * Strictly defined according to docs/ticketbox/04-state-machine.md and ADR-002.
 */
export enum PurchaseState {
  INIT = 'INIT',
  AUTH_CHECK = 'AUTH_CHECK',
  EVENT_CHECK = 'EVENT_CHECK',
  READY = 'READY',
  ARMED = 'ARMED',
  MONITORING = 'MONITORING',
  AVAILABLE_DETECTED = 'AVAILABLE_DETECTED',
  SELECTING = 'SELECTING',
  TICKET_TYPE_SELECTION = 'TICKET_TYPE_SELECTION',
  QUANTITY_SELECTION = 'QUANTITY_SELECTION',
  SEAT_SELECTION = 'SEAT_SELECTION',
  RESERVING = 'RESERVING',
  HELD = 'HELD',
  CHECKOUT = 'CHECKOUT',
  PAYMENT = 'PAYMENT',
  CONFIRMED = 'CONFIRMED',

  // Booking Journey States (Section 22)
  IDLE = 'IDLE',
  EVENT_DETECTED = 'EVENT_DETECTED',
  SHOWING_DETECTED = 'SHOWING_DETECTED',
  TICKETS_DETECTED = 'TICKETS_DETECTED',
  EVALUATING_TICKETS = 'EVALUATING_TICKETS',
  TICKET_SELECTED = 'TICKET_SELECTED',
  BOOKING_MODE_DETECTED = 'BOOKING_MODE_DETECTED',
  SELECTING_QUANTITY = 'SELECTING_QUANTITY',
  AREA_SELECTION_REQUIRED = 'AREA_SELECTION_REQUIRED',
  SELECTING_AREA = 'SELECTING_AREA',
  SEAT_MAP_DETECTED = 'SEAT_MAP_DETECTED',
  SELECTING_SEATS = 'SELECTING_SEATS',
  SEATS_SELECTED = 'SEATS_SELECTED',
  BOOKING_SUMMARY_DETECTED = 'BOOKING_SUMMARY_DETECTED',
  QUESTION_FORM_DETECTED = 'QUESTION_FORM_DETECTED',
  FILLING_ATTENDEE_FORM = 'FILLING_ATTENDEE_FORM',
  FORM_VALIDATED = 'FORM_VALIDATED',
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  PAYMENT_GATE = 'PAYMENT_GATE',
  CONFIRMATION_PENDING = 'CONFIRMATION_PENDING',
  WAITING = 'WAITING',
  WAITING_FOR_STOCK = 'WAITING_FOR_STOCK',
  RETRYING_TARGET = 'RETRYING_TARGET',

  // Human Intervention States (Automation Paused, NOT failed)
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
  OTP_REQUIRED = 'OTP_REQUIRED',
  PAYMENT_ACTION_REQUIRED = 'PAYMENT_ACTION_REQUIRED',
  SESSION_REAUTH_REQUIRED = 'SESSION_REAUTH_REQUIRED',
  UNKNOWN_SECURITY_CHALLENGE = 'UNKNOWN_SECURITY_CHALLENGE',
  HUMAN_INTERVENTION_REQUIRED = 'HUMAN_INTERVENTION_REQUIRED',

  // Transitional State Verification
  STATE_RECHECK = 'STATE_RECHECK',

  // Failure & Terminal States
  STOPPED = 'STOPPED',
  STOPPED_LIMIT_REACHED = 'STOPPED_LIMIT_REACHED',
  STOPPED_NO_TARGET = 'STOPPED_NO_TARGET',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  RATE_LIMITED = 'RATE_LIMITED',
  SOLD_OUT = 'SOLD_OUT',
  INVALID_SELECTION = 'INVALID_SELECTION',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RESERVATION_FAILED = 'RESERVATION_FAILED',
  CHECKOUT_FAILED = 'CHECKOUT_FAILED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  AUTH_FAILURE = 'AUTH_FAILURE',
}

/**
 * Checks if a state represents a human intervention condition where automation is paused.
 */
export function isHumanInterventionState(state: PurchaseState): boolean {
  return (
    state === PurchaseState.CAPTCHA_REQUIRED ||
    state === PurchaseState.OTP_REQUIRED ||
    state === PurchaseState.PAYMENT_ACTION_REQUIRED ||
    state === PurchaseState.SESSION_REAUTH_REQUIRED ||
    state === PurchaseState.UNKNOWN_SECURITY_CHALLENGE ||
    state === PurchaseState.HUMAN_INTERVENTION_REQUIRED ||
    state === PurchaseState.CONSENT_REQUIRED ||
    state === PurchaseState.PAYMENT_GATE
  );
}

/**
 * Checks if a state is terminal for a purchase attempt.
 */
export function isTerminalState(state: PurchaseState): boolean {
  return (
    state === PurchaseState.CONFIRMED ||
    state === PurchaseState.STOPPED ||
    state === PurchaseState.STOPPED_LIMIT_REACHED ||
    state === PurchaseState.STOPPED_NO_TARGET ||
    state === PurchaseState.FAILED
  );
}

/**
 * Explicit failure reasons categorizing why a flow reached FAILED.
 */
export enum FailureReason {
  SOLD_OUT = 'SOLD_OUT',
  INVALID_SELECTION = 'INVALID_SELECTION',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  RESERVATION_FAILED = 'RESERVATION_FAILED',
  CHECKOUT_FAILED = 'CHECKOUT_FAILED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  AUTH_FAILURE = 'AUTH_FAILURE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Observational Evidence gathered from passive discovery.
 * Observation alone MUST NEVER authorize HELD or CONFIRMED state.
 */
export interface ObservationEvidence {
  observationId: string;
  observedAt: string;
  pageUrl: string;
  pageTitle: string;
  hasInventoryCandidate: boolean;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Authoritative Server Evidence for critical boundaries.
 */
export interface ReservationEvidence {
  reservationId: string;
  expiresAt?: string | undefined;
  holdId?: string | undefined;
  checkoutReference?: string | undefined;
  serverConfirmedAt?: string | undefined;
}

export interface PaymentConfirmationEvidence {
  orderId?: string | undefined;
  confirmationReference?: string | undefined;
  ticketId?: string | undefined;
  confirmedAt?: string | undefined;
}

/**
 * State Transition Events.
 * Strictly implements docs/ticketbox/04-state-machine.md Section 50.
 */
export type StateTransitionEvent =
  | { type: 'EXTENSION_READY' }
  | { type: 'AUTHENTICATED' }
  | { type: 'NOT_AUTHENTICATED' }
  | {
      type: 'AUTH_FAILED';
      reason: FailureReason.SESSION_EXPIRED | FailureReason.AUTH_FAILURE | FailureReason.UNKNOWN;
    }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'EVENT_READY' }
  | { type: 'EVENT_NOT_OPEN' }
  | { type: 'EVENT_FAILED'; reason: FailureReason.SOLD_OUT | FailureReason.UNKNOWN }
  | { type: 'ARM' }
  | { type: 'DISARM' }
  | { type: 'MONITORING_STARTED' }
  | { type: 'INVENTORY_AVAILABLE' }
  | { type: 'CANDIDATE_FOUND' }
  | { type: 'NO_CANDIDATE_AVAILABLE' }
  | { type: 'TICKET_TYPE_REQUIRED' }
  | { type: 'QUANTITY_REQUIRED' }
  | { type: 'SEAT_SELECTION_REQUIRED' }
  | { type: 'SELECTION_COMPLETED' }
  | { type: 'SEAT_UNAVAILABLE' }
  | { type: 'INVALID_SELECTION'; reason?: FailureReason }
  | { type: 'RESERVATION_INITIATED' }
  | {
      type: 'RESERVATION_SERVER_CONFIRMED';
      reservationId: string;
      expiresAt?: string | undefined;
      evidence?: ReservationEvidence | undefined;
    }
  | { type: 'RESERVATION_REJECTED'; reason: FailureReason; message?: string | undefined }
  | { type: 'CHECKOUT_OPENED' }
  | { type: 'CHECKOUT_FAILED'; reason?: FailureReason; message?: string | undefined }
  | { type: 'PAYMENT_STARTED' }
  | {
      type: 'PAYMENT_CONFIRMED';
      orderId?: string | undefined;
      confirmationReference?: string | undefined;
      evidence?: PaymentConfirmationEvidence | undefined;
    }
  | { type: 'PAYMENT_FAILED'; reason?: FailureReason; message?: string | undefined }
  | { type: 'PAYMENT_TIMEOUT'; message?: string | undefined }
  | { type: 'RATE_LIMITED' }
  // Booking Journey Events
  | { type: 'EVENT_DETECTED'; eventId?: string | undefined; eventTitle?: string | undefined }
  | { type: 'SHOWING_DETECTED'; showingId?: string | undefined; date?: string | undefined }
  | { type: 'TICKETS_DETECTED'; ticketCount?: number | undefined }
  | { type: 'EVALUATING_TICKETS' }
  | {
      type: 'TICKET_SELECTED';
      ticketId?: string | undefined;
      ticketName?: string | undefined;
      price?: number | undefined;
    }
  | {
      type: 'BOOKING_MODE_DETECTED';
      mode: 'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN';
    }
  | { type: 'SELECTING_QUANTITY'; quantity?: number | undefined }
  | { type: 'AREA_SELECTION_REQUIRED' }
  | { type: 'SELECTING_AREA'; areaId?: string | undefined; areaName?: string | undefined }
  | { type: 'SEAT_MAP_DETECTED' }
  | { type: 'SELECTING_SEATS' }
  | { type: 'SEATS_SELECTED'; seats: string[] }
  | { type: 'BOOKING_SUMMARY_DETECTED'; summary?: Record<string, unknown> | undefined }
  | { type: 'QUESTION_FORM_DETECTED'; fieldCount?: number | undefined }
  | { type: 'FILLING_ATTENDEE_FORM' }
  | { type: 'FORM_VALIDATED' }
  | { type: 'CONSENT_REQUIRED'; consentLabel?: string | undefined }
  | { type: 'PAYMENT_GATE' }
  | { type: 'CONFIRMATION_PENDING' }
  | { type: 'WAITING'; reason?: string | undefined }
  | { type: 'WAITING_FOR_STOCK'; reason?: string | undefined }
  | { type: 'RETRY_TARGET'; reason?: string | undefined; nextTarget?: string | undefined }
  | { type: 'UNSUPPORTED_FLOW'; reason?: string | undefined }
  // Human Intervention Trigger Events
  | { type: 'CAPTCHA_REQUIRED'; challengeId?: string | undefined }
  | { type: 'OTP_REQUIRED'; verificationMethod?: string | undefined }
  | { type: 'PAYMENT_ACTION_REQUIRED'; actionType?: string | undefined }
  | { type: 'SESSION_REAUTH_REQUIRED'; reason?: string | undefined }
  | { type: 'UNKNOWN_SECURITY_CHALLENGE'; description?: string | undefined }
  | { type: 'SECURITY_CHALLENGE_DETECTED'; challengeType?: string | undefined }
  // Human Intervention Resume Events
  | { type: 'USER_COMPLETED_CHALLENGE' }
  | { type: 'HUMAN_INTERVENTION_RESOLVED'; challengeId?: string | undefined }
  | { type: 'STATE_VERIFIED'; verifiedState: PurchaseState }
  | { type: 'STATE_UNVERIFIED'; reason?: string | undefined }
  // Universal Control Events
  | { type: 'FAILURE_OCCURRED'; reason: FailureReason; message?: string | undefined }
  | { type: 'LIMIT_REACHED'; reason?: string | undefined }
  | { type: 'NO_TARGET_AVAILABLE'; reason?: string | undefined }
  | { type: 'STOP_REQUESTED'; reason?: string | undefined }
  | { type: 'RESET_REQUESTED' };

/**
 * Snapshot of current state machine context.
 * Strictly conforms to 04-state-machine.md Section 56 and 08-security-and-compliance.md Section 17.
 * FORBIDDEN: password, OTP, CVV, payment secrets, raw cookies, session tokens.
 */
export interface StateContext {
  currentState: PurchaseState;
  previousState?: PurchaseState | undefined;
  attemptId?: string | undefined;
  workflowId?: string | undefined;
  accountId?: string | undefined;
  profileId?: string | undefined;
  eventId?: string | undefined;
  retryCount?: number | undefined;
  failureReason?: FailureReason | undefined;
  failureMessage?: string | undefined;
  humanInterventionId?: string | undefined;
  transitionEvent?: string | undefined;
  evidence?: Record<string, unknown> | undefined;
  updatedAt: string;
}
