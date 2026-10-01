import { describe, it, expect } from 'vitest';
import { ErrorClassifier, FailureReason, PurchaseState } from '../../../src/domain';
import { BookingError } from '../../../src/domain/errors/BookingErrors';

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

  describe('P2-1: False Positive Substring Avoidance (Negative Tests)', () => {
    it('should NOT classify "Seat A429" as RATE_LIMITED (preventing accidental global stop)', () => {
      const error = ErrorClassifier.classify(new Error('Seat A429 is already taken'));
      expect(error.reason).not.toBe(FailureReason.RATE_LIMITED);
      expect(error.category).not.toBe('PLATFORM');
    });

    it('should NOT classify "403000 VND" price message as AUTH_FAILURE', () => {
      const error = ErrorClassifier.classify('Ticket price is 403000 VND per seat');
      expect(error.reason).not.toBe(FailureReason.AUTH_FAILURE);
      expect(error.category).not.toBe('AUTH');
    });

    it('should NOT classify "Event 401" title/announcement as SESSION_EXPIRED', () => {
      const error = ErrorClassifier.classify('Event 401 has been updated with new schedule');
      expect(error.reason).not.toBe(FailureReason.SESSION_EXPIRED);
      expect(error.category).not.toBe('AUTH');
    });
  });

  describe('P2-1: Structured Error Classification', () => {
    it('should classify structured HTTP status 429 as RATE_LIMITED', () => {
      const error = ErrorClassifier.classify({ status: 429, message: 'Too many requests' });
      expect(error.category).toBe('PLATFORM');
      expect(error.reason).toBe(FailureReason.RATE_LIMITED);
      expect(error.isRetryable).toBe(false);
    });

    it('should classify structured statusCode 401 as SESSION_EXPIRED', () => {
      const error = ErrorClassifier.classify({ statusCode: 401, message: 'Unauthorized' });
      expect(error.category).toBe('AUTH');
      expect(error.reason).toBe(FailureReason.SESSION_EXPIRED);
    });

    it('should classify structured code 403 as AUTH_FAILURE', () => {
      const error = ErrorClassifier.classify({ code: 403, message: 'Forbidden' });
      expect(error.category).toBe('AUTH');
      expect(error.reason).toBe(FailureReason.AUTH_FAILURE);
    });

    it('should classify BookingError with SEAT_UNAVAILABLE as BUSINESS retryable', () => {
      const bError = new BookingError({
        code: 'SEAT_UNAVAILABLE',
        message: 'Seat A429 is unavailable',
        state: PurchaseState.SEAT_SELECTION,
        recoverable: true,
      });
      const classified = ErrorClassifier.classify(bError);
      expect(classified.category).toBe('BUSINESS');
      expect(classified.reason).toBe(FailureReason.SOLD_OUT);
      expect(classified.isRetryable).toBe(true);
    });
  });
});
