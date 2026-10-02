import { FailureReason } from '../states/PurchaseState';
import { BookingError } from '../errors/BookingErrors';

export type ErrorCategory =
  'BUSINESS' | 'AUTH' | 'PLATFORM' | 'NETWORK' | 'CHECKOUT' | 'PAYMENT' | 'UNKNOWN';

export type StandardErrorCategory =
  | 'TRANSIENT'
  | 'RETRYABLE'
  | 'NON_RETRYABLE'
  | 'AUTH'
  | 'BUSINESS_FAILURE'
  | 'NETWORK_FAILURE'
  | 'RATE_LIMIT'
  | 'QUEUE'
  | 'BOT_DEFENSE'
  | 'CAPTCHA';

export interface ClassifiedError {
  category: ErrorCategory;
  standardCategory: StandardErrorCategory;
  reason: FailureReason;
  message: string;
  isRetryable: boolean;
}

export class ErrorClassifier {
  public static isNonRetryableSafetySignal(classified: ClassifiedError): boolean {
    return (
      classified.standardCategory === 'RATE_LIMIT' ||
      classified.standardCategory === 'CAPTCHA' ||
      classified.standardCategory === 'BOT_DEFENSE' ||
      classified.standardCategory === 'QUEUE' ||
      classified.standardCategory === 'AUTH' ||
      classified.reason === FailureReason.RATE_LIMITED ||
      classified.reason === FailureReason.SESSION_EXPIRED ||
      classified.reason === FailureReason.AUTH_FAILURE
    );
  }

  public static classify(error: unknown): ClassifiedError {
    if (!error) {
      return {
        category: 'UNKNOWN',
        standardCategory: 'NON_RETRYABLE',
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
            standardCategory: 'BUSINESS_FAILURE',
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
            standardCategory: 'RETRYABLE',
            reason: FailureReason.RESERVATION_FAILED,
            message: error.message,
            isRetryable: true,
          };
        case 'CONSENT_REQUIRED':
          return {
            category: 'BUSINESS',
            standardCategory: 'NON_RETRYABLE',
            reason: FailureReason.INVALID_SELECTION,
            message: error.message,
            isRetryable: false,
          };
        case 'PAYMENT_REQUIRED':
          return {
            category: 'PAYMENT',
            standardCategory: 'NON_RETRYABLE',
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
          standardCategory: 'RATE_LIMIT',
          reason: FailureReason.RATE_LIMITED,
          message: message || 'Rate limit detected from platform',
          isRetryable: false,
        };
      }

      if (code.includes('CAPTCHA') || code.includes('CHALLENGE')) {
        return {
          category: 'PLATFORM',
          standardCategory: 'CAPTCHA',
          reason: FailureReason.RATE_LIMITED,
          message: message || 'CAPTCHA challenge detected',
          isRetryable: false,
        };
      }

      if (code.includes('BOT') || code.includes('CLOUDFLARE') || code.includes('DATADOME')) {
        return {
          category: 'PLATFORM',
          standardCategory: 'BOT_DEFENSE',
          reason: FailureReason.RATE_LIMITED,
          message: message || 'Bot defense challenge detected',
          isRetryable: false,
        };
      }

      if (code.includes('QUEUE') || code.includes('WAITING_ROOM')) {
        return {
          category: 'PLATFORM',
          standardCategory: 'QUEUE',
          reason: FailureReason.RATE_LIMITED,
          message: message || 'Waiting room queue active',
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
          standardCategory: 'AUTH',
          reason: FailureReason.SESSION_EXPIRED,
          message: message || 'Ticketbox session has expired or requires authentication',
          isRetryable: false,
        };
      }

      if (status === 403 || code === '403' || code === 'FORBIDDEN' || code === 'AUTH_FAILURE') {
        return {
          category: 'AUTH',
          standardCategory: 'AUTH',
          reason: FailureReason.AUTH_FAILURE,
          message: message || 'Authentication failed on Ticketbox',
          isRetryable: false,
        };
      }

      if (status === 404 || code === '404' || code === 'NOT_FOUND') {
        return {
          category: 'PLATFORM',
          standardCategory: 'TRANSIENT',
          reason: FailureReason.UNKNOWN,
          message: message || 'Resource not found (404)',
          isRetryable: true,
        };
      }

      if (
        status === 502 ||
        status === 503 ||
        status === 504 ||
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'NETWORK_ERROR'
      ) {
        return {
          category: 'NETWORK',
          standardCategory: 'NETWORK_FAILURE',
          reason: FailureReason.UNKNOWN,
          message: message || 'Network failure detected',
          isRetryable: true,
        };
      }
    }

