/**
 * Base domain error.
 */
export class DomainError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'DOMAIN_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an illegal state transition is attempted.
 */
export class StateTransitionError extends DomainError {
  constructor(
    public readonly fromState: string,
    public readonly toState: string,
    public readonly eventName: string,
    details?: string
  ) {
    super(
      `Invalid state transition: Cannot transition from '${fromState}' to '${toState}' via event '${eventName}'.${
        details ? ` Details: ${details}` : ''
      }`,
      'STATE_TRANSITION_INVALID'
    );
  }
}

/**
 * Thrown when a security rule is violated (e.g. attempting to store credentials or session theft).
 */
export class SecurityViolationError extends DomainError {
  constructor(
    message: string,
    public readonly ruleId: string
  ) {
    super(`Security constraint violation [${ruleId}]: ${message}`, 'SECURITY_VIOLATION');
  }
}

/**
 * Thrown when ticket selection fails to find a suitable candidate.
 */
export class SelectionError extends DomainError {
  constructor(message: string) {
    super(message, 'SELECTION_ERROR');
  }
}

/**
 * Thrown when reservation submission is rejected or cannot be verified.
 */
export class ReservationFailedError extends DomainError {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly canRetry: boolean = false
  ) {
    super(message, 'RESERVATION_FAILED');
  }
}
