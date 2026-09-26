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
  RESERVING = 'RESERVING',
  HELD = 'HELD',
  CHECKOUT = 'CHECKOUT',
  PAYMENT = 'PAYMENT',
  CONFIRMED = 'CONFIRMED',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
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
  UNKNOWN = 'UNKNOWN',
}

/**
 * State Transition Events.
 */
export type StateTransitionEvent =
  | { type: 'EXTENSION_READY' }
  | { type: 'AUTHENTICATED' }
  | { type: 'AUTH_FAILED'; reason: FailureReason.SESSION_EXPIRED | FailureReason.UNKNOWN }
  | { type: 'EVENT_READY' }
  | { type: 'EVENT_FAILED'; reason: FailureReason.SOLD_OUT | FailureReason.UNKNOWN }
  | { type: 'ARM' }
  | { type: 'DISARM' }
  | { type: 'MONITORING_STARTED' }
  | { type: 'INVENTORY_AVAILABLE' }
  | { type: 'CANDIDATE_FOUND' }
  | { type: 'NO_CANDIDATE_AVAILABLE' }
  | { type: 'RESERVATION_INITIATED' }
  | { type: 'RESERVATION_SERVER_CONFIRMED'; reservationId: string; expiresAt?: string | undefined }
  | { type: 'RESERVATION_REJECTED'; reason: FailureReason }
  | { type: 'CHECKOUT_OPENED' }
  | { type: 'PAYMENT_STARTED' }
  | { type: 'PAYMENT_CONFIRMED' }
  | { type: 'FAILURE_OCCURRED'; reason: FailureReason; message?: string | undefined }
  | { type: 'STOP_REQUESTED'; reason?: string | undefined }
  | { type: 'RESET_REQUESTED' };

/**
 * Snapshot of current state machine context.
 */
export interface StateContext {
  currentState: PurchaseState;
  previousState?: PurchaseState | undefined;
  attemptId?: string | undefined;
  failureReason?: FailureReason | undefined;
  failureMessage?: string | undefined;
  updatedAt: string;
}
