import { describe, it, expect } from 'vitest';
import { SecurityChallengeHandler } from '../../../src/application/services/SecurityChallengeHandler';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ChallengeType } from '../../../src/application/ports/SecurityChallengeDetector';

describe('T3: SecurityChallengeHandler Service', () => {
  const challengeTypesTable: Array<{
    type: ChallengeType;
    targetState?: PurchaseState | undefined;
    expectedFinalState: PurchaseState;
  }> = [
    {
      type: 'RECAPTCHA',
      targetState: PurchaseState.CAPTCHA_REQUIRED,
      expectedFinalState: PurchaseState.CAPTCHA_REQUIRED,
    },
    {
      type: 'HCAPTCHA',
      targetState: PurchaseState.CAPTCHA_REQUIRED,
      expectedFinalState: PurchaseState.CAPTCHA_REQUIRED,
    },
    {
      type: 'TURNSTILE',
      targetState: PurchaseState.CAPTCHA_REQUIRED,
      expectedFinalState: PurchaseState.CAPTCHA_REQUIRED,
    },
    {
      type: 'OTP',
      targetState: PurchaseState.OTP_REQUIRED,
      expectedFinalState: PurchaseState.OTP_REQUIRED,
    },
    {
      type: 'AUTH_CHALLENGE',
      targetState: PurchaseState.SESSION_REAUTH_REQUIRED,
      expectedFinalState: PurchaseState.SESSION_REAUTH_REQUIRED,
    },
    {
      type: 'RATE_LIMIT',
      targetState: PurchaseState.RATE_LIMITED,
      expectedFinalState: PurchaseState.RATE_LIMITED,
    },
    {
      type: 'UNKNOWN',
      targetState: PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
      expectedFinalState: PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
    },
    {
      type: 'UNKNOWN',
      targetState: undefined, // defaults to HUMAN_INTERVENTION_REQUIRED
      expectedFinalState: PurchaseState.HUMAN_INTERVENTION_REQUIRED,
    },
  ];

  challengeTypesTable.forEach(({ type, targetState, expectedFinalState }) => {
    it(`transitions stateMachine to ${expectedFinalState} for challenge type ${type}`, () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      sm.transition({ type: 'ARM' });
      sm.transition({ type: 'MONITORING_STARTED' });
      expect(sm.state).toBe(PurchaseState.MONITORING);

      const result = SecurityChallengeHandler.handle(
        {
          detected: true,
          type,
          targetState,
          details: `Test challenge: ${type}`,
        },
        sm
      );

      expect(result.handled).toBe(true);
      expect(result.requiresUserAction).toBe(true);
      expect(result.finalState).toBe(expectedFinalState);
      expect(sm.state).toBe(expectedFinalState);
    });
  });

  it('does nothing when challenge.detected is false', () => {
    const sm = new PurchaseStateMachine(PurchaseState.READY);
    sm.transition({ type: 'ARM' });
    sm.transition({ type: 'MONITORING_STARTED' });
    expect(sm.state).toBe(PurchaseState.MONITORING);

    const result = SecurityChallengeHandler.handle(
      {
        detected: false,
      },
      sm
    );

    expect(result.handled).toBe(false);
    expect(result.requiresUserAction).toBe(false);
    expect(result.finalState).toBe(PurchaseState.MONITORING);
    expect(sm.state).toBe(PurchaseState.MONITORING);
  });
});
