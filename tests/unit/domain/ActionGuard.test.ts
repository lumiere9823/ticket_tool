import { describe, it, expect } from 'vitest';
import { ActionGuard, PurchaseActionType } from '../../../src/domain/policies/ActionGuard';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';

describe('ActionGuard Policy Tests', () => {
  it('should REJECT reservation actions before assistant is ARMED (READY + reserve)', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.READY,
      action: 'RESERVE',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('ARMED');
  });

  it('should REJECT purchase actions in MONITORING state', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.MONITORING,
      action: 'RESERVE',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('Cannot reserve without selecting');
  });

  it('should REJECT reservation action when CAPTCHA_REQUIRED is active', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.CAPTCHA_REQUIRED,
      action: 'RESERVE',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('human intervention');
  });

  it('should REJECT payment action when OTP_REQUIRED is active', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.OTP_REQUIRED,
      action: 'PAYMENT',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('human intervention');
  });

  it('should REJECT reservation action when STOPPED is active', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.STOPPED,
      action: 'RESERVE',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('terminal, failed, or safe unknown');
  });

  it('should REJECT reservation action when UNKNOWN state is active', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.UNKNOWN,
      action: 'RESERVE',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('terminal, failed, or safe unknown');
  });

  it('should REJECT critical actions when global stop is active (Section 16)', () => {
    const reserveEval = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'RESERVE',
      isGlobalStopped: true,
    });
    expect(reserveEval.allowed).toBe(false);
    expect(reserveEval.reason).toContain('Global stop is active');

    const paymentEval = ActionGuard.canExecuteAction({
      currentState: PurchaseState.PAYMENT,
      action: 'PAYMENT',
      isGlobalStopped: true,
    });
    expect(paymentEval.allowed).toBe(false);
    expect(paymentEval.reason).toContain('Global stop is active');
  });

  it('should REJECT action when Account context mismatches (Account A vs Account B)', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'RESERVE',
      accountId: 'account_A',
      expectedAccountId: 'account_B',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('Account context mismatch');
  });

  it('should REJECT action when Profile context mismatches (Profile A vs Profile B)', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'RESERVE',
      profileId: 'profile_1',
      expectedProfileId: 'profile_2',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('Profile context mismatch');
  });

  it('should REJECT action when Event context mismatches', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'RESERVE',
      eventId: 'event_rock_fest',
      expectedEventId: 'event_jazz_night',
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('Event context mismatch');
  });

  it('should REJECT action when context is undefined but expected context is configured', () => {
    const evaluation = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'RESERVE',
      expectedAccountId: 'account_configured',
      // accountId omitted
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason).toContain('Account context mismatch');
  });

  it('should ALLOW valid actions in permissible states', () => {
    const selectEval = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'SELECT',
    });
    expect(selectEval.allowed).toBe(true);

    const reserveEval = ActionGuard.canExecuteAction({
      currentState: PurchaseState.SELECTING,
      action: 'RESERVE',
    });
    expect(reserveEval.allowed).toBe(true);

    const userActionEval = ActionGuard.canExecuteAction({
      currentState: PurchaseState.CAPTCHA_REQUIRED,
      action: 'USER_ACTION',
    });
    expect(userActionEval.allowed).toBe(true);
  });

  describe('P2-5: Per-state Action Allowlist Hardening', () => {
    it('CONFIRMED state should block ALL actions including SELECT_SEATS, PROCEED, FILL_FORM', () => {
      const actionsToTest: PurchaseActionType[] = [
        'SELECT_SEATS',
        'PROCEED',
        'FILL_FORM',
        'SELECT',
        'RESERVE',
        'PAYMENT',
        'USER_ACTION',
      ];

      for (const action of actionsToTest) {
        const evalResult = ActionGuard.canExecuteAction({
          currentState: PurchaseState.CONFIRMED,
          action,
        });
        expect(evalResult.allowed).toBe(false);
        expect(evalResult.reason).toContain('CONFIRMED');
      }
    });

    it('FAILED state should ONLY allow RESET or DISMISS', () => {
      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.FAILED,
          action: 'RESET',
        }).allowed
      ).toBe(true);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.FAILED,
          action: 'DISMISS',
        }).allowed
      ).toBe(true);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.FAILED,
          action: 'SELECT_SEATS',
        }).allowed
      ).toBe(false);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.FAILED,
          action: 'PROCEED',
        }).allowed
      ).toBe(false);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.FAILED,
          action: 'FILL_FORM',
        }).allowed
      ).toBe(false);
    });

    it('TICKET_SELECTED should allow PROCEED, SELECT_AREA, SELECT_SEATS, DESELECT but block SELECT_TICKET, RESERVE, PAYMENT', () => {
      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'PROCEED',
        }).allowed
      ).toBe(true);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'SELECT_AREA',
        }).allowed
      ).toBe(true);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'SELECT_SEATS',
        }).allowed
      ).toBe(true);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'DESELECT',
        }).allowed
      ).toBe(true);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'SELECT_TICKET',
        }).allowed
      ).toBe(false);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'RESERVE',
        }).allowed
      ).toBe(false);

      expect(
        ActionGuard.canExecuteAction({
          currentState: PurchaseState.TICKET_SELECTED,
          action: 'PAYMENT',
        }).allowed
      ).toBe(false);
    });
  });
});
