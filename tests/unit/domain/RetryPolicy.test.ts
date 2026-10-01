import { describe, it, expect } from 'vitest';
import { RetryPolicy, FailureReason } from '../../../src/domain';

describe('RetryPolicy', () => {
  it('should classify RATE_LIMITED, SESSION_EXPIRED, UNKNOWN as non-retryable (Security Rule 07 & 08)', () => {
    const policy = new RetryPolicy({ maxAttempts: 3 });

    expect(policy.isRetryable(FailureReason.RATE_LIMITED)).toBe(false);
    expect(policy.isRetryable(FailureReason.SESSION_EXPIRED)).toBe(false);
    expect(policy.isRetryable(FailureReason.UNKNOWN)).toBe(false);
    expect(policy.isRetryable(FailureReason.PAYMENT_FAILED)).toBe(false);

    expect(policy.shouldRetry(FailureReason.RATE_LIMITED)).toBe(false);
  });

  it('should allow retry for transient business failures up to maxAttempts', () => {
    const policy = new RetryPolicy({ maxAttempts: 3 });

    expect(policy.isRetryable(FailureReason.RESERVATION_FAILED)).toBe(true);
    expect(policy.isRetryable(FailureReason.SOLD_OUT)).toBe(true);

    expect(policy.shouldRetry(FailureReason.RESERVATION_FAILED)).toBe(true);
    policy.recordAttempt(); // attempt 1
    expect(policy.shouldRetry(FailureReason.RESERVATION_FAILED)).toBe(true);
    policy.recordAttempt(); // attempt 2
    expect(policy.shouldRetry(FailureReason.RESERVATION_FAILED)).toBe(true);
    policy.recordAttempt(); // attempt 3

    // Exceeded maxAttempts
    expect(policy.shouldRetry(FailureReason.RESERVATION_FAILED)).toBe(false);
  });

  it('should calculate exponential backoff bounded by maxDelayMs', () => {
    const policy = new RetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 200,
      backoffMultiplier: 2,
      maxDelayMs: 1000,
    });

    policy.recordAttempt(); // 1: 200 * 2^0 = 200
    expect(policy.getBackoffDelayMs()).toBe(200);

    policy.recordAttempt(); // 2: 200 * 2^1 = 400
    expect(policy.getBackoffDelayMs()).toBe(400);

    policy.recordAttempt(); // 3: 200 * 2^2 = 800
    expect(policy.getBackoffDelayMs()).toBe(800);

    policy.recordAttempt(); // 4: 200 * 2^3 = 1600 -> capped at 1000
    expect(policy.getBackoffDelayMs()).toBe(1000);
  });

  it('should strictly bound backoff delay below by initialDelayMs when currentAttempts is 0', () => {
    const policy = new RetryPolicy({
      initialDelayMs: 500,
      backoffMultiplier: 1.5,
      maxDelayMs: 3000,
    });
    // With 0 attempts, previously 500 * (1.5)^(-1) = 333ms. Must now be >= 500ms
    expect(policy.attempts).toBe(0);
    expect(policy.getBackoffDelayMs()).toBeGreaterThanOrEqual(500);
    expect(policy.getBackoffDelayMs()).toBe(500);
  });

  it('should apply jitter and maintain lower bound of initialDelayMs', () => {
    const policy = new RetryPolicy({
      initialDelayMs: 500,
      backoffMultiplier: 1.5,
      maxDelayMs: 3000,
    });
    for (let i = 0; i < 50; i++) {
      const delay = policy.getBackoffDelayMs(true, 0.2);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(600); // 500 + 20%
    }
  });
});
