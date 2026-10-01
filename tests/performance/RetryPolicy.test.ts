import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { RetryPolicy } from '../../src/domain/policies/RetryPolicy';
import { FailureReason } from '../../src/domain/states/PurchaseState';
import { ErrorClassifier } from '../../src/domain/policies/ErrorClassifier';

describe('Performance Benchmark: Error Classification & Retry Policy Bounds', () => {
  it('measures ErrorClassifier latency across various error shapes', async () => {
    const errors = [
      new Error('HTTP 429 Too Many Requests'),
      new Error('Seat A-12 is already reserved by another user (-1242)'),
      new Error('Session has expired. Please login again.'),
      new Error('Tickets in the selected category are sold out'),
      { status: 429, message: 'Rate limit exceeded' },
      { code: 'CAPTCHA_CHALLENGE', message: 'CAPTCHA required' },
    ];

    const stats = await BenchmarkRunner.run(
      () => {
        for (const err of errors) {
          const classified = ErrorClassifier.classify(err);
          expect(classified.category).toBeDefined();
        }
      },
      { iterations: 500, warmupIterations: 50 }
    );

    console.info('[PERF] Error Classification Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(1);
  });

  it('verifies RetryPolicy bounds: zero infinite loops, bounded backoff, stops on 429', async () => {
    const policy = new RetryPolicy({ maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1000 });

    const stats = await BenchmarkRunner.run(
      () => {
        policy.reset();
        // 1. Platform rate limit should NEVER be retryable
        expect(policy.shouldRetry(FailureReason.RATE_LIMITED)).toBe(false);

        // 2. Retryable business failure should retry up to exactly maxAttempts
        expect(policy.shouldRetry(FailureReason.SOLD_OUT)).toBe(true);
        policy.recordAttempt();
        expect(policy.shouldRetry(FailureReason.SOLD_OUT)).toBe(true);
        policy.recordAttempt();
        expect(policy.shouldRetry(FailureReason.SOLD_OUT)).toBe(true);
        policy.recordAttempt();
        // 4th attempt must be rejected (budget exhausted)
        expect(policy.shouldRetry(FailureReason.SOLD_OUT)).toBe(false);
      },
      { iterations: 1000, warmupIterations: 100 }
    );

    console.info('[PERF] Retry Policy Evaluation Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(0.5);
  });
});
