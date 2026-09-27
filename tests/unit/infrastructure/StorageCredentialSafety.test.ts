import { describe, it, expect } from 'vitest';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { PurchaseState, StateContext } from '../../../src/domain';

describe('Storage Credential Safety (Rule 09, Section 20)', () => {
  it('should NEVER persist password, OTP, CVV, card numbers, or session cookies in StateContext', async () => {
    const storage = new ChromeStorageRepository();

    const dirtyContext: StateContext & Record<string, unknown> = {
      currentState: PurchaseState.MONITORING,
      attemptId: 'attempt_safe_1',
      updatedAt: new Date().toISOString(),
      password: 'mypassword123',
      otp: '654321',
      cvv: '123',
      card: '4111222233334444',
      cookie: 'tb_session=abcdef12345',
      sessionToken: 'token_xyz',
    };

    await storage.saveCurrentState(dirtyContext);

    const loaded = (await storage.getLastState()) as unknown as Record<string, unknown>;
    expect(loaded).not.toBeNull();
    expect(loaded['currentState']).toBe(PurchaseState.MONITORING);
    expect(loaded['attemptId']).toBe('attempt_safe_1');

    // Highly sensitive keys must NOT exist in storage
    expect(loaded['password']).toBeUndefined();
    expect(loaded['otp']).toBeUndefined();
    expect(loaded['cvv']).toBeUndefined();
    expect(loaded['card']).toBeUndefined();
    expect(loaded['cookie']).toBeUndefined();
    expect(loaded['sessionToken']).toBeUndefined();
  });

  it('should NEVER persist credentials in AssistantConfiguration', async () => {
    const storage = new ChromeStorageRepository();

    const dirtyConfig = {
      targetEventUrl: 'https://ticketbox.vn/event/sample-123',
      discoveryMode: false,
      password: 'secret_login_password',
      otp: '998877',
      cvv: '456',
    };

    await storage.saveConfiguration(dirtyConfig as never);

    const loaded = (await storage.getConfiguration()) as unknown as Record<string, unknown>;
    expect(loaded).not.toBeNull();
    expect(loaded['targetEventUrl']).toBe('https://ticketbox.vn/event/sample-123');
    expect(loaded['password']).toBeUndefined();
    expect(loaded['otp']).toBeUndefined();
    expect(loaded['cvv']).toBeUndefined();
  });
});
