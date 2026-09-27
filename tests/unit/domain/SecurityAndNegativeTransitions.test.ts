import { describe, it, expect } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  StateTransitionError,
  ActionGuard,
} from '../../../src/domain';

describe('Security & Negative Transitions (Sections 10, 11, 12, 26, 28, 29)', () => {
  it('READY + payment_success must be REJECTED (Section 26)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.READY);

    expect(() => {
      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        confirmationReference: 'CONF-12345',
      });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.READY);
  });

  it('CAPTCHA_REQUIRED + reservation action must be REJECTED (Section 26)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.CAPTCHA_REQUIRED);

    expect(() => {
      sm.transition({ type: 'RESERVATION_INITIATED' });
    }).toThrow(StateTransitionError);

    const guardEval = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'RESERVE',
    });
    expect(guardEval.allowed).toBe(false);
  });

  it('OTP_REQUIRED + payment action must be REJECTED (Section 26)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.OTP_REQUIRED);

    expect(() => {
      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        confirmationReference: 'CONF-12345',
      });
    }).toThrow(StateTransitionError);

    const guardEval = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'PAYMENT',
    });
    expect(guardEval.allowed).toBe(false);
  });

  it('STOPPED + reservation action must be REJECTED (Section 26)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.STOPPED);

    expect(() => {
      sm.transition({ type: 'RESERVATION_INITIATED' });
    }).toThrow(StateTransitionError);

    const guardEval = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'RESERVE',
    });
    expect(guardEval.allowed).toBe(false);
  });

  it('RESERVING: button click must NOT transition to HELD (Section 28)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

    // button click is not authoritative server evidence
    expect(() => {
      sm.transition({ type: 'BUTTON_CLICKED' as never });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.RESERVING);
  });

  it('RESERVING: DOM changed must NOT transition to HELD (Section 28)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

    // DOM changed is not authoritative server evidence
    expect(() => {
      sm.transition({ type: 'DOM_CHANGED' as never });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.RESERVING);
  });

  it('RESERVING: absence of server reservationId must NOT transition to HELD (Section 26 & 28)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

    expect(() => {
      sm.transition({
        type: 'RESERVATION_SERVER_CONFIRMED',
        reservationId: '   ', // whitespace / empty string
      });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.RESERVING);
  });

  it('RESERVING: verified server confirmation evidence transitions to HELD (Section 28)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

    sm.transition({
      type: 'RESERVATION_SERVER_CONFIRMED',
      reservationId: 'RES-SRV-998811',
      expiresAt: '2026-09-27T01:00:00Z',
      evidence: {
        reservationId: 'RES-SRV-998811',
        holdId: 'HOLD-4455',
        checkoutReference: 'CHK-999',
      },
    });

    expect(sm.state).toBe(PurchaseState.HELD);
    expect(sm.evidence).toBeDefined();
    expect(sm.evidence?.['reservationId']).toBe('RES-SRV-998811');
    expect(sm.evidence?.['holdId']).toBe('HOLD-4455');
  });

  it('PAYMENT: payment button clicked must NOT transition to CONFIRMED (Section 29)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

    expect(() => {
      sm.transition({ type: 'PAYMENT_BUTTON_CLICKED' as never });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.PAYMENT);
  });

  it('PAYMENT: client redirect must NOT transition to CONFIRMED (Section 29)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

    expect(() => {
      sm.transition({ type: 'CLIENT_REDIRECTED' as never });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.PAYMENT);
  });

  it('PAYMENT: without confirmation evidence must NOT transition to CONFIRMED (Section 26 & 29)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

    expect(() => {
      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: '',
        confirmationReference: '',
      });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.PAYMENT);
  });

  it('PAYMENT: authoritative confirmation evidence transitions to CONFIRMED (Section 29)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

    sm.transition({
      type: 'PAYMENT_CONFIRMED',
      orderId: 'ORD-776655',
      confirmationReference: 'REF-CONF-332211',
    });

    expect(sm.state).toBe(PurchaseState.CONFIRMED);
    expect(sm.evidence).toBeDefined();
    expect(sm.evidence?.['orderId']).toBe('ORD-776655');
    expect(sm.evidence?.['confirmationReference']).toBe('REF-CONF-332211');
  });

  it('Account A context + Account B action must be REJECTED (Section 26)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.SELECTING, 'attempt_1', {
      accountId: 'account_A',
      profileId: 'profile_A',
    });

    const guardEval = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'RESERVE',
      accountId: sm.accountId,
      expectedAccountId: 'account_B',
    });

    expect(guardEval.allowed).toBe(false);
    expect(guardEval.reason).toContain('Account context mismatch');
  });
});
