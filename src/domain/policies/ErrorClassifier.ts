import { FailureReason } from '../states/PurchaseState';
import { BookingError } from '../errors/BookingErrors';

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

    // ── 1. Classification via domain BookingError ───────────────────────────
    if (error instanceof BookingError) {
      switch (error.code) {
        case 'SEAT_UNAVAILABLE':
        case 'NO_TICKETS':
        case 'NO_AVAILABLE_TICKET':
        case 'NO_AVAILABLE_SEATS':
        case 'ALL_AREAS_EXHAUSTED':
          return {
            category: 'BUSINESS',
            reason: FailureReason.SOLD_OUT,
            message: error.message,
            isRetryable: true,
          };
        case 'SEAT_SELECTION_FAILED':
        case 'AREA_SELECTION_FAILED':
        case 'TICKET_SELECTION_FAILED':
        case 'PROCEED_FAILED':
          return {
            category: 'BUSINESS',
            reason: FailureReason.RESERVATION_FAILED,
            message: error.message,
            isRetryable: true,
          };
        case 'CONSENT_REQUIRED':
          return {
            category: 'BUSINESS',
            reason: FailureReason.INVALID_SELECTION,
            message: error.message,
            isRetryable: false,
          };
        case 'PAYMENT_REQUIRED':
          return {
            category: 'PAYMENT',
            reason: FailureReason.PAYMENT_FAILED,
            message: error.message,
            isRetryable: false,
          };
      }
    }

    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : error instanceof Error
          ? error.message
          : String(error);

    // ── 2. Classification via structured HTTP status / code properties ──────
    if (typeof error === 'object' && error !== null) {
      const errObj = error as Record<string, unknown>;
      const rawStatus =
        errObj['status'] ??
        errObj['statusCode'] ??
        (typeof errObj['response'] === 'object' && errObj['response'] !== null
          ? (errObj['response'] as Record<string, unknown>)['status']
          : undefined);
      const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
      const rawCode = errObj['code'];
      const code = typeof rawCode === 'string' ? rawCode.toUpperCase() : String(rawCode ?? '');

      if (
        status === 429 ||
        code === '429' ||
        code === 'RATE_LIMITED' ||
        code === 'TOO_MANY_REQUESTS'
      ) {
        return {
          category: 'PLATFORM',
          reason: FailureReason.RATE_LIMITED,
          message: message || 'Rate limit detected from platform',
          isRetryable: false,
        };
      }

      if (
        status === 401 ||
        code === '401' ||
        code === 'UNAUTHORIZED' ||
        code === 'SESSION_EXPIRED'
      ) {
        return {
          category: 'AUTH',
          reason: FailureReason.SESSION_EXPIRED,
          message: message || 'Ticketbox session has expired or requires authentication',
          isRetryable: false,
        };
      }

      if (status === 403 || code === '403' || code === 'FORBIDDEN' || code === 'AUTH_FAILURE') {
        return {
          category: 'AUTH',
          reason: FailureReason.AUTH_FAILURE,
          message: message || 'Authentication failed on Ticketbox',
          isRetryable: false,
        };
      }
    }

    // ── 3. Classification via explicit regex with word boundaries ────────────
    // Rate-limiting: match "HTTP 429", "status: 429", "code: 429", "rate limit", or "too many requests"
    // Never match arbitrary numbers in seat labels (e.g. "Seat A429") or prices.
    if (
      /\b(?:HTTP\s*429|status[:\s=]+429|code[:\s=]+429|429\s+too\s+many\s+requests|rate\s*limit(?:ed)?|too\s+many\s+requests)\b/i.test(
        message
      )
    ) {
      return {
        category: 'PLATFORM',
        reason: FailureReason.RATE_LIMITED,
        message: 'Rate limit detected from platform',
        isRetryable: false,
      };
    }

    // Auth / Session expiration: match "HTTP 401", "status: 401", "session expired", etc.
    // Never match event numbers like "Event 401".
    if (
      /\b(?:HTTP\s*401|status[:\s=]+401|code[:\s=]+401|401\s+unauthorized|session\s+(?:has\s+)?expired|unauthorized|login\s+required)\b/i.test(
        message
      )
    ) {
      return {
        category: 'AUTH',
        reason: FailureReason.SESSION_EXPIRED,
        message: 'Ticketbox session has expired or requires authentication',
        isRetryable: false,
      };
    }

    // Auth Failure / Forbidden: match "HTTP 403", "status: 403", "forbidden", etc.
    // Never match prices like "403000 VND".
    if (
      /\b(?:HTTP\s*403|status[:\s=]+403|code[:\s=]+403|403\s+forbidden|auth(?:entication)?\s+failed|forbidden|access\s+denied)\b/i.test(
        message
      )
    ) {
      return {
        category: 'AUTH',
        reason: FailureReason.AUTH_FAILURE,
        message: 'Authentication failed on Ticketbox',
        isRetryable: false,
      };
    }

    // Business - Sold out
    if (/\b(?:sold\s*out|hết\s+vé|out\s+of\s+stock)\b/i.test(message)) {
      return {
        category: 'BUSINESS',
        reason: FailureReason.SOLD_OUT,
        message: 'Tickets in the selected category are sold out',
        isRetryable: true,
      };
    }

    // Business - Reservation failed
    if (
      /\b(?:reservation\s+failed|cannot\s+hold|hold\s+rejected|giữ\s+vé\s+thất\s+bại)\b/i.test(
        message
      )
    ) {
      return {
        category: 'BUSINESS',
        reason: FailureReason.RESERVATION_FAILED,
        message: 'Reservation rejected by platform',
        isRetryable: true,
      };
    }

    // Payment failed
    if (
      /\b(?:payment\s+failed|thanh\s+toán\s+thất\s+bại|checkout\s+failed|payment\s+step\s+failed)\b/i.test(
        message
      )
    ) {
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
