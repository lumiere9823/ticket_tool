import { PurchaseState, isHumanInterventionState } from '../states/PurchaseState';

export type PurchaseActionType =
  // High-level lifecycle & purchase
  | 'OBSERVE'
  | 'SELECT'
  | 'RESERVE'
  | 'CHECKOUT'
  | 'PAYMENT'
  | 'USER_ACTION'
  // Journey-specific granular actions
  | 'SELECT_TICKET'
  | 'SELECT_AREA'
  | 'SELECT_SEATS'
  | 'PROCEED'
  | 'FILL_FORM'
  | 'DESELECT'
  | 'RESET'
  | 'DISMISS';

export interface ActionGuardContext {
  currentState: PurchaseState;
  action: PurchaseActionType;
  profileId?: string | undefined;
  expectedProfileId?: string | undefined;
  accountId?: string | undefined;
  expectedAccountId?: string | undefined;
  eventId?: string | undefined;
  expectedEventId?: string | undefined;
  workflowId?: string | undefined;
  expectedWorkflowId?: string | undefined;
  pageIdentity?: string | undefined;
  expectedPageIdentity?: string | undefined;
  isGlobalStopped?: boolean | undefined;
}

export interface ContextIdentity {
  profileId?: string | undefined;
  accountId?: string | undefined;
  eventId?: string | undefined;
  workflowId?: string | undefined;
  pageIdentity?: string | undefined;
}

export interface ActionGuardEvaluation {
  allowed: boolean;
  reason?: string | undefined;
}

/**
 * Per-state allowlist defining which actions are permissible in each PurchaseState.
 * Follows fail-closed policy: any action not explicitly allowed is rejected.
 */
