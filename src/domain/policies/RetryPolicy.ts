import { FailureReason } from '../states/PurchaseState';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 3000,
  backoffMultiplier: 1.5,
};

/**
 * Bounded Retry Policy enforcing Rule 07 ("No Infinite Automation")
 * and docs/ticketbox/09-error-and-retry-matrix.md
 */
export class RetryPolicy {
  private readonly config: RetryConfig;
  private currentAttempts = 0;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  public get attempts(): number {
    return this.currentAttempts;
  }

  public isRetryable(reason: FailureReason): boolean {
    switch (reason) {
      case FailureReason.RATE_LIMITED:
      case FailureReason.SESSION_EXPIRED:
      case FailureReason.AUTH_FAILURE:
      case FailureReason.PAYMENT_FAILED:
      case FailureReason.UNKNOWN:
        // Platform, security, or non-deterministic failures are NEVER automatically retried
        return false;

      case FailureReason.SOLD_OUT:
      case FailureReason.INVALID_SELECTION:
      case FailureReason.RESERVATION_FAILED:
      case FailureReason.CHECKOUT_FAILED:
        return this.currentAttempts < this.config.maxAttempts;

      default:
        return false;
    }
  }

  public shouldRetry(reason: FailureReason): boolean {
    if (!this.isRetryable(reason)) {
      return false;
    }
    return this.currentAttempts < this.config.maxAttempts;
  }

  public recordAttempt(): number {
    this.currentAttempts++;
    return this.currentAttempts;
  }

  public getBackoffDelayMs(applyJitter = false, jitterRatio = 0.2): number {
    const exponent = Math.max(0, this.currentAttempts - 1);
    const rawDelay =
      this.config.initialDelayMs *
      Math.pow(this.config.backoffMultiplier, exponent);
    const boundedDelay = Math.max(
      this.config.initialDelayMs,
      Math.min(rawDelay, this.config.maxDelayMs)
    );
    if (applyJitter && jitterRatio > 0) {
      const jitter = (Math.random() * 2 - 1) * jitterRatio * boundedDelay;
      return Math.max(this.config.initialDelayMs, Math.round(boundedDelay + jitter));
    }
    return boundedDelay;
  }

  public reset(): void {
    this.currentAttempts = 0;
  }
}
