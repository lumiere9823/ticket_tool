import {
  PurchaseState,
  FailureReason,
  StateTransitionEvent,
  StateContext,
  ReservationEvidence,
  PaymentConfirmationEvidence,
  isHumanInterventionState,
  isTerminalState,
} from '../states/PurchaseState';
import { StateTransitionError } from '../errors/DomainError';

export type StateChangeListener = (context: StateContext) => void;

type TransitionResult = PurchaseState | StateContext;

type TransitionHandler = (
  sm: PurchaseStateMachine,
  event: StateTransitionEvent,
  from: PurchaseState
) => TransitionResult;

type TransitionRule = PurchaseState | TransitionHandler;

const ALLOWED_RETRY_STATES = new Set<PurchaseState>([
  PurchaseState.MONITORING,
  PurchaseState.WAITING,
  PurchaseState.WAITING_FOR_STOCK,
  PurchaseState.EVALUATING_TICKETS,
  PurchaseState.SELECTING,
  PurchaseState.TICKET_SELECTED,
  PurchaseState.AVAILABLE_DETECTED,
  PurchaseState.TICKETS_DETECTED,
  PurchaseState.TICKET_TYPE_SELECTION,
  PurchaseState.QUANTITY_SELECTION,
  PurchaseState.SELECTING_QUANTITY,
  PurchaseState.AREA_SELECTION_REQUIRED,
  PurchaseState.SELECTING_AREA,
  PurchaseState.SEAT_SELECTION,
  PurchaseState.SEAT_MAP_DETECTED,
  PurchaseState.SELECTING_SEATS,
  PurchaseState.SEATS_SELECTED,
  PurchaseState.BOOKING_MODE_DETECTED,
  PurchaseState.BOOKING_SUMMARY_DETECTED,
  PurchaseState.QUESTION_FORM_DETECTED,
  PurchaseState.FILLING_ATTENDEE_FORM,
  PurchaseState.FORM_VALIDATED,
  PurchaseState.RESERVING,
]);

const ALLOWED_RESET_STATES = new Set<PurchaseState>([
  PurchaseState.STOPPED,
  PurchaseState.STOPPED_LIMIT_REACHED,
  PurchaseState.STOPPED_NO_TARGET,
  PurchaseState.WAITING_FOR_STOCK,
  PurchaseState.RETRYING_TARGET,
  PurchaseState.HUMAN_INTERVENTION_REQUIRED,
  PurchaseState.WAITING,
  PurchaseState.FAILED,
  PurchaseState.CONFIRMED,
  PurchaseState.UNKNOWN,
  PurchaseState.RATE_LIMITED,
  PurchaseState.SOLD_OUT,
  PurchaseState.INVALID_SELECTION,
  PurchaseState.RESERVATION_FAILED,
  PurchaseState.CHECKOUT_FAILED,
  PurchaseState.PAYMENT_FAILED,
  PurchaseState.AUTH_FAILURE,
  PurchaseState.ARMED,
  PurchaseState.MONITORING,
  PurchaseState.READY,
  PurchaseState.IDLE,
]);

const handleEventDetected: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'EVENT_DETECTED' }>;
  if (ev.eventId) sm.setEventId(ev.eventId);
  return PurchaseState.EVENT_DETECTED;
};

const handleAuthFailed: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'AUTH_FAILED' }>;
  sm.setFailureReason(ev.reason);
  if (ev.reason === FailureReason.SESSION_EXPIRED) {
    return PurchaseState.SESSION_REAUTH_REQUIRED;
  }
  return PurchaseState.FAILED;
};

const handleEventFailed: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'EVENT_FAILED' }>;
  sm.setFailureReason(ev.reason);
  return PurchaseState.FAILED;
};

const handleInvalidSelection: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'INVALID_SELECTION' }>;
  sm.setFailureReason(ev.reason ?? FailureReason.INVALID_SELECTION);
  return PurchaseState.INVALID_SELECTION;
};

const handleSeatUnavailable: TransitionHandler = (sm) => {
  sm.setFailureReason(FailureReason.SOLD_OUT);
  return PurchaseState.SOLD_OUT;
};

const handleRateLimited: TransitionHandler = (sm) => {
  sm.setFailureReason(FailureReason.RATE_LIMITED);
  return PurchaseState.RATE_LIMITED;
};