const STATE_ACTION_ALLOWLIST: Record<PurchaseState, Set<PurchaseActionType>> = {
  // Setup & Detection
  [PurchaseState.INIT]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.AUTH_CHECK]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.EVENT_CHECK]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.IDLE]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.READY]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.ARMED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.MONITORING]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.AVAILABLE_DETECTED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.EVENT_DETECTED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SHOWING_DETECTED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.TICKETS_DETECTED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.EVALUATING_TICKETS]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),

  // Ticket & Area Selection
  [PurchaseState.SELECTING]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'SELECT_AREA',
    'SELECT_SEATS',
    'PROCEED',
    'DESELECT',
    'RESERVE',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.TICKET_TYPE_SELECTION]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.QUANTITY_SELECTION]: new Set([
    'OBSERVE',
    'SELECT',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SELECTING_QUANTITY]: new Set([
    'OBSERVE',
    'SELECT',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.BOOKING_MODE_DETECTED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_AREA',
    'SELECT_SEATS',
    'PROCEED',
    'DESELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.TICKET_SELECTED]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_AREA',
    'SELECT_SEATS',
    'PROCEED',
    'DESELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.AREA_SELECTION_REQUIRED]: new Set([
    'OBSERVE',
    'SELECT_AREA',
    'SELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SELECTING_AREA]: new Set([
    'OBSERVE',
    'SELECT_AREA',
    'SELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SEAT_MAP_DETECTED]: new Set([
    'OBSERVE',
    'SELECT_SEATS',
    'SELECT_AREA',
    'SELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SELECTING_SEATS]: new Set([
    'OBSERVE',
    'SELECT_SEATS',
    'DESELECT',
    'SELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SEAT_SELECTION]: new Set([
    'OBSERVE',
    'SELECT_SEATS',
    'DESELECT',
    'SELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.SEATS_SELECTED]: new Set([
    'OBSERVE',
    'PROCEED',
    'DESELECT',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),

  // Summary, Forms & Consent
  [PurchaseState.BOOKING_SUMMARY_DETECTED]: new Set([
    'OBSERVE',
    'PROCEED',
    'FILL_FORM',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.QUESTION_FORM_DETECTED]: new Set([
    'OBSERVE',
    'FILL_FORM',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.FILLING_ATTENDEE_FORM]: new Set([
    'OBSERVE',
    'FILL_FORM',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.FORM_VALIDATED]: new Set([
    'OBSERVE',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.CONSENT_REQUIRED]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),

  // Reservation & Checkout
  [PurchaseState.RESERVING]: new Set(['OBSERVE', 'RESERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.HELD]: new Set([
    'OBSERVE',
    'CHECKOUT',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.CHECKOUT]: new Set([
    'OBSERVE',
    'CHECKOUT',
    'PAYMENT',
    'PROCEED',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.PAYMENT]: new Set(['OBSERVE', 'PAYMENT', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.PAYMENT_GATE]: new Set(['OBSERVE', 'PAYMENT', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.CONFIRMATION_PENDING]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),

  // Terminal Success: STRICTLY NO ACTIONS PERMITTED (docs/ticketbox/04-state-machine.md)
  [PurchaseState.CONFIRMED]: new Set([]),

  // Waiting & Retrying
  [PurchaseState.WAITING]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.WAITING_FOR_STOCK]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.RETRYING_TARGET]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),

  // Human intervention (automation paused)
  [PurchaseState.CAPTCHA_REQUIRED]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.OTP_REQUIRED]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.PAYMENT_ACTION_REQUIRED]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.SESSION_REAUTH_REQUIRED]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.UNKNOWN_SECURITY_CHALLENGE]: new Set([
    'OBSERVE',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.HUMAN_INTERVENTION_REQUIRED]: new Set([
    'OBSERVE',
    'USER_ACTION',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.IN_QUEUE]: new Set(['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']),

  // State recheck
  [PurchaseState.STATE_RECHECK]: new Set(['USER_ACTION', 'RESET', 'DISMISS']),

  // Safe Unknown & Transient
  [PurchaseState.SOLD_OUT]: new Set(['OBSERVE', 'SELECT', 'SELECT_TICKET', 'RESET', 'DISMISS']),
  [PurchaseState.INVALID_SELECTION]: new Set([
    'OBSERVE',
    'SELECT',
    'SELECT_TICKET',
    'RESET',
    'DISMISS',
  ]),
  [PurchaseState.UNKNOWN]: new Set(['RESET', 'DISMISS']),

  // Stopped states
  [PurchaseState.STOPPED]: new Set(['OBSERVE', 'RESET', 'DISMISS']),
  [PurchaseState.STOPPED_LIMIT_REACHED]: new Set(['OBSERVE', 'RESET', 'DISMISS']),
  [PurchaseState.STOPPED_NO_TARGET]: new Set(['OBSERVE', 'RESET', 'DISMISS']),

  // Failure terminal states: ONLY RESET or DISMISS permitted
  [PurchaseState.FAILED]: new Set(['RESET', 'DISMISS']),
  [PurchaseState.RESERVATION_FAILED]: new Set(['RESET', 'DISMISS']),
  [PurchaseState.CHECKOUT_FAILED]: new Set(['RESET', 'DISMISS']),
  [PurchaseState.PAYMENT_FAILED]: new Set(['RESET', 'DISMISS']),
  [PurchaseState.RATE_LIMITED]: new Set(['USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.SESSION_EXPIRED]: new Set(['USER_ACTION', 'RESET', 'DISMISS']),
  [PurchaseState.AUTH_FAILURE]: new Set(['USER_ACTION', 'RESET', 'DISMISS']),
};

/**
 * Action Guard enforcing docs/ticketbox/04-state-machine.md Section 54 & docs/ticketbox/08-security Section 27.
 * Pure domain policy with zero external dependencies.
 */
export class ActionGuard {
  /**
   * Validates that an incoming message or server event matches the expected workflow context.
   * Multi-account & multi-event safety: Prevents cross-context contamination.
   */
  public static validateCrossContext(
    expected: ContextIdentity,
    actual: ContextIdentity
  ): ActionGuardEvaluation {
    if (expected.profileId !== undefined && actual.profileId !== expected.profileId) {
      return {
        allowed: false,
        reason: `Cross-context rejected: Profile mismatch (expected ${expected.profileId}, got ${actual.profileId ?? 'missing'})`,
      };
    }
    if (expected.accountId !== undefined && actual.accountId !== expected.accountId) {
      return {
        allowed: false,
        reason: `Cross-context rejected: Account mismatch (expected ${expected.accountId}, got ${actual.accountId ?? 'missing'})`,
      };
    }
    if (expected.eventId !== undefined && actual.eventId !== expected.eventId) {
      return {
        allowed: false,
        reason: `Cross-context rejected: Event mismatch (expected ${expected.eventId}, got ${actual.eventId ?? 'missing'})`,
      };
    }
    if (expected.workflowId !== undefined && actual.workflowId !== expected.workflowId) {
      return {
        allowed: false,
        reason: `Cross-context rejected: Workflow mismatch (expected ${expected.workflowId}, got ${actual.workflowId ?? 'missing'})`,
      };
    }
    if (expected.pageIdentity !== undefined && actual.pageIdentity !== expected.pageIdentity) {
      return {
        allowed: false,
        reason: `Cross-context rejected: Page identity mismatch (expected ${expected.pageIdentity}, got ${actual.pageIdentity ?? 'missing'})`,
      };
    }
    return { allowed: true };
  }

  /**
   * Evaluates if a given action is permissible under the current system, state, and account contexts.
   */
  public static canExecuteAction(ctx: ActionGuardContext): ActionGuardEvaluation {
    // 1. Global Stop Check: If globally stopped, reject critical purchasing operations
    if (ctx.isGlobalStopped) {
      if (ctx.action === 'RESERVE' || ctx.action === 'CHECKOUT' || ctx.action === 'PAYMENT') {
        return {
          allowed: false,
          reason: 'Action rejected: Global stop is active. No new purchase actions permitted.',
        };
      }
    }

    // 2. Profile / Account / Event Context Isolation & Fail-Closed Checks
    if (ctx.expectedProfileId !== undefined && ctx.profileId !== ctx.expectedProfileId) {
      return {
        allowed: false,
        reason: `Action rejected: Profile context mismatch (current: ${ctx.profileId ?? 'missing'}, expected: ${ctx.expectedProfileId})`,
      };
    }

    if (ctx.expectedAccountId !== undefined && ctx.accountId !== ctx.expectedAccountId) {
      return {
        allowed: false,
        reason: `Action rejected: Account context mismatch (current: ${ctx.accountId ?? 'missing'}, expected: ${ctx.expectedAccountId})`,
      };
    }

    if (ctx.expectedEventId !== undefined && ctx.eventId !== ctx.expectedEventId) {
      return {
        allowed: false,
        reason: `Action rejected: Event context mismatch (current: ${ctx.eventId ?? 'missing'}, expected: ${ctx.expectedEventId})`,
      };
    }

    if (ctx.expectedWorkflowId !== undefined && ctx.workflowId !== ctx.expectedWorkflowId) {
      return {
        allowed: false,
        reason: `Action rejected: Workflow context mismatch (current: ${ctx.workflowId ?? 'missing'}, expected: ${ctx.expectedWorkflowId})`,
      };
    }

    if (ctx.expectedPageIdentity !== undefined && ctx.pageIdentity !== ctx.expectedPageIdentity) {
      return {
        allowed: false,
        reason: `Action rejected: Page identity context mismatch (current: ${ctx.pageIdentity ?? 'missing'}, expected: ${ctx.expectedPageIdentity})`,
      };
    }

    // 3. Human Intervention Precedence: Automation is paused
    if (isHumanInterventionState(ctx.currentState)) {
      if (
        ctx.action !== 'USER_ACTION' &&
        ctx.action !== 'OBSERVE' &&
        ctx.action !== 'RESET' &&
        ctx.action !== 'DISMISS'
      ) {
        return {
          allowed: false,
          reason: `Action rejected: System is in human intervention state '${ctx.currentState}'. Automation is paused.`,
        };
      }
    }

    // 4. CONFIRMED Terminal State: Blocks ALL actions unconditionally
    if (ctx.currentState === PurchaseState.CONFIRMED) {
      return {
        allowed: false,
        reason: `Action '${ctx.action}' rejected: State 'CONFIRMED' is terminal. No further actions permitted.`,
      };
    }

    // 5. Special rules for READY & MONITORING reservation rejection
    if (ctx.currentState === PurchaseState.READY) {
      if (ctx.action === 'RESERVE' || ctx.action === 'CHECKOUT' || ctx.action === 'PAYMENT') {
        return {
          allowed: false,
          reason: `Action '${ctx.action}' rejected: Assistant is in READY state and must be explicitly ARMED before purchasing.`,
        };
      }
    }

    if (
      ctx.currentState === PurchaseState.MONITORING ||
      ctx.currentState === PurchaseState.AVAILABLE_DETECTED
    ) {
      if (ctx.action === 'RESERVE' || ctx.action === 'CHECKOUT' || ctx.action === 'PAYMENT') {
        return {
          allowed: false,
          reason: `Action '${ctx.action}' rejected: Cannot reserve without selecting candidate tickets.`,
        };
      }
    }

    // 6. Special rules for terminal / failed / stopped states
    if (
      ctx.currentState === PurchaseState.STOPPED ||
      ctx.currentState === PurchaseState.STOPPED_LIMIT_REACHED ||
      ctx.currentState === PurchaseState.STOPPED_NO_TARGET ||
      ctx.currentState === PurchaseState.UNKNOWN
    ) {
      if (
        ctx.action === 'RESERVE' ||
        ctx.action === 'CHECKOUT' ||
        ctx.action === 'PAYMENT' ||
        ctx.action === 'SELECT'
      ) {
        return {
          allowed: false,
          reason: `Action '${ctx.action}' rejected: State '${ctx.currentState}' is terminal, failed, or safe unknown.`,
        };
      }
    }

    // 7. Exhaustive Per-state Allowlist Check (Fail-closed)
    const allowedSet = STATE_ACTION_ALLOWLIST[ctx.currentState];
    if (!allowedSet || !allowedSet.has(ctx.action)) {
      return {
        allowed: false,
        reason: `Action '${ctx.action}' rejected: State '${ctx.currentState}' does not permit '${ctx.action}'.`,
      };
    }

    return { allowed: true };
  }
}
