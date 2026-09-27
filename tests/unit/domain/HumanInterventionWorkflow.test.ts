import { describe, it, expect } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  HumanInterventionRecord,
  HumanInterventionStatus,
  isHumanInterventionState,
  ActionGuard,
} from '../../../src/domain';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';

describe('Human Intervention Workflow (Section 7, 8, 27)', () => {
  it('should follow canonical human intervention lifecycle: PAUSE -> PERSIST -> NOTIFY -> USER ACTION -> RECHECK -> RESUME', async () => {
    const storage = new ChromeStorageRepository();
    const sm = new PurchaseStateMachine(PurchaseState.MONITORING, 'attempt_hi_1', {
      accountId: 'acc_001',
      profileId: 'prof_001',
      eventId: 'evt_123',
      workflowId: 'wf_456',
    });

    // 1. CAPTCHA detected during MONITORING
    const context = sm.transition({
      type: 'CAPTCHA_REQUIRED',
      challengeId: 'cap_challenge_99',
    });

    expect(sm.state).toBe(PurchaseState.CAPTCHA_REQUIRED);
    expect(isHumanInterventionState(sm.state)).toBe(true);

    // 2. Automation is PAUSED (ActionGuard rejects all automation actions)
    const reserveAttempt = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'RESERVE',
    });
    expect(reserveAttempt.allowed).toBe(false);
    expect(reserveAttempt.reason).toContain('human intervention');

    // 3. Create & Persist HumanInterventionRecord
    const interventionRecord = new HumanInterventionRecord({
      id: 'hi_rec_001',
      accountId: sm.accountId!,
      profileId: sm.profileId,
      eventId: sm.eventId!,
      workflowId: sm.workflowId!,
      state: sm.state,
      reason: 'Anti-automation CAPTCHA challenge detected',
      detectedAt: new Date().toISOString(),
      previousState: context.previousState!,
      status: HumanInterventionStatus.PENDING,
    });

    // 4. Notify User
    interventionRecord.markNotificationSent();
    await storage.saveHumanInterventionRecord(interventionRecord.toJSON());

    // Verify stored record
    const retrieved = await storage.getHumanInterventionRecord('hi_rec_001');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.['status']).toBe(HumanInterventionStatus.PENDING);
    expect(retrieved?.['notificationSentAt']).toBeDefined();

    // 5. User action in browser
    interventionRecord.markUserAction();
    sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
    expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

    // Automation is STILL not allowed to blindly execute without state verification
    const blindReserveAttempt = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'RESERVE',
    });
    // In STATE_RECHECK, reserve is rejected
    expect(blindReserveAttempt.allowed).toBe(false);

    // 6. State Revalidation confirms page returned to verified MONITORING state
    sm.transition({
      type: 'STATE_VERIFIED',
      verifiedState: PurchaseState.MONITORING,
    });

    expect(sm.state).toBe(PurchaseState.MONITORING);
    interventionRecord.resolve(sm.state);
    await storage.saveHumanInterventionRecord(interventionRecord.toJSON());

    const finalRecord = await storage.getHumanInterventionRecord('hi_rec_001');
    expect(finalRecord?.['status']).toBe(HumanInterventionStatus.RESOLVED);
    expect(finalRecord?.['nextState']).toBe(PurchaseState.MONITORING);
  });

  it('should DO NOT RESUME if user action completed but state remains unknown/invalid (Section 27)', async () => {
    const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

    // Challenge detected
    sm.transition({ type: 'CAPTCHA_REQUIRED' });
    expect(sm.state).toBe(PurchaseState.CAPTCHA_REQUIRED);

    // User completes challenge -> enters STATE_RECHECK
    sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
    expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

    // Page state re-evaluation fails to verify state
    sm.transition({
      type: 'STATE_UNVERIFIED',
      reason: 'Page structure changed to unrecognized intermediate view',
    });

    // Transitions to safe UNKNOWN state, NOT resuming automation
    expect(sm.state).toBe(PurchaseState.UNKNOWN);
    expect(sm.failureMessage).toContain('unrecognized intermediate view');

    const guardEval = ActionGuard.canExecuteAction({
      currentState: sm.state,
      action: 'RESERVE',
    });
    expect(guardEval.allowed).toBe(false);
  });

  it('should support OTP_REQUIRED, PAYMENT_ACTION_REQUIRED, SESSION_REAUTH_REQUIRED, and UNKNOWN_SECURITY_CHALLENGE', () => {
    // OTP_REQUIRED
    const smOtp = new PurchaseStateMachine(PurchaseState.RESERVING);
    smOtp.transition({ type: 'SESSION_EXPIRED' });
    expect(smOtp.state).toBe(PurchaseState.SESSION_REAUTH_REQUIRED);
    expect(isHumanInterventionState(smOtp.state)).toBe(true);

    // PAYMENT_ACTION_REQUIRED from CHECKOUT
    const smCheckout = new PurchaseStateMachine(PurchaseState.CHECKOUT);
    smCheckout.transition({ type: 'PAYMENT_ACTION_REQUIRED' });
    expect(smCheckout.state).toBe(PurchaseState.PAYMENT_ACTION_REQUIRED);
    expect(isHumanInterventionState(smCheckout.state)).toBe(true);

    // UNKNOWN_SECURITY_CHALLENGE from CHECKOUT
    const smUnknownSec = new PurchaseStateMachine(PurchaseState.CHECKOUT);
    smUnknownSec.transition({ type: 'UNKNOWN_SECURITY_CHALLENGE' });
    expect(smUnknownSec.state).toBe(PurchaseState.UNKNOWN_SECURITY_CHALLENGE);
    expect(isHumanInterventionState(smUnknownSec.state)).toBe(true);
  });
});
