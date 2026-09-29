import { PurchaseState, isHumanInterventionState } from '../states/PurchaseState';

export type PurchaseActionType =
  'OBSERVE' | 'SELECT' | 'RESERVE' | 'CHECKOUT' | 'PAYMENT' | 'USER_ACTION';

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
      if (ctx.action !== 'USER_ACTION') {
        return {
          allowed: false,
          reason: `Action rejected: System is in human intervention state '${ctx.currentState}'. Automation is paused.`,
        };
      }
    }

    // 4. State & Action Matrix Check
    switch (ctx.currentState) {
      case PurchaseState.INIT:
      case PurchaseState.AUTH_CHECK:
      case PurchaseState.EVENT_CHECK:
        if (ctx.action === 'RESERVE' || ctx.action === 'PAYMENT' || ctx.action === 'CHECKOUT') {
          return {
            allowed: false,
            reason: `Action '${ctx.action}' rejected: Lifecycle state '${ctx.currentState}' does not permit purchasing actions.`,
          };
        }
        break;

      case PurchaseState.READY:
        // Rule: User must explicitly arm assistant before any reservation/purchase action
        if (ctx.action === 'RESERVE' || ctx.action === 'CHECKOUT' || ctx.action === 'PAYMENT') {
          return {
            allowed: false,
            reason: `Action '${ctx.action}' rejected: Assistant is in READY state and must be explicitly ARMED before purchasing.`,
          };
        }
        break;

      case PurchaseState.ARMED:
      case PurchaseState.MONITORING:
      case PurchaseState.AVAILABLE_DETECTED:
        if (ctx.action === 'RESERVE' || ctx.action === 'CHECKOUT' || ctx.action === 'PAYMENT') {
          return {
            allowed: false,
            reason: `Action '${ctx.action}' rejected: Cannot reserve without selecting candidate tickets.`,
          };
        }
        break;

      case PurchaseState.SELECTING:
      case PurchaseState.TICKET_TYPE_SELECTION:
      case PurchaseState.QUANTITY_SELECTION:
      case PurchaseState.SEAT_SELECTION:
        if (ctx.action === 'PAYMENT') {
          return {
            allowed: false,
            reason: `Action 'PAYMENT' rejected during ticket selection.`,
          };
        }
        break;

      case PurchaseState.RESERVING:
        if (ctx.action === 'PAYMENT') {
          return {
            allowed: false,
            reason: `Action 'PAYMENT' rejected: Reservation has not been confirmed as HELD by server.`,
          };
        }
        break;

      case PurchaseState.HELD:
        if (ctx.action === 'RESERVE') {
          return {
            allowed: false,
            reason: `Action 'RESERVE' rejected: Ticket is already HELD. Proceed to checkout.`,
          };
        }
        break;

      case PurchaseState.CHECKOUT:
        if (ctx.action === 'RESERVE') {
          return {
            allowed: false,
            reason: `Action 'RESERVE' rejected: Already in CHECKOUT.`,
          };
        }
        break;

      case PurchaseState.PAYMENT:
        if (ctx.action === 'RESERVE') {
          return {
            allowed: false,
            reason: `Action 'RESERVE' rejected: Already in PAYMENT.`,
          };
        }
        break;

      case PurchaseState.STATE_RECHECK:
        if (ctx.action !== 'USER_ACTION') {
          return {
            allowed: false,
            reason: `Action '${ctx.action}' rejected: System is in transitional verification state 'STATE_RECHECK'. State revalidation is required before continuing automation.`,
          };
        }
        break;

      case PurchaseState.STOPPED:
      case PurchaseState.STOPPED_LIMIT_REACHED:
      case PurchaseState.STOPPED_NO_TARGET:
      case PurchaseState.FAILED:
      case PurchaseState.UNKNOWN:
      case PurchaseState.RATE_LIMITED:
      case PurchaseState.SESSION_EXPIRED:
      case PurchaseState.RESERVATION_FAILED:
      case PurchaseState.CHECKOUT_FAILED:
      case PurchaseState.PAYMENT_FAILED:
      case PurchaseState.AUTH_FAILURE:
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
        break;

      default:
        break;
    }

    return { allowed: true };
  }
}
