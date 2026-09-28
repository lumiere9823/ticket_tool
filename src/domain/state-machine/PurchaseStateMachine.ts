import {
  PurchaseState,
  FailureReason,
  StateTransitionEvent,
  StateContext,
  ReservationEvidence,
  PaymentConfirmationEvidence,
} from '../states/PurchaseState';
import { StateTransitionError } from '../errors/DomainError';

export type StateChangeListener = (context: StateContext) => void;

/**
 * Authoritative, pure Domain State Machine for purchase execution.
 * Completely free of Chrome and DOM APIs.
 * Strictly conforms to docs/ticketbox/04-state-machine.md and docs/ticketbox/08-security-and-compliance.md.
 */
export class PurchaseStateMachine {
  private _state: PurchaseState;
  private _previousState?: PurchaseState | undefined;
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

  public incrementRetryCount(): number {
    this._retryCount++;
    return this._retryCount;
  }

  /**
   * Applies an event and transitions to the next state.
   * Throws StateTransitionError if the transition is illegal.
   */
  public transition(event: StateTransitionEvent): StateContext {
    const from = this._state;
    this._transitionEvent = event.type;

    // Handle universal STOP_REQUESTED from any non-terminal state
    if (event.type === 'STOP_REQUESTED') {
      if (this._state === PurchaseState.STOPPED || this._state === PurchaseState.CONFIRMED) {
        return this.getContext();
      }
      return this.performTransition(PurchaseState.STOPPED, event.reason);
    }

    // Handle RESET_REQUESTED from terminal/stopped states
    if (event.type === 'RESET_REQUESTED') {
      if (
        this._state === PurchaseState.STOPPED ||
        this._state === PurchaseState.FAILED ||
        this._state === PurchaseState.CONFIRMED ||
        this._state === PurchaseState.UNKNOWN ||
        this._state === PurchaseState.RATE_LIMITED ||
        this._state === PurchaseState.SOLD_OUT ||
        this._state === PurchaseState.INVALID_SELECTION ||
        this._state === PurchaseState.RESERVATION_FAILED ||
        this._state === PurchaseState.CHECKOUT_FAILED ||
        this._state === PurchaseState.PAYMENT_FAILED ||
        this._state === PurchaseState.AUTH_FAILURE
      ) {
        this._failureReason = undefined;
        this._failureMessage = undefined;
        this._humanInterventionId = undefined;
        this._evidence = undefined;
        this._retryCount = 0;
        return this.performTransition(PurchaseState.READY);
      }
      throw new StateTransitionError(
        from,
        PurchaseState.READY,
        event.type,
        'Reset is only permitted from STOPPED, FAILED, CONFIRMED, or terminal failure state'
      );
    }

    // Handle universal FAILURE_OCCURRED
    if (event.type === 'FAILURE_OCCURRED') {
      this._failureReason = event.reason;
      if (event.message !== undefined) {
        this._failureMessage = event.message;
      }
      return this.performTransition(PurchaseState.FAILED);
    }

    // Handle universal UNSUPPORTED_FLOW
    if (event.type === 'UNSUPPORTED_FLOW') {
      this._failureReason = FailureReason.UNKNOWN;
      this._failureMessage = event.reason ?? 'Unsupported flow encountered';
      return this.performTransition(PurchaseState.FAILED);
    }

    switch (from) {
      case PurchaseState.INIT:
        if (event.type === 'EXTENSION_READY') {
          return this.performTransition(PurchaseState.AUTH_CHECK);
        }
        break;

      case PurchaseState.AUTH_CHECK:
        if (event.type === 'AUTHENTICATED') {
          return this.performTransition(PurchaseState.EVENT_CHECK);
        }
        if (event.type === 'NOT_AUTHENTICATED' || event.type === 'SESSION_EXPIRED') {
          return this.performTransition(PurchaseState.SESSION_REAUTH_REQUIRED);
        }
        if (event.type === 'AUTH_FAILED') {
          this._failureReason = event.reason;
          if (event.reason === FailureReason.SESSION_EXPIRED) {
            return this.performTransition(PurchaseState.SESSION_REAUTH_REQUIRED);
          }
          return this.performTransition(PurchaseState.FAILED);
        }
        break;

      case PurchaseState.EVENT_CHECK:
        if (event.type === 'EVENT_READY' || event.type === 'EVENT_NOT_OPEN') {
          return this.performTransition(PurchaseState.READY);
        }
        if (event.type === 'EVENT_FAILED') {
          this._failureReason = event.reason;
          return this.performTransition(PurchaseState.FAILED);
        }
        break;

      case PurchaseState.READY:
      case PurchaseState.IDLE:
        if (event.type === 'ARM') {
          return this.performTransition(PurchaseState.ARMED);
        }
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'MONITORING_STARTED') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        break;

      case PurchaseState.ARMED:
        if (event.type === 'DISARM') {
          return this.performTransition(PurchaseState.READY);
        }
        if (event.type === 'MONITORING_STARTED') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.MONITORING:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVENTORY_AVAILABLE') {
          return this.performTransition(PurchaseState.AVAILABLE_DETECTED);
        }
        if (event.type === 'WAITING') {
          return this.performTransition(PurchaseState.WAITING, event.reason);
        }
        if (event.type === 'CAPTCHA_REQUIRED') {
          return this.performTransition(PurchaseState.CAPTCHA_REQUIRED);
        }
        if (event.type === 'SESSION_EXPIRED') {
          return this.performTransition(PurchaseState.SESSION_REAUTH_REQUIRED);
        }
        if (event.type === 'RATE_LIMITED') {
          this._failureReason = FailureReason.RATE_LIMITED;
          return this.performTransition(PurchaseState.RATE_LIMITED);
        }
        break;

