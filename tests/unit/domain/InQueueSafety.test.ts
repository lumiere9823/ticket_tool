import { describe, it, expect, beforeEach } from 'vitest';
import {
  PurchaseState,
  PurchaseStateMachine,
  isHumanInterventionState,
  canAutoReset,
  ActionGuard,
  ActionGuardContext,
} from '../../../src/domain';
import { DomSecurityChallengeDetector } from '../../../src/infrastructure/security/DomSecurityChallengeDetector';
import { SecurityChallengeHandler } from '../../../src/application/services/SecurityChallengeHandler';

describe('In-Queue & Waiting Room Safety Policy (N6)', () => {
  let stateMachine: PurchaseStateMachine;

  beforeEach(() => {
    stateMachine = new PurchaseStateMachine();
    stateMachine.transition({ type: 'EXTENSION_READY' });
    stateMachine.transition({ type: 'AUTHENTICATED' });
    stateMachine.transition({ type: 'EVENT_READY' });
    stateMachine.transition({ type: 'ARM' });
    stateMachine.transition({ type: 'MONITORING_STARTED' });
  });

  describe('Domain Helpers & Invariant Flags', () => {
    it('should classify IN_QUEUE as a human intervention state (automation paused)', () => {
      expect(isHumanInterventionState(PurchaseState.IN_QUEUE)).toBe(true);
    });

    it('should forbid automated reset when in IN_QUEUE (canAutoReset returns false)', () => {
      expect(canAutoReset(PurchaseState.IN_QUEUE)).toBe(false);
    });
  });

  describe('State Machine Transitions into and out of IN_QUEUE', () => {
    it('should transition from MONITORING to IN_QUEUE on QUEUE_DETECTED', () => {
      expect(stateMachine.state).toBe(PurchaseState.MONITORING);
      stateMachine.transition({ type: 'QUEUE_DETECTED', details: 'Queue-it virtual waiting room' });
      expect(stateMachine.state).toBe(PurchaseState.IN_QUEUE);
    });

    it('should transition from active booking states to IN_QUEUE via universal queue handler', () => {
      stateMachine.transition({ type: 'INVENTORY_AVAILABLE' });
      expect(stateMachine.state).toBe(PurchaseState.AVAILABLE_DETECTED);

      stateMachine.transition({ type: 'QUEUE_DETECTED' });
      expect(stateMachine.state).toBe(PurchaseState.IN_QUEUE);
    });

    it('should safely resume from IN_QUEUE when queue passes via QUEUE_PASSED and STATE_VERIFIED', () => {
      stateMachine.transition({ type: 'QUEUE_DETECTED' });
      expect(stateMachine.state).toBe(PurchaseState.IN_QUEUE);

      // Queue cleared -> STATE_RECHECK -> STATE_VERIFIED
      stateMachine.transition({ type: 'QUEUE_PASSED' });
      expect(stateMachine.state).toBe(PurchaseState.STATE_RECHECK);

      stateMachine.transition({
        type: 'STATE_VERIFIED',
        verifiedState: PurchaseState.MONITORING,
      });
      expect(stateMachine.state).toBe(PurchaseState.MONITORING);
    });

    it('should support QUEUE_EXITED and USER_COMPLETED_CHALLENGE resumption paths', () => {
      stateMachine.transition({ type: 'QUEUE_DETECTED' });

      stateMachine.transition({ type: 'QUEUE_EXITED' });
      expect(stateMachine.state).toBe(PurchaseState.STATE_RECHECK);

      stateMachine.transition({
        type: 'STATE_VERIFIED',
        verifiedState: PurchaseState.MONITORING,
      });
      expect(stateMachine.state).toBe(PurchaseState.MONITORING);
    });

    it('should permit user explicit STOP_REQUESTED from IN_QUEUE', () => {
      stateMachine.transition({ type: 'QUEUE_DETECTED' });
      expect(stateMachine.state).toBe(PurchaseState.IN_QUEUE);

      stateMachine.transition({ type: 'STOP_REQUESTED', reason: 'User left queue' });
      expect(stateMachine.state).toBe(PurchaseState.STOPPED);

      // Can reset from STOPPED to READY
      stateMachine.transition({ type: 'RESET_REQUESTED' });
      expect(stateMachine.state).toBe(PurchaseState.READY);
    });

    it('should NOT allow QUEUE_DETECTED from terminal CONFIRMED or FAILED states', () => {
      const confirmedSm = new PurchaseStateMachine();
      confirmedSm.restore({
        currentState: PurchaseState.CONFIRMED,
        evidence: { orderId: 'ord-123' },
        updatedAt: new Date().toISOString(),
      });
      expect(() => {
        confirmedSm.transition({ type: 'QUEUE_DETECTED' });
      }).toThrow();

      const failedSm = new PurchaseStateMachine();
      failedSm.restore({
        currentState: PurchaseState.FAILED,
        updatedAt: new Date().toISOString(),
      });
      expect(() => {
        failedSm.transition({ type: 'QUEUE_DETECTED' });
      }).toThrow();
    });
  });

  describe('ActionGuard Enforcement in IN_QUEUE', () => {
    const baseContext: Omit<ActionGuardContext, 'action'> = {
      currentState: PurchaseState.IN_QUEUE,
      profileId: 'prof-1',
      expectedProfileId: 'prof-1',
      accountId: 'acc-1',
      expectedAccountId: 'acc-1',
      eventId: 'ev-1',
      expectedEventId: 'ev-1',
      workflowId: 'wf-1',
      expectedWorkflowId: 'wf-1',
      pageIdentity: 'https://ticketbox.vn/events/1',
      expectedPageIdentity: 'https://ticketbox.vn/events/1',
    };

    it('should ALLOW OBSERVE and USER_ACTION in IN_QUEUE', () => {
      const observeEval = ActionGuard.canExecuteAction({
        ...baseContext,
        action: 'OBSERVE',
      });
      expect(observeEval.allowed).toBe(true);

      const userActionEval = ActionGuard.canExecuteAction({
        ...baseContext,
        action: 'USER_ACTION',
      });
      expect(userActionEval.allowed).toBe(true);
    });

    it('should STRICTLY FORBID mutating actions (SELECT, RESERVE, CHECKOUT, PROCEED) in IN_QUEUE', () => {
      const mutatingActions: Array<ActionGuardContext['action']> = [
        'SELECT',
        'RESERVE',
        'CHECKOUT',
        'PAYMENT',
        'SELECT_TICKET',
        'SELECT_AREA',
        'SELECT_SEATS',
        'PROCEED',
        'FILL_FORM',
      ];

      for (const action of mutatingActions) {
        const evaluation = ActionGuard.canExecuteAction({
          ...baseContext,
          action,
        });
        expect(evaluation.allowed).toBe(false);
      }
    });
  });

  describe('Detector and SecurityChallengeHandler Integration', () => {
    it('should detect queue-it iframe passively and return targetState IN_QUEUE', () => {
      const detector = new DomSecurityChallengeDetector();
      const mockDoc = {
        querySelectorAll: (selector: string) => {
          if (selector === 'iframe') {
            return [
              {
                tagName: 'IFRAME',
                getAttribute: (attr: string) => (attr === 'src' ? 'https://queue-it.net/waiting-room' : null),
                getBoundingClientRect: () => ({ width: 600, height: 400 }),
              },
            ];
          }
          return [];
        },
        querySelector: () => null,
      };

      const result = detector.detectChallenge(mockDoc);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('QUEUE');
      expect(result.targetState).toBe(PurchaseState.IN_QUEUE);
    });

    it('should transition state machine to IN_QUEUE through SecurityChallengeHandler', () => {
      const handled = SecurityChallengeHandler.handle(
        {
          detected: true,
          type: 'QUEUE',
          details: 'Virtual waiting room active',
          targetState: PurchaseState.IN_QUEUE,
        },
        stateMachine
      );

      expect(handled.handled).toBe(true);
      expect(handled.targetState).toBe(PurchaseState.IN_QUEUE);
      expect(handled.finalState).toBe(PurchaseState.IN_QUEUE);
      expect(handled.requiresUserAction).toBe(true);
      expect(stateMachine.state).toBe(PurchaseState.IN_QUEUE);
    });
  });
});