const handleReservationServerConfirmed: TransitionHandler = (sm, event, from) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'RESERVATION_SERVER_CONFIRMED' }>;
  if (!ev.reservationId || ev.reservationId.trim() === '') {
    throw new StateTransitionError(
      from,
      PurchaseState.HELD,
      ev.type,
      'Cannot transition to HELD without authoritative server reservationId'
    );
  }
  const evidenceObj: ReservationEvidence = {
    reservationId: ev.reservationId.trim(),
    ...(ev.expiresAt ? { expiresAt: ev.expiresAt } : {}),
    ...(ev.evidence?.holdId ? { holdId: ev.evidence.holdId } : {}),
    ...(ev.evidence?.checkoutReference ? { checkoutReference: ev.evidence.checkoutReference } : {}),
    serverConfirmedAt: new Date().toISOString(),
  };
  sm.setEvidence(evidenceObj as unknown as Record<string, unknown>);
  return PurchaseState.HELD;
};

const handleReservationRejected: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'RESERVATION_REJECTED' }>;
  sm.setFailureReason(ev.reason);
  if (ev.message) sm.setFailureMessage(ev.message);
  return PurchaseState.FAILED;
};

const handleCheckoutFailed: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'CHECKOUT_FAILED' }>;
  sm.setFailureReason(ev.reason ?? FailureReason.CHECKOUT_FAILED);
  if (ev.message) sm.setFailureMessage(ev.message);
  return PurchaseState.CHECKOUT_FAILED;
};

const handlePaymentConfirmed: TransitionHandler = (sm, event, from) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'PAYMENT_CONFIRMED' }>;
  const evidenceObj = sm.requirePaymentEvidence(from, ev);
  sm.setEvidence(evidenceObj as unknown as Record<string, unknown>);
  return PurchaseState.CONFIRMED;
};

const handlePaymentFailed: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'PAYMENT_FAILED' }>;
  sm.setFailureReason(ev.reason ?? FailureReason.PAYMENT_FAILED);
  if (ev.message) sm.setFailureMessage(ev.message);
  return PurchaseState.PAYMENT_FAILED;
};

const handlePaymentTimeout: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'PAYMENT_TIMEOUT' }>;
  sm.setFailureReason(FailureReason.PAYMENT_FAILED);
  sm.setFailureMessage(ev.message ?? 'Payment timed out');
  return PurchaseState.PAYMENT_FAILED;
};

const handleStateVerified: TransitionHandler = (sm, event, from) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'STATE_VERIFIED' }>;
  const target = ev.verifiedState;

  const forbiddenVerifiedStates = new Set<PurchaseState>([
    PurchaseState.HELD,
    PurchaseState.CONFIRMED,
    PurchaseState.PAYMENT,
    PurchaseState.CHECKOUT,
    PurchaseState.RESERVING,
    PurchaseState.PAYMENT_GATE,
  ]);

  if (forbiddenVerifiedStates.has(target)) {
    throw new StateTransitionError(
      from,
      target,
      ev.type,
      `STATE_RECHECK cannot directly authorize '${target}'. Authoritative server evidence is required.`
    );
  }

  if (
    sm.previousState === PurchaseState.SESSION_REAUTH_REQUIRED &&
    target !== PurchaseState.AUTH_CHECK
  ) {
    throw new StateTransitionError(
      from,
      target,
      ev.type,
      'Re-authentication recovery must route through AUTH_CHECK for authoritative session verification'
    );
  }

  const preIntervention = sm.preInterventionState ?? sm.previousState;
  const isAllowedTarget =
    target === PurchaseState.MONITORING ||
    target === PurchaseState.READY ||
    target === preIntervention;

  if (!isAllowedTarget) {
    throw new StateTransitionError(
      from,
      target,
      ev.type,
      `STATE_RECHECK can only verify previous state ('${preIntervention}') or MONITORING/READY. Target '${target}' is not permitted.`
    );
  }

  sm.clearPreInterventionState();
  return target;
};

const handleStateUnverified: TransitionHandler = (sm, event) => {
  const ev = event as Extract<StateTransitionEvent, { type: 'STATE_UNVERIFIED' }>;
  sm.setFailureReason(FailureReason.UNKNOWN);
  sm.setFailureMessage(ev.reason ?? 'State re-evaluation failed to verify safe application state');
  sm.clearPreInterventionState();
  return PurchaseState.UNKNOWN;
};

