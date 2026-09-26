import { describe, it, expect } from 'vitest';
import {
  AccountProfile,
  ProfileId,
  ExecutionPolicy,
  ExecutionPolicyType,
  GlobalStopPolicy,
  FailureReason,
} from '../../../src/domain';

describe('MultiAccountDomain', () => {
  it('should isolate AccountProfile with valid ProfileId', () => {
    const profileIdA = new ProfileId('profile_a');
    const profileIdB = new ProfileId('profile_b');

    const accountA = new AccountProfile(profileIdA, 'acc_001', 'Account Alpha');
    const accountB = new AccountProfile(profileIdB, 'acc_002', 'Account Beta');

    expect(accountA.profileId.value).toBe('profile_a');
    expect(accountB.profileId.value).toBe('profile_b');
    expect(accountA.profileId.equals(accountB.profileId)).toBe(false);
  });

  it('should trigger broadcast stop on success under ONE_SUCCESS policy', () => {
    const policy = new ExecutionPolicy(ExecutionPolicyType.ONE_SUCCESS);
    const stopPolicy = new GlobalStopPolicy(policy);

    const evaluation = stopPolicy.evaluateSuccess();
    expect(evaluation.shouldBroadcastStop).toBe(true);
    expect(evaluation.reason).toContain('ONE_SUCCESS');
  });

  it('should NOT trigger broadcast stop on success under MULTIPLE_SUCCESS policy', () => {
    const policy = new ExecutionPolicy(ExecutionPolicyType.MULTIPLE_SUCCESS);
    const stopPolicy = new GlobalStopPolicy(policy);

    const evaluation = stopPolicy.evaluateSuccess();
    expect(evaluation.shouldBroadcastStop).toBe(false);
  });

  it('should trigger immediate broadcast stop when RATE_LIMITED failure occurs', () => {
    const policy = new ExecutionPolicy(ExecutionPolicyType.MULTIPLE_SUCCESS);
    const stopPolicy = new GlobalStopPolicy(policy);

    const evaluation = stopPolicy.evaluateFailure(FailureReason.RATE_LIMITED);
    expect(evaluation.shouldBroadcastStop).toBe(true);
    expect(evaluation.reason).toContain('Rate limit');
  });

  it('should NOT trigger broadcast stop for ordinary business failures', () => {
    const policy = new ExecutionPolicy(ExecutionPolicyType.ONE_SUCCESS);
    const stopPolicy = new GlobalStopPolicy(policy);

    const evaluation = stopPolicy.evaluateFailure(FailureReason.SOLD_OUT);
    expect(evaluation.shouldBroadcastStop).toBe(false);
  });
});
