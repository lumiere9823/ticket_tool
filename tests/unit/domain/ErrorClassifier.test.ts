import { describe, it, expect } from 'vitest';
import { ErrorClassifier, FailureReason } from '../../../src/domain';

describe('ErrorClassifier', () => {
  it('should classify HTTP 429 / Rate Limit as PLATFORM non-retryable (Rule 11 & BR-006)', () => {
    const error = ErrorClassifier.classify(new Error('HTTP 429: Too Many Requests'));
    expect(error.category).toBe('PLATFORM');
    expect(error.reason).toBe(FailureReason.RATE_LIMITED);
    expect(error.isRetryable).toBe(false);
  });

  it('should classify Session Expired as AUTH non-retryable (Rule 09 & BR-007)', () => {
    const error = ErrorClassifier.classify('Ticketbox session expired, please login');
    expect(error.category).toBe('AUTH');
    expect(error.reason).toBe(FailureReason.SESSION_EXPIRED);
    expect(error.isRetryable).toBe(false);
  });

  it('should classify Sold Out as BUSINESS retryable', () => {
    const error = ErrorClassifier.classify('Tickets are sold out in this section');
    expect(error.category).toBe('BUSINESS');
    expect(error.reason).toBe(FailureReason.SOLD_OUT);
    expect(error.isRetryable).toBe(true);
  });

  it('should classify Reservation Rejection as BUSINESS retryable', () => {
    const error = ErrorClassifier.classify('Reservation failed: inventory unavailable');
    expect(error.category).toBe('BUSINESS');
    expect(error.reason).toBe(FailureReason.RESERVATION_FAILED);
    expect(error.isRetryable).toBe(true);
  });

  it('should classify Payment Failure as PAYMENT non-retryable', () => {
    const error = ErrorClassifier.classify('Payment failed on gateway');
    expect(error.category).toBe('PAYMENT');
    expect(error.reason).toBe(FailureReason.PAYMENT_FAILED);
    expect(error.isRetryable).toBe(false);
  });

  it('should classify unknown strings as UNKNOWN non-retryable (Rule 08)', () => {
    const error = ErrorClassifier.classify('Something weird and unexpected happened');
    expect(error.category).toBe('UNKNOWN');
    expect(error.reason).toBe(FailureReason.UNKNOWN);
    expect(error.isRetryable).toBe(false);
  });
});
