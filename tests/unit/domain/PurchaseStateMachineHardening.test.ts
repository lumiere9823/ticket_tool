import { describe, it, expect } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  FailureReason,
  StateTransitionError,
  StateTransitionEvent,
} from '../../../src/domain';

describe('PurchaseStateMachine Hardening & Invariants (P1-2)', () => {
  describe('Invariant 1: Protection of CONFIRMED and Terminal States', () => {
    it('CONFIRMED state cannot be overwritten by FAILURE_OCCURRED, UNSUPPORTED_FLOW, or SECURITY_CHALLENGE_DETECTED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.CONFIRMED);

      expect(() => {
        sm.transition({
          type: 'FAILURE_OCCURRED',
          reason: FailureReason.PAYMENT_FAILED,
        });
      }).toThrow(StateTransitionError);
      expect(sm.state).toBe(PurchaseState.CONFIRMED);

      expect(() => {
        sm.transition({
          type: 'UNSUPPORTED_FLOW',
          reason: 'Something unexpected',
        });
      }).toThrow(StateTransitionError);
      expect(sm.state).toBe(PurchaseState.CONFIRMED);

      expect(() => {
        sm.transition({
          type: 'SECURITY_CHALLENGE_DETECTED',
        });
      }).toThrow(StateTransitionError);
      expect(sm.state).toBe(PurchaseState.CONFIRMED);
    });

    it('Terminal states (STOPPED, FAILED) cannot be overwritten by FAILURE_OCCURRED or SECURITY_CHALLENGE_DETECTED', () => {
      const smStopped = new PurchaseStateMachine(PurchaseState.STOPPED);
      expect(() => {
        smStopped.transition({
          type: 'FAILURE_OCCURRED',
          reason: FailureReason.UNKNOWN,
        });
      }).toThrow(StateTransitionError);
      expect(smStopped.state).toBe(PurchaseState.STOPPED);

      expect(() => {
        smStopped.transition({
          type: 'SECURITY_CHALLENGE_DETECTED',
        });
      }).toThrow(StateTransitionError);
      expect(smStopped.state).toBe(PurchaseState.STOPPED);

      const smFailed = new PurchaseStateMachine(PurchaseState.FAILED);
      expect(() => {
        smFailed.transition({
          type: 'SECURITY_CHALLENGE_DETECTED',
        });
      }).toThrow(StateTransitionError);
      expect(smFailed.state).toBe(PurchaseState.FAILED);
    });

    it('RESET_REQUESTED from CONFIRMED transitions to READY while PRESERVING evidence history', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);
      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'ORD-999',
        confirmationReference: 'REF-888',
      });
      expect(sm.state).toBe(PurchaseState.CONFIRMED);
      expect(sm.evidence).toBeDefined();
      expect(sm.evidence?.orderId).toBe('ORD-999');

      sm.transition({ type: 'RESET_REQUESTED' });
      expect(sm.state).toBe(PurchaseState.READY);
      expect(sm.evidence).toBeDefined();
      expect(sm.evidence?.orderId).toBe('ORD-999');
    });

    it('RESET_REQUESTED from STOPPED or FAILED clears evidence as normal', () => {
      const sm = new PurchaseStateMachine(PurchaseState.STOPPED, undefined, {
        evidence: { foo: 'bar' },
      });
      sm.transition({ type: 'RESET_REQUESTED' });
      expect(sm.state).toBe(PurchaseState.READY);
      expect(sm.evidence).toBeUndefined();
    });
  });

  describe('Invariant 2: RETRY_TARGET Allowlist', () => {
    const allowedRetryStates = [
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
    ];

    it('allows RETRY_TARGET from all designated pre-reservation states', () => {
      for (const st of allowedRetryStates) {
        const sm = new PurchaseStateMachine(st);
        sm.transition({ type: 'RETRY_TARGET', reason: 'Retry test' });
        expect(sm.state).toBe(PurchaseState.RETRYING_TARGET);
      }
    });

    const forbiddenRetryStates = [
      PurchaseState.HELD,
      PurchaseState.CHECKOUT,
      PurchaseState.PAYMENT,
      PurchaseState.CONFIRMATION_PENDING,
      PurchaseState.CAPTCHA_REQUIRED,
      PurchaseState.OTP_REQUIRED,
      PurchaseState.PAYMENT_ACTION_REQUIRED,
      PurchaseState.SESSION_REAUTH_REQUIRED,
      PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
      PurchaseState.HUMAN_INTERVENTION_REQUIRED,
      PurchaseState.STATE_RECHECK,
      PurchaseState.CONSENT_REQUIRED,
      PurchaseState.PAYMENT_GATE,
      PurchaseState.CONFIRMED,
      PurchaseState.STOPPED,
      PurchaseState.STOPPED_LIMIT_REACHED,
      PurchaseState.STOPPED_NO_TARGET,
      PurchaseState.FAILED,
      PurchaseState.INIT,
      PurchaseState.AUTH_CHECK,
    ];

    it('rejects RETRY_TARGET from post-reservation, human intervention, and terminal states', () => {
      for (const st of forbiddenRetryStates) {
        const sm = new PurchaseStateMachine(st);
        expect(() => {
          sm.transition({ type: 'RETRY_TARGET', reason: 'Illegal retry' });
        }).toThrow(StateTransitionError);
        expect(sm.state).toBe(st);
      }
    });
  });

  describe('Invariant 3: Authoritative Payment Evidence for CONFIRMED', () => {
    it('requires orderId or confirmationReference when transitioning to CONFIRMED from PAYMENT_GATE', () => {
      const smNoEvidence = new PurchaseStateMachine(PurchaseState.PAYMENT_GATE);
      expect(() => {
        smNoEvidence.transition({
          type: 'PAYMENT_CONFIRMED',
        });
      }).toThrow(StateTransitionError);
      expect(smNoEvidence.state).toBe(PurchaseState.PAYMENT_GATE);

      const smWithEvidence = new PurchaseStateMachine(PurchaseState.PAYMENT_GATE);
      smWithEvidence.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'ORDER_PG_123',
      });
      expect(smWithEvidence.state).toBe(PurchaseState.CONFIRMED);
      expect(smWithEvidence.evidence?.orderId).toBe('ORDER_PG_123');
    });

    it('requires orderId or confirmationReference when transitioning to CONFIRMED from CONFIRMATION_PENDING', () => {
      const smNoEvidence = new PurchaseStateMachine(PurchaseState.CONFIRMATION_PENDING);
      expect(() => {
        smNoEvidence.transition({
          type: 'PAYMENT_CONFIRMED',
        });
      }).toThrow(StateTransitionError);
      expect(smNoEvidence.state).toBe(PurchaseState.CONFIRMATION_PENDING);

      const smWithEvidence = new PurchaseStateMachine(PurchaseState.CONFIRMATION_PENDING);
      smWithEvidence.transition({
        type: 'PAYMENT_CONFIRMED',
        confirmationReference: 'REF_CP_456',
      });
      expect(smWithEvidence.state).toBe(PurchaseState.CONFIRMED);
      expect(smWithEvidence.evidence?.confirmationReference).toBe('REF_CP_456');
    });

    it('requires orderId or confirmationReference when transitioning to CONFIRMED from PAYMENT', () => {
      const smNoEvidence = new PurchaseStateMachine(PurchaseState.PAYMENT);
      expect(() => {
        smNoEvidence.transition({
          type: 'PAYMENT_CONFIRMED',
          orderId: '   ',
        });
      }).toThrow(StateTransitionError);
      expect(smNoEvidence.state).toBe(PurchaseState.PAYMENT);

      const smWithEvidence = new PurchaseStateMachine(PurchaseState.PAYMENT);
      smWithEvidence.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'ORDER_PAY_789',
      });
      expect(smWithEvidence.state).toBe(PurchaseState.CONFIRMED);
      expect(smWithEvidence.evidence?.orderId).toBe('ORDER_PAY_789');
    });
  });

  describe('Invariant 4: Prohibition of Skipping HELD', () => {
    it('prohibits CHECKOUT_OPENED directly from pre-reservation states without reservation evidence', () => {
      const statesAttemptingSkip = [
        PurchaseState.QUANTITY_SELECTION,
        PurchaseState.SELECTING_QUANTITY,
        PurchaseState.SEATS_SELECTED,
        PurchaseState.BOOKING_SUMMARY_DETECTED,
        PurchaseState.FORM_VALIDATED,
      ];

      for (const st of statesAttemptingSkip) {
        const sm = new PurchaseStateMachine(st);
        expect(() => {
          sm.transition({ type: 'CHECKOUT_OPENED' });
        }).toThrow(StateTransitionError);
        expect(sm.state).toBe(st);
      }
    });

    it('allows CHECKOUT_OPENED only from HELD state', () => {
      const sm = new PurchaseStateMachine(PurchaseState.HELD, undefined, {
        evidence: { reservationId: 'RES-123' },
      });
      sm.transition({ type: 'CHECKOUT_OPENED' });
      expect(sm.state).toBe(PurchaseState.CHECKOUT);
    });
  });

  describe('Invariant 5: STATE_RECHECK + STATE_VERIFIED restrictions', () => {
    it('strictly forbids sensitive states as verifiedState in STATE_VERIFIED', () => {
      const forbiddenVerifiedStates = [
        PurchaseState.PAYMENT,
        PurchaseState.CHECKOUT,
        PurchaseState.RESERVING,
        PurchaseState.PAYMENT_GATE,
        PurchaseState.HELD,
        PurchaseState.CONFIRMED,
      ];

      for (const forbidden of forbiddenVerifiedStates) {
        const sm = new PurchaseStateMachine(PurchaseState.CAPTCHA_REQUIRED);
        sm.transition({ type: 'HUMAN_INTERVENTION_RESOLVED' });
        expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

        expect(() => {
          sm.transition({
            type: 'STATE_VERIFIED',
            verifiedState: forbidden,
          });
        }).toThrow(StateTransitionError);
        expect(sm.state).toBe(PurchaseState.STATE_RECHECK);
      }
    });

    it('only allows verifiedState to be previousState, MONITORING, or READY', () => {
      // Transitioning from SELECTING -> CAPTCHA_REQUIRED -> STATE_RECHECK
      const sm = new PurchaseStateMachine(PurchaseState.SELECTING);
      sm.transition({ type: 'CAPTCHA_REQUIRED' });
      sm.transition({ type: 'HUMAN_INTERVENTION_RESOLVED' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      // Random state that is not previousState, MONITORING, or READY should be rejected
      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.TICKET_SELECTED,
        });
      }).toThrow(StateTransitionError);

      // Verifying to MONITORING is allowed
      const smToMonitoring = new PurchaseStateMachine(PurchaseState.SELECTING);
      smToMonitoring.transition({ type: 'CAPTCHA_REQUIRED' });
      smToMonitoring.transition({ type: 'HUMAN_INTERVENTION_RESOLVED' });
      smToMonitoring.transition({
        type: 'STATE_VERIFIED',
        verifiedState: PurchaseState.MONITORING,
      });
      expect(smToMonitoring.state).toBe(PurchaseState.MONITORING);

      // Verifying to READY is allowed
      const smToReady = new PurchaseStateMachine(PurchaseState.SELECTING);
      smToReady.transition({ type: 'CAPTCHA_REQUIRED' });
      smToReady.transition({ type: 'HUMAN_INTERVENTION_RESOLVED' });
      smToReady.transition({
        type: 'STATE_VERIFIED',
        verifiedState: PurchaseState.READY,
      });
      expect(smToReady.state).toBe(PurchaseState.READY);
    });
  });

  describe('Invariant 6: transition() does not set transitionEvent before validation', () => {
    it('does not contaminate transitionEvent if validation fails', () => {
      const sm = new PurchaseStateMachine(PurchaseState.INIT);
      expect(sm.transitionEvent).toBeUndefined();

      expect(() => {
        sm.transition({ type: 'ARM' });
      }).toThrow(StateTransitionError);

      expect(sm.transitionEvent).toBeUndefined();
    });

    it('sets transitionEvent only on successful transitions', () => {
      const sm = new PurchaseStateMachine(PurchaseState.INIT);
      sm.transition({ type: 'EXTENSION_READY' });
      expect(sm.transitionEvent).toBe('EXTENSION_READY');
    });
  });

  describe('Invariant 7: Universal Exhaustive State-Event Invariant Sweep', () => {
    const allStates = Object.values(PurchaseState);
    const sampleEvents: StateTransitionEvent[] = [
      { type: 'FAILURE_OCCURRED', reason: FailureReason.UNKNOWN },
      { type: 'SECURITY_CHALLENGE_DETECTED' },
      { type: 'RETRY_TARGET', reason: 'test' },
      { type: 'PAYMENT_CONFIRMED' }, // Missing evidence
      { type: 'CHECKOUT_OPENED' },
    ];

    it('verifies that no state can illegally transition to CONFIRMED without evidence', () => {
      for (const st of allStates) {
        if (st === PurchaseState.CONFIRMED) continue;
        const sm = new PurchaseStateMachine(st);
        try {
          sm.transition({ type: 'PAYMENT_CONFIRMED' });
        } catch (e) {
          // Expected to throw StateTransitionError
          expect(e).toBeInstanceOf(StateTransitionError);
        }
        expect(sm.state).not.toBe(PurchaseState.CONFIRMED);
      }
    });

    it('verifies that CONFIRMED state never mutates to FAILED or HUMAN_INTERVENTION_REQUIRED', () => {
      for (const ev of sampleEvents) {
        const sm = new PurchaseStateMachine(PurchaseState.CONFIRMED);
        try {
          sm.transition(ev);
        } catch {
          // Ignored
        }
        expect(sm.state).toBe(PurchaseState.CONFIRMED);
      }
    });
  });
});