    // ── 3. Classification via explicit regex with word boundaries ────────────
    // CAPTCHA challenge: match captcha, recaptcha, hcaptcha, turnstile
    if (/\b(?:captcha|recaptcha|hcaptcha|turnstile|geetest)\b/i.test(message)) {
      return {
        category: 'PLATFORM',
        standardCategory: 'CAPTCHA',
        reason: FailureReason.RATE_LIMITED,
        message: 'CAPTCHA challenge detected',
        isRetryable: false,
      };
    }

    // Bot defense / WAF challenges
    if (
      /\b(?:datadome|perimeterx|cloudflare\s+challenge|anti[-_\s]?bot|access\s+blocked\s+by\s+security)\b/i.test(
        message
      )
    ) {
      return {
        category: 'PLATFORM',
        standardCategory: 'BOT_DEFENSE',
        reason: FailureReason.RATE_LIMITED,
        message: 'Bot defense challenge detected',
        isRetryable: false,
      };
    }

    // Virtual queue / waiting room
    if (/\b(?:waiting\s*room|queue-it|virtual\s*queue|hàng\s+đợi\s+chờ)\b/i.test(message)) {
      return {
        category: 'PLATFORM',
        standardCategory: 'QUEUE',
        reason: FailureReason.RATE_LIMITED,
        message: 'Waiting room queue active',
        isRetryable: false,
      };
    }

    // Rate-limiting: match "HTTP 429", "status: 429", "code: 429", "rate limit", or "too many requests"
    if (
      /\b(?:HTTP\s*429|status[:\s=]+429|code[:\s=]+429|429\s+too\s+many\s+requests|rate\s*limit(?:ed)?|too\s+many\s+requests)\b/i.test(
        message
      )
    ) {
      return {
        category: 'PLATFORM',
        standardCategory: 'RATE_LIMIT',
        reason: FailureReason.RATE_LIMITED,
        message: 'Rate limit detected from platform',
        isRetryable: false,
      };
    }

    // Auth / Session expiration
    if (
      /\b(?:HTTP\s*401|status[:\s=]+401|code[:\s=]+401|401\s+unauthorized|session\s+(?:has\s+)?expired|unauthorized|login\s+required)\b/i.test(
        message
      )
    ) {
      return {
        category: 'AUTH',
        standardCategory: 'AUTH',
        reason: FailureReason.SESSION_EXPIRED,
        message: 'Ticketbox session has expired or requires authentication',
        isRetryable: false,
      };
    }

    // Auth Failure / Forbidden
    if (
      /\b(?:HTTP\s*403|status[:\s=]+403|code[:\s=]+403|403\s+forbidden|auth(?:entication)?\s+failed|forbidden|access\s+denied)\b/i.test(
        message
      )
    ) {
      return {
        category: 'AUTH',
        standardCategory: 'AUTH',
        reason: FailureReason.AUTH_FAILURE,
        message: 'Authentication failed on Ticketbox',
        isRetryable: false,
      };
    }

    // Network failures
    if (
      /\b(?:fetch\s+failed|network\s+error|econnreset|etimedout|connection\s+reset|timeout)\b/i.test(
        message
      )
    ) {
      return {
        category: 'NETWORK',
        standardCategory: 'NETWORK_FAILURE',
        reason: FailureReason.UNKNOWN,
        message: 'Network failure detected',
        isRetryable: true,
      };
    }

    // Business - Sold out
    if (/\b(?:sold\s*out|hết\s+vé|out\s+of\s+stock)\b/i.test(message)) {
      return {
        category: 'BUSINESS',
        standardCategory: 'BUSINESS_FAILURE',
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
        standardCategory: 'RETRYABLE',
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
        standardCategory: 'NON_RETRYABLE',
        reason: FailureReason.PAYMENT_FAILED,
        message: 'Payment step failed',
        isRetryable: false,
      };
    }

    return {
      category: 'UNKNOWN',
      standardCategory: 'NON_RETRYABLE',
      reason: FailureReason.UNKNOWN,
      message,
      isRetryable: false,
    };
  }
}
