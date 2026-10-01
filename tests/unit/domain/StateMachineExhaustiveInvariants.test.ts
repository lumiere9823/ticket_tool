import { describe, it, expect } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  FailureReason,
  StateTransitionError,
  ActionGuard,
} from '../../../src/domain';

describe('P4: State Machine Exhaustive Invariant Verification', () => {
  describe('Invariant 1: Explicit User Arming (Section 2.1 & 3)', () => {
    it('cannot perform purchase actions or enter monitoring from READY without ARMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);

      // Cannot jump to purchase states
      expect(() => sm.transition({ type: 'CANDIDATE_FOUND' })).toThrow(StateTransitionError);
      expect(() => sm.transition({ type: 'RESERVATION_INITIATED' })).toThrow(StateTransitionError);
      expect(() => sm.transition({ type: 'CHECKOUT_OPENED' })).toThrow(StateTransitionError);

      // Must explicitly ARM
      sm.transition({ type: 'ARM' });
      expect(sm.state).toBe(PurchaseState.ARMED);

      // Can DISARM back to READY
      sm.transition({ type: 'DISARM' });
      expect(sm.state).toBe(PurchaseState.READY);
    });

    it('rejects ARM from intermediate purchase states', () => {
      const smSelecting = new PurchaseStateMachine(PurchaseState.SELECTING);
      expect(() => smSelecting.transition({ type: 'ARM' })).toThrow(StateTransitionError);

      const smHeld = new PurchaseStateMachine(PurchaseState.HELD);
      expect(() => smHeld.transition({ type: 'ARM' })).toThrow(StateTransitionError);
    });
  });

  describe('Invariant 2: Authoritative Server Evidence for Reservation (Rule 03, 05 & Section 2.3)', () => {
    it('strictly requires non-empty reservationId to transition RESERVING -> HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

      // Empty string
      expect(() => {
        sm.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: '',
        });
      }).toThrow(StateTransitionError);

      // Whitespace only
      expect(() => {
        sm.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: '   ',
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.RESERVING);
      expect(sm.evidence).toBeUndefined();

      // Valid reservationId succeeds
      sm.transition({
        type: 'RESERVATION_SERVER_CONFIRMED',
        reservationId: 'RES-AUTH-12345',
        expiresAt: '2026-10-01T23:59:59Z',
      });
      expect(sm.state).toBe(PurchaseState.HELD);
      expect(sm.evidence?.reservationId).toBe('RES-AUTH-12345');
      expect(sm.evidence?.serverConfirmedAt).toBeDefined();
    });
  });

  describe('Invariant 3: Authoritative Payment Confirmation Evidence (Rule 06 & Section 58)', () => {
    it('strictly requires orderId or confirmationReference to transition PAYMENT -> CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

      expect(() => {
        sm.transition({
          type: 'PAYMENT_CONFIRMED',
        });
      }).toThrow(StateTransitionError);

      expect(() => {
        sm.transition({
          type: 'PAYMENT_CONFIRMED',
          orderId: '   ',
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.PAYMENT);

      // Valid confirmation reference succeeds
      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        confirmationReference: 'TXN-99887766',
      });
      expect(sm.state).toBe(PurchaseState.CONFIRMED);
      expect(sm.evidence?.confirmationReference).toBe('TXN-99887766');
    });

    it('strictly requires confirmation evidence when transitioning from PAYMENT_GATE -> CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT_GATE);

      expect(() => {
        sm.transition({
          type: 'PAYMENT_CONFIRMED',
        });
      }).toThrow(StateTransitionError);

      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'ORDER-10101',
      });
      expect(sm.state).toBe(PurchaseState.CONFIRMED);
      expect(sm.evidence?.orderId).toBe('ORDER-10101');
    });
  });

  describe('Invariant 4: Payment Gate Non-Bypass & ActionGuard Boundaries (Section 54)', () => {
    it('ActionGuard blocks mutative ticket actions when at PAYMENT_GATE', () => {
      const guardResultReserve = ActionGuard.canExecuteAction({
        currentState: PurchaseState.PAYMENT_GATE,
        action: 'RESERVE',
      });
      expect(guardResultReserve.allowed).toBe(false);

      const guardResultSelect = ActionGuard.canExecuteAction({
        currentState: PurchaseState.PAYMENT_GATE,
        action: 'SELECT_SEATS',
      });
      expect(guardResultSelect.allowed).toBe(false);

      const guardResultUserAction = ActionGuard.canExecuteAction({
        currentState: PurchaseState.PAYMENT_GATE,
        action: 'USER_ACTION',
      });
      expect(guardResultUserAction.allowed).toBe(true);
    });
  });

  describe('Invariant 5: Human Intervention Precedence & Freeze (Section 2.4 & 4.3)', () => {
    const interventionStates = [
      PurchaseState.CAPTCHA_REQUIRED,
      PurchaseState.OTP_REQUIRED,
      PurchaseState.PAYMENT_ACTION_REQUIRED,
      PurchaseState.SESSION_REAUTH_REQUIRED,
      PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
      PurchaseState.HUMAN_INTERVENTION_REQUIRED,
    ];

    it.each(interventionStates)(
      'ActionGuard strictly halts automation during %s',
      (interventionState) => {
        const evalSelect = ActionGuard.canExecuteAction({
          currentState: interventionState,
          action: 'SELECT',
        });
        expect(evalSelect.allowed).toBe(false);
        expect(evalSelect.reason).toContain('Automation is paused');

        const evalReserve = ActionGuard.canExecuteAction({
          currentState: interventionState,
          action: 'RESERVE',
        });
        expect(evalReserve.allowed).toBe(false);

        const evalUserAction = ActionGuard.canExecuteAction({
          currentState: interventionState,
          action: 'USER_ACTION',
        });
        expect(evalUserAction.allowed).toBe(true);
      }
    );
  });

  describe('Invariant 6: Safe State Recheck Boundaries (Section 51)', () => {
    it('forbids STATE_RECHECK from directly authorizing HELD, CONFIRMED, or PAYMENT', () => {
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      sm.transition({ type: 'CAPTCHA_REQUIRED' });
      sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      // Attempting to jump directly to critical states
      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.HELD,
        });
      }).toThrow(/STATE_RECHECK cannot directly authorize/);

      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.CONFIRMED,
        });
      }).toThrow(/STATE_RECHECK cannot directly authorize/);

      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.PAYMENT,
        });
      }).toThrow(/STATE_RECHECK cannot directly authorize/);
    });

    it('allows STATE_RECHECK to safely resume to previous valid state (MONITORING)', () => {
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      sm.transition({ type: 'CAPTCHA_REQUIRED' });
      sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      sm.transition({
        type: 'STATE_VERIFIED',
        verifiedState: PurchaseState.MONITORING,
      });
      expect(sm.state).toBe(PurchaseState.MONITORING);
    });

    it('transitions to UNKNOWN when STATE_UNVERIFIED occurs', () => {
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      sm.transition({ type: 'CAPTCHA_REQUIRED' });
      sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });

      sm.transition({
        type: 'STATE_UNVERIFIED',
        reason: 'Page structure changed unexpectedly',
      });
      expect(sm.state).toBe(PurchaseState.UNKNOWN);
      expect(sm.failureMessage).toBe('Page structure changed unexpectedly');
    });
  });

  describe('Invariant 7: Terminal States Fail-Closed & Reset Rules (Section 59 & 60)', () => {
    it('CONFIRMED state cannot be terminated or mutated by STOP_REQUESTED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);
      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'ORD-999',
      });
      expect(sm.state).toBe(PurchaseState.CONFIRMED);

      // STOP_REQUESTED should no-op safely and remain CONFIRMED
      sm.transition({ type: 'STOP_REQUESTED', reason: 'User clicked stop after success' });
      expect(sm.state).toBe(PurchaseState.CONFIRMED);

      // LIMIT_REACHED should no-op safely
      sm.transition({ type: 'LIMIT_REACHED' });
      expect(sm.state).toBe(PurchaseState.CONFIRMED);
    });

    it('forbids security challenges and failure transitions from terminal states', () => {
      const sm = new PurchaseStateMachine(PurchaseState.CONFIRMED);
      expect(() => sm.transition({ type: 'CAPTCHA_REQUIRED' })).toThrow(StateTransitionError);
      expect(() => sm.transition({ type: 'SECURITY_CHALLENGE_DETECTED' })).toThrow(
        StateTransitionError
      );
      expect(() =>
        sm.transition({ type: 'FAILURE_OCCURRED', reason: FailureReason.UNKNOWN })
      ).toThrow(StateTransitionError);
    });

    it('permits RESET_REQUESTED from terminal/stopped states and resets failure state', () => {
      const sm = new PurchaseStateMachine(PurchaseState.FAILED);
      sm.setFailureReason(FailureReason.SOLD_OUT);
      sm.setFailureMessage('All tickets sold out');

      sm.transition({ type: 'RESET_REQUESTED' });
      expect(sm.state).toBe(PurchaseState.READY);
      expect(sm.failureReason).toBeUndefined();
      expect(sm.failureMessage).toBeUndefined();
    });

    it('rejects RESET_REQUESTED from active in-flight states', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);
      expect(() => sm.transition({ type: 'RESET_REQUESTED' })).toThrow(StateTransitionError);
    });
  });

  describe('Invariant 8: State Persistence & Rehydration Invariants (Section 56)', () => {
    it('restores valid state and attributes accurately', () => {
      const original = new PurchaseStateMachine(PurchaseState.SELECTING, 'att-101');
      original.setEventId('evt-555');
      const ctx = original.getContext();

      const restored = PurchaseStateMachine.restore(ctx);
      expect(restored.state).toBe(PurchaseState.SELECTING);
      expect(restored.attemptId).toBe('att-101');
      expect(restored.eventId).toBe('evt-555');
    });

    it('rejects restore to CONFIRMED without authoritative evidence', () => {
      const corruptedCtx = {
        currentState: PurchaseState.CONFIRMED,
        updatedAt: new Date().toISOString(),
      };

      expect(() => PurchaseStateMachine.restore(corruptedCtx)).toThrow(
        /Cannot restore to CONFIRMED without authoritative confirmation evidence/
      );
    });

    it('rejects restore to HELD without authoritative reservationId', () => {
      const corruptedCtx = {
        currentState: PurchaseState.HELD,
        updatedAt: new Date().toISOString(),
      };

      expect(() => PurchaseStateMachine.restore(corruptedCtx)).toThrow(
        /Cannot restore to HELD without authoritative reservation evidence/
      );
    });
  });

  describe('Invariant 9: State Transition Audit Logging (Section 57)', () => {
    it('records immutable audit events for every state transition', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY, 'att-audit');

      sm.transition({ type: 'ARM' });
      sm.transition({ type: 'MONITORING_STARTED' });
      sm.transition({ type: 'INVENTORY_AVAILABLE' });

      const auditLog = sm.getAuditLog();
      expect(auditLog.length).toBe(3);

      expect(auditLog[0]!.fromState).toBe(PurchaseState.READY);
      expect(auditLog[0]!.event).toBe('ARM');
      expect(auditLog[0]!.toState).toBe(PurchaseState.ARMED);
      expect(auditLog[0]!.attemptId).toBe('att-audit');

      expect(auditLog[1]!.fromState).toBe(PurchaseState.ARMED);
      expect(auditLog[1]!.event).toBe('MONITORING_STARTED');
      expect(auditLog[1]!.toState).toBe(PurchaseState.MONITORING);

      expect(auditLog[2]!.fromState).toBe(PurchaseState.MONITORING);
      expect(auditLog[2]!.event).toBe('INVENTORY_AVAILABLE');
      expect(auditLog[2]!.toState).toBe(PurchaseState.AVAILABLE_DETECTED);
    });

    it('bounds audit log size to MAX_AUDIT_LOG_SIZE via FIFO eviction', () => {
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      const maxSize = PurchaseStateMachine.MAX_AUDIT_LOG_SIZE;

      for (let i = 0; i < maxSize + 25; i++) {
        sm.transition({ type: 'WAITING' });
        sm.transition({ type: 'MONITORING_STARTED' });
      }

      const auditLog = sm.getAuditLog();
      expect(auditLog.length).toBeLessThanOrEqual(maxSize);
    });
  });
});
