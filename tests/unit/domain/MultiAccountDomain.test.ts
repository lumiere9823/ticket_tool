import { describe, it, expect } from 'vitest';
import { AccountProfile, ProfileId } from '../../../src/domain';

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
});
