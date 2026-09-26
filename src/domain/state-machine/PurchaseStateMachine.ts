import {
  PurchaseState,
  FailureReason,
  StateTransitionEvent,
  StateContext,
} from '../states/PurchaseState';
import { StateTransitionError } from '../errors/DomainError';

export type StateChangeListener = (context: StateContext) => void;

/**
 * Authoritative, pure Domain State Machine for purchase execution.
 * Completely free of Chrome and DOM APIs.
 */
export class PurchaseStateMachine {
  private _state: PurchaseState;
  private _previousState?: PurchaseState | undefined;
  private _attemptId?: string | undefined;
  private _failureReason?: FailureReason | undefined;
  private _failureMessage?: string | undefined;
  private _updatedAt: string;
  private readonly listeners: Set<StateChangeListener> = new Set();

  constructor(initialState: PurchaseState = PurchaseState.INIT, attemptId?: string | undefined) {
    this._state = initialState;
    this._attemptId = attemptId;
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

  public get failureReason(): FailureReason | undefined {
    return this._failureReason;
  }

  public get failureMessage(): string | undefined {
    return this._failureMessage;
  }

  public get updatedAt(): string {
    return this._updatedAt;
  }

  public getContext(): StateContext {
    return {
      currentState: this._state,
      ...(this._previousState !== undefined ? { previousState: this._previousState } : {}),
      ...(this._attemptId !== undefined ? { attemptId: this._attemptId } : {}),
      ...(this._failureReason !== undefined ? { failureReason: this._failureReason } : {}),
      ...(this._failureMessage !== undefined ? { failureMessage: this._failureMessage } : {}),
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

  /**
   * Applies an event and transitions to the next state.
   * Throws StateTransitionError if the transition is illegal.
   */
  public transition(event: StateTransitionEvent): StateContext {
    const from = this._state;

    // Handle universal STOP_REQUESTED
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
        this._state === PurchaseState.CONFIRMED
      ) {
        this._failureReason = undefined;
        this._failureMessage = undefined;
        return this.performTransition(PurchaseState.READY);
      }
      throw new StateTransitionError(
        from,
        PurchaseState.READY,
        event.type,
        'Reset is only permitted from STOPPED, FAILED, or CONFIRMED state'
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
        if (event.type === 'AUTH_FAILED') {
          this._failureReason = event.reason;
          return this.performTransition(PurchaseState.FAILED);
        }
        break;

      case PurchaseState.EVENT_CHECK:
        if (event.type === 'EVENT_READY') {
          return this.performTransition(PurchaseState.READY);
        }
        if (event.type === 'EVENT_FAILED') {
          this._failureReason = event.reason;
          return this.performTransition(PurchaseState.FAILED);
        }
        break;

      case PurchaseState.READY:
        if (event.type === 'ARM') {
          return this.performTransition(PurchaseState.ARMED);
        }
        break;

      case PurchaseState.ARMED:
        if (event.type === 'DISARM') {
          return this.performTransition(PurchaseState.READY);
        }
        if (event.type === 'MONITORING_STARTED') {
          return this.performTransition(PurchaseState.MONITORING);
        }
        break;

      case PurchaseState.MONITORING:
        if (event.type === 'INVENTORY_AVAILABLE') {
          return this.performTransition(PurchaseState.AVAILABLE_DETECTED);
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
        if (event.type === 'RESERVATION_INITIATED') {
          return this.performTransition(PurchaseState.RESERVING);
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
          return this.performTransition(PurchaseState.HELD);
        }
        if (event.type === 'RESERVATION_REJECTED') {
          this._failureReason = event.reason;
          return this.performTransition(PurchaseState.FAILED);
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
        break;

      case PurchaseState.PAYMENT:
        if (event.type === 'PAYMENT_CONFIRMED') {
          return this.performTransition(PurchaseState.CONFIRMED);
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
    if (message !== undefined && to === PurchaseState.STOPPED) {
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