const handleNoOp: TransitionHandler = (sm) => {
  return sm.getContext();
};

const humanInterventionResumeRules: Partial<Record<StateTransitionEvent['type'], TransitionRule>> =
  {
    HUMAN_INTERVENTION_RESOLVED: PurchaseState.STATE_RECHECK,
    USER_COMPLETED_CHALLENGE: PurchaseState.STATE_RECHECK,
  };

const TRANSITION_TABLE: Partial<
  Record<PurchaseState, Partial<Record<StateTransitionEvent['type'], TransitionRule>>>
> = {
  [PurchaseState.INIT]: {
    EXTENSION_READY: PurchaseState.AUTH_CHECK,
  },

  [PurchaseState.AUTH_CHECK]: {
    AUTHENTICATED: PurchaseState.EVENT_CHECK,
    NOT_AUTHENTICATED: PurchaseState.SESSION_REAUTH_REQUIRED,
    SESSION_EXPIRED: PurchaseState.SESSION_REAUTH_REQUIRED,
    AUTH_FAILED: handleAuthFailed,
  },

  [PurchaseState.EVENT_CHECK]: {
    EVENT_READY: PurchaseState.READY,
    EVENT_NOT_OPEN: PurchaseState.READY,
    EVENT_FAILED: handleEventFailed,
  },

  [PurchaseState.READY]: {
    ARM: PurchaseState.ARMED,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    MONITORING_STARTED: PurchaseState.MONITORING,
  },

  [PurchaseState.IDLE]: {
    ARM: PurchaseState.ARMED,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    MONITORING_STARTED: PurchaseState.MONITORING,
  },

  [PurchaseState.ARMED]: {
    DISARM: PurchaseState.READY,
    MONITORING_STARTED: PurchaseState.MONITORING,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.MONITORING]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    INVENTORY_AVAILABLE: PurchaseState.AVAILABLE_DETECTED,
    EVALUATING_TICKETS: PurchaseState.EVALUATING_TICKETS,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
    CAPTCHA_REQUIRED: PurchaseState.CAPTCHA_REQUIRED,
    SESSION_EXPIRED: PurchaseState.SESSION_REAUTH_REQUIRED,
    RATE_LIMITED: handleRateLimited,
  },

  [PurchaseState.WAITING]: {
    MONITORING_STARTED: PurchaseState.MONITORING,
    EVALUATING_TICKETS: PurchaseState.EVALUATING_TICKETS,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    INVENTORY_AVAILABLE: PurchaseState.AVAILABLE_DETECTED,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
  },

  [PurchaseState.WAITING_FOR_STOCK]: {
    MONITORING_STARTED: PurchaseState.MONITORING,
    EVALUATING_TICKETS: PurchaseState.EVALUATING_TICKETS,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    INVENTORY_AVAILABLE: PurchaseState.AVAILABLE_DETECTED,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
  },

  [PurchaseState.RETRYING_TARGET]: {
    MONITORING_STARTED: PurchaseState.MONITORING,
    EVALUATING_TICKETS: PurchaseState.EVALUATING_TICKETS,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    CANDIDATE_FOUND: PurchaseState.SELECTING,
    INVENTORY_AVAILABLE: PurchaseState.AVAILABLE_DETECTED,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
  },

  [PurchaseState.EVENT_DETECTED]: {
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    MONITORING_STARTED: PurchaseState.MONITORING,
  },

  [PurchaseState.SHOWING_DETECTED]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    INVENTORY_AVAILABLE: PurchaseState.AVAILABLE_DETECTED,
  },

  [PurchaseState.TICKETS_DETECTED]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    EVALUATING_TICKETS: PurchaseState.EVALUATING_TICKETS,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    CANDIDATE_FOUND: PurchaseState.SELECTING,
    WAITING: PurchaseState.WAITING,
  },

  [PurchaseState.EVALUATING_TICKETS]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    CANDIDATE_FOUND: PurchaseState.SELECTING,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
    NO_CANDIDATE_AVAILABLE: PurchaseState.MONITORING,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.AVAILABLE_DETECTED]: {
    CANDIDATE_FOUND: PurchaseState.SELECTING,
    NO_CANDIDATE_AVAILABLE: PurchaseState.MONITORING,
  },

  [PurchaseState.SELECTING]: {
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    TICKET_TYPE_REQUIRED: PurchaseState.TICKET_TYPE_SELECTION,
    QUANTITY_REQUIRED: PurchaseState.SELECTING_QUANTITY,
    SELECTING_QUANTITY: PurchaseState.SELECTING_QUANTITY,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    RESERVATION_INITIATED: PurchaseState.RESERVING,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.TICKET_SELECTED]: {
    TICKET_SELECTED: handleNoOp,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    BOOKING_MODE_DETECTED: PurchaseState.BOOKING_MODE_DETECTED,
    SELECTING_QUANTITY: PurchaseState.SELECTING_QUANTITY,
    QUANTITY_REQUIRED: PurchaseState.SELECTING_QUANTITY,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.BOOKING_MODE_DETECTED]: {
    SELECTING_QUANTITY: PurchaseState.SELECTING_QUANTITY,
    QUANTITY_REQUIRED: PurchaseState.SELECTING_QUANTITY,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.TICKET_TYPE_SELECTION]: {
    QUANTITY_REQUIRED: PurchaseState.QUANTITY_SELECTION,
    SELECTING_QUANTITY: PurchaseState.QUANTITY_SELECTION,
    SEAT_SELECTION_REQUIRED: PurchaseState.SEAT_SELECTION,
    SELECTING_SEATS: PurchaseState.SEAT_SELECTION,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.QUANTITY_SELECTION]: {
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    FILLING_ATTENDEE_FORM: PurchaseState.FILLING_ATTENDEE_FORM,
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.SELECTING_QUANTITY]: {
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    FILLING_ATTENDEE_FORM: PurchaseState.FILLING_ATTENDEE_FORM,
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.AREA_SELECTION_REQUIRED]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.SELECTING_AREA]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.SEAT_MAP_DETECTED]: {
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    SEAT_UNAVAILABLE: handleSeatUnavailable,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.SEAT_SELECTION]: {
    SELECTING_SEATS: handleNoOp,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    SEAT_UNAVAILABLE: handleSeatUnavailable,
    WAITING: PurchaseState.WAITING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.SELECTING_SEATS]: {
    SELECTING_SEATS: handleNoOp,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    SEAT_UNAVAILABLE: handleSeatUnavailable,
    WAITING: PurchaseState.WAITING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    INVALID_SELECTION: handleInvalidSelection,
  },

  [PurchaseState.SEATS_SELECTED]: {
    SEATS_SELECTED: handleNoOp,
    EVENT_DETECTED: handleEventDetected,
    SHOWING_DETECTED: PurchaseState.SHOWING_DETECTED,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    BOOKING_SUMMARY_DETECTED: PurchaseState.BOOKING_SUMMARY_DETECTED,
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    FILLING_ATTENDEE_FORM: PurchaseState.FILLING_ATTENDEE_FORM,
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    SELECTION_COMPLETED: PurchaseState.RESERVING,
    RESERVATION_INITIATED: PurchaseState.RESERVING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.BOOKING_SUMMARY_DETECTED]: {
    QUESTION_FORM_DETECTED: PurchaseState.QUESTION_FORM_DETECTED,
    FILLING_ATTENDEE_FORM: PurchaseState.FILLING_ATTENDEE_FORM,
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    RESERVATION_INITIATED: PurchaseState.RESERVING,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.QUESTION_FORM_DETECTED]: {
    FILLING_ATTENDEE_FORM: PurchaseState.FILLING_ATTENDEE_FORM,
    FORM_VALIDATED: PurchaseState.FORM_VALIDATED,
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.FILLING_ATTENDEE_FORM]: {
    FORM_VALIDATED: PurchaseState.FORM_VALIDATED,
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.FORM_VALIDATED]: {
    CONSENT_REQUIRED: PurchaseState.CONSENT_REQUIRED,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
    RESERVATION_INITIATED: PurchaseState.RESERVING,
    SEAT_MAP_DETECTED: PurchaseState.SEAT_MAP_DETECTED,
    AREA_SELECTION_REQUIRED: PurchaseState.AREA_SELECTION_REQUIRED,
    SELECTING_AREA: PurchaseState.SELECTING_AREA,
    SELECTING_SEATS: PurchaseState.SELECTING_SEATS,
    SEAT_SELECTION_REQUIRED: PurchaseState.SELECTING_SEATS,
    SEATS_SELECTED: PurchaseState.SEATS_SELECTED,
    TICKET_SELECTED: PurchaseState.TICKET_SELECTED,
    TICKETS_DETECTED: PurchaseState.TICKETS_DETECTED,
  },

  [PurchaseState.CONSENT_REQUIRED]: {
    HUMAN_INTERVENTION_RESOLVED: PurchaseState.PAYMENT_GATE,
    USER_COMPLETED_CHALLENGE: PurchaseState.PAYMENT_GATE,
    PAYMENT_GATE: PurchaseState.PAYMENT_GATE,
  },

  [PurchaseState.PAYMENT_GATE]: {
    PAYMENT_GATE: handleNoOp,
    PAYMENT_STARTED: PurchaseState.PAYMENT,
    CONFIRMATION_PENDING: PurchaseState.CONFIRMATION_PENDING,
    PAYMENT_CONFIRMED: handlePaymentConfirmed,
    PAYMENT_ACTION_REQUIRED: PurchaseState.PAYMENT_ACTION_REQUIRED,
    PAYMENT_FAILED: handlePaymentFailed,
  },

  [PurchaseState.CONFIRMATION_PENDING]: {
    PAYMENT_CONFIRMED: handlePaymentConfirmed,
    PAYMENT_FAILED: handlePaymentFailed,
  },

  [PurchaseState.RESERVING]: {
    RESERVATION_SERVER_CONFIRMED: handleReservationServerConfirmed,
    RESERVATION_REJECTED: handleReservationRejected,
    SESSION_EXPIRED: PurchaseState.SESSION_REAUTH_REQUIRED,
    RATE_LIMITED: handleRateLimited,
    CAPTCHA_REQUIRED: PurchaseState.CAPTCHA_REQUIRED,
    UNKNOWN_SECURITY_CHALLENGE: PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
    WAITING: PurchaseState.WAITING_FOR_STOCK,
    WAITING_FOR_STOCK: PurchaseState.WAITING_FOR_STOCK,
  },

  [PurchaseState.HELD]: {
    CHECKOUT_OPENED: PurchaseState.CHECKOUT,
  },

  [PurchaseState.CHECKOUT]: {
    PAYMENT_STARTED: PurchaseState.PAYMENT,
    PAYMENT_ACTION_REQUIRED: PurchaseState.PAYMENT_ACTION_REQUIRED,
    CHECKOUT_FAILED: handleCheckoutFailed,
    SESSION_EXPIRED: PurchaseState.SESSION_REAUTH_REQUIRED,
    UNKNOWN_SECURITY_CHALLENGE: PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
  },

  [PurchaseState.PAYMENT]: {
    PAYMENT_CONFIRMED: handlePaymentConfirmed,
    PAYMENT_ACTION_REQUIRED: PurchaseState.PAYMENT_ACTION_REQUIRED,
    PAYMENT_FAILED: handlePaymentFailed,
    PAYMENT_TIMEOUT: handlePaymentTimeout,
  },

  [PurchaseState.SESSION_REAUTH_REQUIRED]: {
    HUMAN_INTERVENTION_RESOLVED: PurchaseState.AUTH_CHECK,
    USER_COMPLETED_CHALLENGE: PurchaseState.AUTH_CHECK,
  },

  [PurchaseState.CAPTCHA_REQUIRED]: humanInterventionResumeRules,
  [PurchaseState.OTP_REQUIRED]: humanInterventionResumeRules,
  [PurchaseState.PAYMENT_ACTION_REQUIRED]: humanInterventionResumeRules,
  [PurchaseState.UNKNOWN_SECURITY_CHALLENGE]: humanInterventionResumeRules,
  [PurchaseState.HUMAN_INTERVENTION_REQUIRED]: humanInterventionResumeRules,

  [PurchaseState.STATE_RECHECK]: {
    STATE_VERIFIED: handleStateVerified,
    STATE_UNVERIFIED: handleStateUnverified,
  },
};