      case PurchaseState.WAITING:
        if (event.type === 'MONITORING_STARTED') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVENTORY_AVAILABLE') {
          return this.performTransition(PurchaseState.AVAILABLE_DETECTED);
        }
        break;

      case PurchaseState.EVENT_DETECTED:
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'MONITORING_STARTED') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        break;

      case PurchaseState.SHOWING_DETECTED:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVENTORY_AVAILABLE') {
          return this.performTransition(PurchaseState.AVAILABLE_DETECTED);
        }
        break;

      case PurchaseState.TICKETS_DETECTED:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'EVALUATING_TICKETS') {
          return this.performTransition(PurchaseState.EVALUATING_TICKETS);
        }
        if (event.type === 'TICKET_SELECTED') {
          return this.performTransition(PurchaseState.TICKET_SELECTED);
        }
        if (event.type === 'CANDIDATE_FOUND') {
          return this.performTransition(PurchaseState.SELECTING);
        }
        if (event.type === 'WAITING') {
          return this.performTransition(PurchaseState.WAITING, event.reason);
        }
        break;

      case PurchaseState.EVALUATING_TICKETS:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'TICKET_SELECTED') {
          return this.performTransition(PurchaseState.TICKET_SELECTED);
        }
        if (event.type === 'CANDIDATE_FOUND') {
          return this.performTransition(PurchaseState.SELECTING);
        }
        if (event.type === 'WAITING') {
          return this.performTransition(PurchaseState.WAITING, event.reason);
        }
        if (event.type === 'NO_CANDIDATE_AVAILABLE') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        if (event.type === 'INVALID_SELECTION') {
          this._failureReason = event.reason ?? FailureReason.INVALID_SELECTION;
          return this.performTransition(PurchaseState.INVALID_SELECTION);
        }
        break;

      case PurchaseState.AVAILABLE_DETECTED:
        if (event.type === 'CANDIDATE_FOUND') {
          return this.performTransition(PurchaseState.SELECTING);
        }
        if (event.type === 'NO_CANDIDATE_AVAILABLE') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        break;

      case PurchaseState.SELECTING:
        if (event.type === 'TICKET_SELECTED') {
          return this.performTransition(PurchaseState.TICKET_SELECTED);
        }
        if (event.type === 'TICKET_TYPE_REQUIRED') {
          return this.performTransition(PurchaseState.TICKET_TYPE_SELECTION);
        }
        if (event.type === 'QUANTITY_REQUIRED' || event.type === 'SELECTING_QUANTITY') {
          return this.performTransition(PurchaseState.SELECTING_QUANTITY);
        }
        if (event.type === 'SEAT_SELECTION_REQUIRED' || event.type === 'SELECTING_SEATS') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'RESERVATION_INITIATED' || event.type === 'SELECTION_COMPLETED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVALID_SELECTION') {
          this._failureReason = event.reason ?? FailureReason.INVALID_SELECTION;
          return this.performTransition(PurchaseState.INVALID_SELECTION);
        }
        break;

      case PurchaseState.TICKET_SELECTED:
        if (event.type === 'BOOKING_MODE_DETECTED') {
          return this.performTransition(PurchaseState.BOOKING_MODE_DETECTED);
        }
        if (event.type === 'SELECTING_QUANTITY' || event.type === 'QUANTITY_REQUIRED') {
          return this.performTransition(PurchaseState.SELECTING_QUANTITY);
        }
        if (event.type === 'AREA_SELECTION_REQUIRED') {
          return this.performTransition(PurchaseState.AREA_SELECTION_REQUIRED);
        }
        if (event.type === 'SEAT_MAP_DETECTED') {
          return this.performTransition(PurchaseState.SEAT_MAP_DETECTED);
        }
        if (event.type === 'SELECTING_SEATS' || event.type === 'SEAT_SELECTION_REQUIRED') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVALID_SELECTION') {
          this._failureReason = event.reason ?? FailureReason.INVALID_SELECTION;
          return this.performTransition(PurchaseState.INVALID_SELECTION);
        }
        break;

      case PurchaseState.BOOKING_MODE_DETECTED:
        if (event.type === 'SELECTING_QUANTITY' || event.type === 'QUANTITY_REQUIRED') {
          return this.performTransition(PurchaseState.SELECTING_QUANTITY);
        }
        if (event.type === 'AREA_SELECTION_REQUIRED') {
          return this.performTransition(PurchaseState.AREA_SELECTION_REQUIRED);
        }
        if (event.type === 'SEAT_MAP_DETECTED') {
          return this.performTransition(PurchaseState.SEAT_MAP_DETECTED);
        }
        if (event.type === 'SELECTING_SEATS' || event.type === 'SEAT_SELECTION_REQUIRED') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.TICKET_TYPE_SELECTION:
        if (event.type === 'QUANTITY_REQUIRED' || event.type === 'SELECTING_QUANTITY') {
          return this.performTransition(PurchaseState.QUANTITY_SELECTION);
        }
        if (event.type === 'SEAT_SELECTION_REQUIRED' || event.type === 'SELECTING_SEATS') {
          return this.performTransition(PurchaseState.SEAT_SELECTION);
        }
        if (event.type === 'SELECTION_COMPLETED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        if (event.type === 'INVALID_SELECTION') {
          this._failureReason = event.reason ?? FailureReason.INVALID_SELECTION;
          return this.performTransition(PurchaseState.INVALID_SELECTION);
        }
        break;

      case PurchaseState.QUANTITY_SELECTION:
      case PurchaseState.SELECTING_QUANTITY:
        if (event.type === 'BOOKING_SUMMARY_DETECTED') {
          return this.performTransition(PurchaseState.BOOKING_SUMMARY_DETECTED);
        }
        if (event.type === 'QUESTION_FORM_DETECTED') {
          return this.performTransition(PurchaseState.QUESTION_FORM_DETECTED);
        }
        if (event.type === 'FILLING_ATTENDEE_FORM') {
          return this.performTransition(PurchaseState.FILLING_ATTENDEE_FORM);
        }
        if (event.type === 'CONSENT_REQUIRED') {
          return this.performTransition(PurchaseState.CONSENT_REQUIRED);
        }
        if (event.type === 'PAYMENT_GATE') {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        if (event.type === 'CHECKOUT_OPENED') {
          return this.performTransition(PurchaseState.CHECKOUT);
        }
        if (event.type === 'AREA_SELECTION_REQUIRED') {
          return this.performTransition(PurchaseState.AREA_SELECTION_REQUIRED);
        }
        if (event.type === 'SEAT_MAP_DETECTED') {
          return this.performTransition(PurchaseState.SEAT_MAP_DETECTED);
        }
        if (event.type === 'SEAT_SELECTION_REQUIRED' || event.type === 'SELECTING_SEATS') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'SELECTION_COMPLETED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVALID_SELECTION') {
          this._failureReason = event.reason ?? FailureReason.INVALID_SELECTION;
          return this.performTransition(PurchaseState.INVALID_SELECTION);
        }
        break;

      case PurchaseState.AREA_SELECTION_REQUIRED:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'SELECTING_AREA') {
          return this.performTransition(PurchaseState.SELECTING_AREA);
        }
        if (event.type === 'SEAT_MAP_DETECTED') {
          return this.performTransition(PurchaseState.SEAT_MAP_DETECTED);
        }
        if (event.type === 'SELECTING_SEATS') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.SELECTING_AREA:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'SEAT_MAP_DETECTED') {
          return this.performTransition(PurchaseState.SEAT_MAP_DETECTED);
        }
        if (event.type === 'SELECTING_SEATS') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.SEAT_MAP_DETECTED:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'SELECTING_SEATS' || event.type === 'SEAT_SELECTION_REQUIRED') {
          return this.performTransition(PurchaseState.SELECTING_SEATS);
        }
        if (event.type === 'SEATS_SELECTED') {
          return this.performTransition(PurchaseState.SEATS_SELECTED);
        }
        if (event.type === 'SEAT_UNAVAILABLE') {
          this._failureReason = FailureReason.SOLD_OUT;
          return this.performTransition(PurchaseState.SOLD_OUT);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.SEAT_SELECTION:
      case PurchaseState.SELECTING_SEATS:
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'SEATS_SELECTED') {
          return this.performTransition(PurchaseState.SEATS_SELECTED);
        }
        if (event.type === 'BOOKING_SUMMARY_DETECTED') {
          return this.performTransition(PurchaseState.BOOKING_SUMMARY_DETECTED);
        }
        if (event.type === 'SELECTION_COMPLETED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        if (event.type === 'SEAT_UNAVAILABLE') {
          this._failureReason = FailureReason.SOLD_OUT;
          return this.performTransition(PurchaseState.SOLD_OUT);
        }
        if (event.type === 'WAITING') {
          return this.performTransition(PurchaseState.WAITING, event.reason);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        if (event.type === 'INVALID_SELECTION') {
          this._failureReason = event.reason ?? FailureReason.INVALID_SELECTION;
          return this.performTransition(PurchaseState.INVALID_SELECTION);
        }
        break;

      case PurchaseState.SEATS_SELECTED:
        if (event.type === 'SEATS_SELECTED') {
          return this.getContext();
        }
        if (event.type === 'EVENT_DETECTED') {
          if (event.eventId) this._eventId = event.eventId;
          return this.performTransition(PurchaseState.EVENT_DETECTED);
        }
        if (event.type === 'SHOWING_DETECTED') {
          return this.performTransition(PurchaseState.SHOWING_DETECTED);
        }
        if (event.type === 'BOOKING_SUMMARY_DETECTED') {
          return this.performTransition(PurchaseState.BOOKING_SUMMARY_DETECTED);
        }
        if (event.type === 'QUESTION_FORM_DETECTED') {
          return this.performTransition(PurchaseState.QUESTION_FORM_DETECTED);
        }
        if (event.type === 'FILLING_ATTENDEE_FORM') {
          return this.performTransition(PurchaseState.FILLING_ATTENDEE_FORM);
        }
        if (event.type === 'CONSENT_REQUIRED') {
          return this.performTransition(PurchaseState.CONSENT_REQUIRED);
        }
        if (event.type === 'PAYMENT_GATE') {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        if (event.type === 'CHECKOUT_OPENED') {
          return this.performTransition(PurchaseState.CHECKOUT);
        }
        if (event.type === 'SELECTION_COMPLETED' || event.type === 'RESERVATION_INITIATED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.BOOKING_SUMMARY_DETECTED:
        if (event.type === 'QUESTION_FORM_DETECTED') {
          return this.performTransition(PurchaseState.QUESTION_FORM_DETECTED);
        }
        if (event.type === 'FILLING_ATTENDEE_FORM') {
          return this.performTransition(PurchaseState.FILLING_ATTENDEE_FORM);
        }
        if (event.type === 'CONSENT_REQUIRED') {
          return this.performTransition(PurchaseState.CONSENT_REQUIRED);
        }
        if (event.type === 'PAYMENT_GATE') {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        if (event.type === 'CHECKOUT_OPENED') {
          return this.performTransition(PurchaseState.CHECKOUT);
        }
        if (event.type === 'RESERVATION_INITIATED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        if (event.type === 'TICKETS_DETECTED') {
          return this.performTransition(PurchaseState.TICKETS_DETECTED);
        }
        break;

      case PurchaseState.QUESTION_FORM_DETECTED:
        if (event.type === 'FILLING_ATTENDEE_FORM') {
          return this.performTransition(PurchaseState.FILLING_ATTENDEE_FORM);
        }
        if (event.type === 'FORM_VALIDATED') {
          return this.performTransition(PurchaseState.FORM_VALIDATED);
        }
        if (event.type === 'CONSENT_REQUIRED') {
          return this.performTransition(PurchaseState.CONSENT_REQUIRED);
        }
        if (event.type === 'PAYMENT_GATE') {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        break;

      case PurchaseState.FILLING_ATTENDEE_FORM:
        if (event.type === 'FORM_VALIDATED') {
          return this.performTransition(PurchaseState.FORM_VALIDATED);
        }
        if (event.type === 'CONSENT_REQUIRED') {
          return this.performTransition(PurchaseState.CONSENT_REQUIRED);
        }
        if (event.type === 'PAYMENT_GATE') {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        break;

      case PurchaseState.FORM_VALIDATED:
        if (event.type === 'CONSENT_REQUIRED') {
          return this.performTransition(PurchaseState.CONSENT_REQUIRED);
        }
        if (event.type === 'PAYMENT_GATE') {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        if (event.type === 'CHECKOUT_OPENED') {
          return this.performTransition(PurchaseState.CHECKOUT);
        }
        if (event.type === 'RESERVATION_INITIATED') {
          return this.performTransition(PurchaseState.RESERVING);
        }
        break;

      case PurchaseState.CONSENT_REQUIRED:
        if (
          event.type === 'HUMAN_INTERVENTION_RESOLVED' ||
          event.type === 'USER_COMPLETED_CHALLENGE' ||
          event.type === 'PAYMENT_GATE'
        ) {
          return this.performTransition(PurchaseState.PAYMENT_GATE);
        }
        break;

      case PurchaseState.PAYMENT_GATE:
        if (event.type === 'PAYMENT_GATE') {
          return this.getContext();
        }
        if (event.type === 'PAYMENT_STARTED') {
          return this.performTransition(PurchaseState.PAYMENT);
        }
        if (event.type === 'CONFIRMATION_PENDING') {
          return this.performTransition(PurchaseState.CONFIRMATION_PENDING);
        }
        if (event.type === 'PAYMENT_CONFIRMED') {
          return this.performTransition(PurchaseState.CONFIRMED);
        }
        if (event.type === 'PAYMENT_ACTION_REQUIRED') {
          return this.performTransition(PurchaseState.PAYMENT_ACTION_REQUIRED);
        }
        if (event.type === 'PAYMENT_FAILED') {
          this._failureReason = event.reason ?? FailureReason.PAYMENT_FAILED;
          return this.performTransition(PurchaseState.PAYMENT_FAILED);
        }
        break;

      case PurchaseState.CONFIRMATION_PENDING:
        if (event.type === 'PAYMENT_CONFIRMED') {
          return this.performTransition(PurchaseState.CONFIRMED);
        }
        if (event.type === 'PAYMENT_FAILED') {
          this._failureReason = event.reason ?? FailureReason.PAYMENT_FAILED;
          return this.performTransition(PurchaseState.PAYMENT_FAILED);
        }
        break;

      case PurchaseState.RESERVING:
        if (event.type === 'RESERVATION_SERVER_CONFIRMED') {
          // RULE 4 & 5: Server-confirmed evidence is required.
          if (!event.reservationId || event.reservationId.trim() === '') {
            throw new StateTransitionError(
              from,
              PurchaseState.HELD,
              event.type,
              'Cannot transition to HELD without authoritative server reservationId'
            );
          }
          const evidenceObj: ReservationEvidence = {
            reservationId: event.reservationId,
            ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
            ...(event.evidence?.holdId ? { holdId: event.evidence.holdId } : {}),
            ...(event.evidence?.checkoutReference
              ? { checkoutReference: event.evidence.checkoutReference }
              : {}),
            serverConfirmedAt: new Date().toISOString(),
          };
          this._evidence = evidenceObj as unknown as Record<string, unknown>;
          return this.performTransition(PurchaseState.HELD);
        }
        if (event.type === 'RESERVATION_REJECTED') {
          this._failureReason = event.reason;
          if (event.message) this._failureMessage = event.message;
          return this.performTransition(PurchaseState.FAILED);
        }
        if (event.type === 'SESSION_EXPIRED') {
          return this.performTransition(PurchaseState.SESSION_REAUTH_REQUIRED);
        }
        if (event.type === 'RATE_LIMITED') {
          this._failureReason = FailureReason.RATE_LIMITED;
          return this.performTransition(PurchaseState.RATE_LIMITED);
        }
        if (event.type === 'CAPTCHA_REQUIRED') {
          return this.performTransition(PurchaseState.CAPTCHA_REQUIRED);
        }
        if (event.type === 'UNKNOWN_SECURITY_CHALLENGE') {
          return this.performTransition(PurchaseState.UNKNOWN_SECURITY_CHALLENGE);
        }
        break;

      case PurchaseState.HELD:
        if (event.type === 'CHECKOUT_OPENED') {
          return this.performTransition(PurchaseState.CHECKOUT);
        }
        break;

      case PurchaseState.CHECKOUT:
        if (event.type === 'PAYMENT_STARTED') {
          return this.performTransition(PurchaseState.PAYMENT);
        }
        if (event.type === 'PAYMENT_ACTION_REQUIRED') {
          return this.performTransition(PurchaseState.PAYMENT_ACTION_REQUIRED);
        }
        if (event.type === 'CHECKOUT_FAILED') {
          this._failureReason = event.reason ?? FailureReason.CHECKOUT_FAILED;
          return this.performTransition(PurchaseState.CHECKOUT_FAILED);
        }
        if (event.type === 'SESSION_EXPIRED') {
          return this.performTransition(PurchaseState.SESSION_REAUTH_REQUIRED);
        }
        if (event.type === 'UNKNOWN_SECURITY_CHALLENGE') {
          return this.performTransition(PurchaseState.UNKNOWN_SECURITY_CHALLENGE);
        }
        break;

      case PurchaseState.PAYMENT:
        if (event.type === 'PAYMENT_CONFIRMED') {
          // Critical Security Boundary: Confirmation requires authoritative evidence
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
            ...(event.orderId ? { orderId: event.orderId } : {}),
            ...(event.confirmationReference
              ? { confirmationReference: event.confirmationReference }
              : {}),
            ...(event.evidence?.ticketId ? { ticketId: event.evidence.ticketId } : {}),
            confirmedAt: new Date().toISOString(),
          };
          this._evidence = evidenceObj as unknown as Record<string, unknown>;
          return this.performTransition(PurchaseState.CONFIRMED);
        }
        if (event.type === 'PAYMENT_ACTION_REQUIRED') {
          return this.performTransition(PurchaseState.PAYMENT_ACTION_REQUIRED);
        }
        if (event.type === 'PAYMENT_FAILED') {
          this._failureReason = event.reason ?? FailureReason.PAYMENT_FAILED;
          return this.performTransition(PurchaseState.PAYMENT_FAILED);
        }
        if (event.type === 'PAYMENT_TIMEOUT') {
          this._failureReason = FailureReason.PAYMENT_FAILED;
          this._failureMessage = event.message ?? 'Payment timed out';
          return this.performTransition(PurchaseState.PAYMENT_FAILED);
        }
        break;

      // Human Intervention States: Session reauth requires authoritative authentication re-verification
      case PurchaseState.SESSION_REAUTH_REQUIRED:
        if (
          event.type === 'HUMAN_INTERVENTION_RESOLVED' ||
          event.type === 'USER_COMPLETED_CHALLENGE'
        ) {
          // Rule: SESSION_REAUTH_REQUIRED -> HUMAN_INTERVENTION_RESOLVED -> AUTH_CHECK
          // Must verify actual authentication before proceeding to EVENT_CHECK or READY
          return this.performTransition(PurchaseState.AUTH_CHECK);
        }
        break;

      // Other Human Intervention States: Transition to STATE_RECHECK for revalidation
      case PurchaseState.CAPTCHA_REQUIRED:
      case PurchaseState.OTP_REQUIRED:
      case PurchaseState.PAYMENT_ACTION_REQUIRED:
      case PurchaseState.UNKNOWN_SECURITY_CHALLENGE:
        if (
          event.type === 'HUMAN_INTERVENTION_RESOLVED' ||
          event.type === 'USER_COMPLETED_CHALLENGE'
        ) {
          return this.performTransition(PurchaseState.STATE_RECHECK);
        }
        break;

      // STATE_RECHECK: Transitional verification state
      case PurchaseState.STATE_RECHECK:
        if (event.type === 'STATE_VERIFIED') {
          // Rule: Observation / challenge completion alone MUST NEVER authorize HELD or CONFIRMED
          if (
            event.verifiedState === PurchaseState.HELD ||
            event.verifiedState === PurchaseState.CONFIRMED
          ) {
            throw new StateTransitionError(
              from,
              event.verifiedState,
              event.type,
              `STATE_RECHECK cannot directly authorize '${event.verifiedState}'. Authoritative server evidence is required.`
            );
          }

          // If recovering from SESSION_REAUTH_REQUIRED, must pass through AUTH_CHECK
          if (
            this._previousState === PurchaseState.SESSION_REAUTH_REQUIRED &&
            event.verifiedState !== PurchaseState.AUTH_CHECK
          ) {
            throw new StateTransitionError(
              from,
              event.verifiedState,
              event.type,
              'Re-authentication recovery must route through AUTH_CHECK for authoritative session verification'
            );
          }

          return this.performTransition(event.verifiedState);
        }
        if (event.type === 'STATE_UNVERIFIED') {
          this._failureReason = FailureReason.UNKNOWN;
          this._failureMessage =
            event.reason ?? 'State re-evaluation failed to verify safe application state';
          return this.performTransition(PurchaseState.UNKNOWN);
        }
        break;

      default:
        break;
    }

    // If reached here, transition is invalid
    throw new StateTransitionError(
      from,
      'UNKNOWN',
      event.type,
      `State transition from '${from}' with event '${event.type}' is not allowed`
    );
  }

  private performTransition(to: PurchaseState, message?: string | undefined): StateContext {
    this._previousState = this._state;
    this._state = to;
    this._updatedAt = new Date().toISOString();
    if (
      message !== undefined &&
      (to === PurchaseState.STOPPED || to === PurchaseState.FAILED || to === PurchaseState.UNKNOWN)
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
