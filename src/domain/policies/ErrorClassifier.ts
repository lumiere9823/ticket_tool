import { FailureReason } from '../states/PurchaseState';

export type ErrorCategory =
  'BUSINESS' | 'AUTH' | 'PLATFORM' | 'NETWORK' | 'CHECKOUT' | 'PAYMENT' | 'UNKNOWN';

export interface ClassifiedError {
  category: ErrorCategory;
  reason: FailureReason;
  message: string;
  isRetryable: boolean;
}

export class ErrorClassifier {
  public static classify(error: unknown): ClassifiedError {
    if (!error) {
      return {
        category: 'UNKNOWN',
        reason: FailureReason.UNKNOWN,
        message: 'An unspecified error occurred',
        isRetryable: false,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    // Platform / Rate-limiting
    if (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('too many requests')
    ) {
      return {
        category: 'PLATFORM',
        reason: FailureReason.RATE_LIMITED,
        message: 'Rate limit detected from platform',
        isRetryable: false,
      };
    }

    // Auth / Session
    if (
      lower.includes('401') ||
      lower.includes('session expired') ||
      lower.includes('unauthorized') ||
      lower.includes('login required')
    ) {
      return {
        category: 'AUTH',
        reason: FailureReason.SESSION_EXPIRED,
        message: 'Ticketbox session has expired or requires authentication',
        isRetryable: false,
      };
    }

    // Auth Failure / Forbidden
    if (
      lower.includes('auth failed') ||
      lower.includes('authentication failed') ||
      lower.includes('forbidden') ||
      lower.includes('403')
    ) {
      return {
        category: 'AUTH',
        reason: FailureReason.AUTH_FAILURE,
        message: 'Authentication failed on Ticketbox',
        isRetryable: false,
      };
    }

    // Business - Sold out
    if (lower.includes('sold out') || lower.includes('hết vé') || lower.includes('out of stock')) {
      return {
        category: 'BUSINESS',
        reason: FailureReason.SOLD_OUT,
        message: 'Tickets in the selected category are sold out',
        isRetryable: true,
      };
    }

    // Business - Reservation failed
    if (
      lower.includes('reservation failed') ||
      lower.includes('cannot hold') ||
      lower.includes('hold rejected') ||
      lower.includes('giữ vé thất bại')
    ) {
      return {
        category: 'BUSINESS',
        reason: FailureReason.RESERVATION_FAILED,
        message: 'Reservation rejected by platform',
        isRetryable: true,
      };
    }

    // Payment failed
    if (lower.includes('payment failed') || lower.includes('thanh toán thất bại')) {
      return {
        category: 'PAYMENT',
        reason: FailureReason.PAYMENT_FAILED,
        message: 'Payment step failed',
        isRetryable: false,
      };
    }

    return {
      category: 'UNKNOWN',
      reason: FailureReason.UNKNOWN,
      message,
      isRetryable: false,
    };
  }
}