/**
 * Authoritative, pure Domain State Machine for purchase execution.
 * Completely free of Chrome and DOM APIs.
 * Strictly conforms to docs/ticketbox/04-state-machine.md and docs/ticketbox/08-security-and-compliance.md.
 */
export class PurchaseStateMachine {
  private _state: PurchaseState;
  private _previousState?: PurchaseState | undefined;
  private _preInterventionState?: PurchaseState | undefined;
  private _attemptId?: string | undefined;
  private _workflowId?: string | undefined;
  private _accountId?: string | undefined;
  private _profileId?: string | undefined;
  private _eventId?: string | undefined;
  private _retryCount = 0;
  private _failureReason?: FailureReason | undefined;
  private _failureMessage?: string | undefined;
  private _humanInterventionId?: string | undefined;
  private _transitionEvent?: string | undefined;
  private _evidence?: Record<string, unknown> | undefined;
  private _updatedAt: string;
  private readonly listeners: Set<StateChangeListener> = new Set();

  constructor(
    initialState: PurchaseState = PurchaseState.INIT,
    attemptId?: string | undefined,
    context?: Partial<StateContext> | undefined
  ) {
    this._state = initialState;
    this._attemptId = attemptId ?? context?.attemptId;
    this._workflowId = context?.workflowId;
    this._accountId = context?.accountId;
    this._profileId = context?.profileId;
    this._eventId = context?.eventId;
    this._retryCount = context?.retryCount ?? 0;
    this._failureReason = context?.failureReason;
    this._failureMessage = context?.failureMessage;
    this._humanInterventionId = context?.humanInterventionId;
    this._evidence = context?.evidence;
    this._updatedAt = new Date().toISOString();
  }

  public get state(): PurchaseState {
    return this._state;
  }

  public get previousState(): PurchaseState | undefined {
    return this._previousState;
  }

  public get preInterventionState(): PurchaseState | undefined {
    return this._preInterventionState;
  }

  public clearPreInterventionState(): void {
    this._preInterventionState = undefined;
  }

  public get attemptId(): string | undefined {
    return this._attemptId;
  }

  public get workflowId(): string | undefined {
    return this._workflowId;
  }

  public get accountId(): string | undefined {
    return this._accountId;
  }

  public get profileId(): string | undefined {
    return this._profileId;
  }

  public get eventId(): string | undefined {
    return this._eventId;
  }

  public get retryCount(): number {
    return this._retryCount;
  }

  public get failureReason(): FailureReason | undefined {
    return this._failureReason;
  }

  public get failureMessage(): string | undefined {
    return this._failureMessage;
  }

  public get humanInterventionId(): string | undefined {
    return this._humanInterventionId;
  }

  public get transitionEvent(): string | undefined {
    return this._transitionEvent;
  }

  public get evidence(): Record<string, unknown> | undefined {
    return this._evidence;
  }

  public get updatedAt(): string {
    return this._updatedAt;
  }

  public getContext(): StateContext {
    return {
      currentState: this._state,
      ...(this._previousState !== undefined ? { previousState: this._previousState } : {}),
      ...(this._attemptId !== undefined ? { attemptId: this._attemptId } : {}),
      ...(this._workflowId !== undefined ? { workflowId: this._workflowId } : {}),
      ...(this._accountId !== undefined ? { accountId: this._accountId } : {}),
      ...(this._profileId !== undefined ? { profileId: this._profileId } : {}),
      ...(this._eventId !== undefined ? { eventId: this._eventId } : {}),
      retryCount: this._retryCount,
      ...(this._failureReason !== undefined ? { failureReason: this._failureReason } : {}),
      ...(this._failureMessage !== undefined ? { failureMessage: this._failureMessage } : {}),
      ...(this._humanInterventionId !== undefined
        ? { humanInterventionId: this._humanInterventionId }
        : {}),
      ...(this._transitionEvent !== undefined ? { transitionEvent: this._transitionEvent } : {}),
      ...(this._evidence !== undefined ? { evidence: this._evidence } : {}),
      updatedAt: this._updatedAt,
    };
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public setAttemptId(attemptId: string | undefined): void {
    this._attemptId = attemptId;
  }

  public setWorkflowId(workflowId: string | undefined): void {
    this._workflowId = workflowId;
  }

  public setAccountId(accountId: string | undefined): void {
    this._accountId = accountId;
  }

  public setProfileId(profileId: string | undefined): void {
    this._profileId = profileId;
  }

  public setEventId(eventId: string | undefined): void {
    this._eventId = eventId;
  }

  public setHumanInterventionId(id: string | undefined): void {
    this._humanInterventionId = id;
  }

  public setEvidence(evidence: Record<string, unknown> | undefined): void {
    this._evidence = evidence;
  }

  public setFailureReason(reason: FailureReason | undefined): void {
    this._failureReason = reason;
  }

  public setFailureMessage(msg: string | undefined): void {
    this._failureMessage = msg;
  }

  public incrementRetryCount(): number {
    this._retryCount++;
    return this._retryCount;
  }

  public requirePaymentEvidence(
    from: PurchaseState,
    event: Extract<StateTransitionEvent, { type: 'PAYMENT_CONFIRMED' }>
  ): PaymentConfirmationEvidence {
    const evidenceRef =
      event.orderId?.trim() ||
      event.confirmationReference?.trim() ||
      event.evidence?.orderId?.trim() ||
      event.evidence?.confirmationReference?.trim();

    if (!evidenceRef) {
      throw new StateTransitionError(
        from,
        PurchaseState.CONFIRMED,
        event.type,
        'Cannot transition to CONFIRMED without authoritative confirmation evidence (orderId or confirmationReference)'
      );
    }

    const evidenceObj: PaymentConfirmationEvidence = {
      ...(event.orderId?.trim() ? { orderId: event.orderId.trim() } : {}),
      ...(event.confirmationReference?.trim()
        ? { confirmationReference: event.confirmationReference.trim() }
        : {}),
      ...(event.evidence?.ticketId ? { ticketId: event.evidence.ticketId } : {}),
      confirmedAt: new Date().toISOString(),
    };
    return evidenceObj;
  }

  /**
   * Applies an event and transitions to the next state.
   * Throws StateTransitionError if the transition is illegal.
   */
  public transition(event: StateTransitionEvent): StateContext {
    const from = this._state;

    // Handle universal STOP_REQUESTED from any non-terminal state
    if (event.type === 'STOP_REQUESTED') {
      if (this._state === PurchaseState.STOPPED || this._state === PurchaseState.CONFIRMED) {
        return this.getContext();
      }
      return this.performTransition(PurchaseState.STOPPED, event.type, event.reason);
    }

    // Handle universal LIMIT_REACHED
    if (event.type === 'LIMIT_REACHED') {
      if (
        this._state === PurchaseState.CONFIRMED ||
        this._state === PurchaseState.STOPPED_LIMIT_REACHED
      ) {
        return this.getContext();
      }
      return this.performTransition(PurchaseState.STOPPED_LIMIT_REACHED, event.type, event.reason);
    }

    // Handle universal NO_TARGET_AVAILABLE
    if (event.type === 'NO_TARGET_AVAILABLE') {
      if (
        this._state === PurchaseState.CONFIRMED ||
        this._state === PurchaseState.STOPPED_NO_TARGET
      ) {
        return this.getContext();
      }
      return this.performTransition(PurchaseState.STOPPED_NO_TARGET, event.type, event.reason);
    }

    // Handle universal SECURITY_CHALLENGE_DETECTED
    if (event.type === 'SECURITY_CHALLENGE_DETECTED') {
      if (this._state === PurchaseState.CONFIRMED || isTerminalState(this._state)) {
        throw new StateTransitionError(
          from,
          PurchaseState.HUMAN_INTERVENTION_REQUIRED,
          event.type,
          'Cannot transition to HUMAN_INTERVENTION_REQUIRED from CONFIRMED or terminal state'
        );
      }
      return this.performTransition(PurchaseState.HUMAN_INTERVENTION_REQUIRED, event.type);
    }

    // Handle universal FAILURE_OCCURRED
    if (event.type === 'FAILURE_OCCURRED') {
      if (this._state === PurchaseState.CONFIRMED || isTerminalState(this._state)) {
        throw new StateTransitionError(
          from,
          PurchaseState.FAILED,
          event.type,
          'Cannot transition to FAILED from CONFIRMED or terminal state'
        );
      }
      this._failureReason = event.reason;
      if (event.message !== undefined) {
        this._failureMessage = event.message;
      }
      return this.performTransition(PurchaseState.FAILED, event.type);
    }

    // Handle universal UNSUPPORTED_FLOW
    if (event.type === 'UNSUPPORTED_FLOW') {
      if (this._state === PurchaseState.CONFIRMED || isTerminalState(this._state)) {
        throw new StateTransitionError(
          from,
          PurchaseState.FAILED,
          event.type,
          'Cannot transition to FAILED from CONFIRMED or terminal state'
        );
      }
      this._failureReason = FailureReason.UNKNOWN;
      this._failureMessage = event.reason ?? 'Unsupported flow encountered';
      return this.performTransition(PurchaseState.FAILED, event.type);
    }

    // Handle universal RETRY_TARGET strictly with allowlist of pre-reservation states
    if (event.type === 'RETRY_TARGET') {
      if (ALLOWED_RETRY_STATES.has(this._state)) {
        return this.performTransition(PurchaseState.RETRYING_TARGET, event.type, event.reason);
      }
      throw new StateTransitionError(
        from,
        PurchaseState.RETRYING_TARGET,
        event.type,
        `RETRY_TARGET is only permitted from pre-reservation states. Current state: '${from}'`
      );
    }

    // Handle RESET_REQUESTED from terminal/stopped states
    if (event.type === 'RESET_REQUESTED') {
      if (ALLOWED_RESET_STATES.has(this._state)) {
        this._failureReason = undefined;
        this._failureMessage = undefined;
        this._humanInterventionId = undefined;
        if (this._state !== PurchaseState.CONFIRMED) {
          this._evidence = undefined;
        }
        this._retryCount = 0;
        this._preInterventionState = undefined;
        return this.performTransition(PurchaseState.READY, event.type);
      }
      throw new StateTransitionError(
        from,
        PurchaseState.READY,
        event.type,
        'Reset is only permitted from STOPPED, FAILED, CONFIRMED, or terminal failure state'
      );
    }

    // Universal security challenges from active states
    if (
      event.type === 'CAPTCHA_REQUIRED' ||
      event.type === 'OTP_REQUIRED' ||
      event.type === 'UNKNOWN_SECURITY_CHALLENGE'
    ) {
      if (this._state === PurchaseState.CONFIRMED || isTerminalState(this._state)) {
        throw new StateTransitionError(
          from,
          'UNKNOWN',
          event.type,
          `Cannot trigger security challenge from terminal or confirmed state '${from}'`
        );
      }
      if (event.type === 'CAPTCHA_REQUIRED') {
        return this.performTransition(PurchaseState.CAPTCHA_REQUIRED, event.type);
      }
      if (event.type === 'OTP_REQUIRED') {
        return this.performTransition(PurchaseState.OTP_REQUIRED, event.type);
      }
      if (event.type === 'UNKNOWN_SECURITY_CHALLENGE') {
        return this.performTransition(PurchaseState.UNKNOWN_SECURITY_CHALLENGE, event.type);
      }
    }

    // Query data-driven transition table
    const handler = TRANSITION_TABLE[from]?.[event.type];
    if (!handler) {
      throw new StateTransitionError(
        from,
        'UNKNOWN',
        event.type,
        `State transition from '${from}' with event '${event.type}' is not allowed`
      );
    }

    if (typeof handler === 'string') {
      return this.performTransition(handler, event.type);
    }

    const result = handler(this, event, from);
    if (typeof result === 'string') {
      return this.performTransition(result, event.type);
    }
    return result;
  }

  private performTransition(
    to: PurchaseState,
    eventType: string,
    message?: string | undefined
  ): StateContext {
    this._transitionEvent = eventType;
    if (isHumanInterventionState(to)) {
      if (this._preInterventionState === undefined && !isHumanInterventionState(this._state)) {
        this._preInterventionState = this._state;
      }
    }
    this._previousState = this._state;
    this._state = to;
    this._updatedAt = new Date().toISOString();
    if (
      message !== undefined &&
      (to === PurchaseState.STOPPED ||
        to === PurchaseState.STOPPED_LIMIT_REACHED ||
        to === PurchaseState.STOPPED_NO_TARGET ||
        to === PurchaseState.FAILED ||
        to === PurchaseState.UNKNOWN)
    ) {
      this._failureMessage = message;
    }

    const context = this.getContext();
    this.notifyListeners(context);
    return context;
  }

  private notifyListeners(context: StateContext): void {
    for (const listener of this.listeners) {
      try {
        listener(context);
      } catch (err) {
        // Observers must not break the state machine
        console.error('StateChangeListener error:', err);
      }
    }
  }
}
