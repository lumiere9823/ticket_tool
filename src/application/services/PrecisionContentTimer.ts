/**
 * High-precision timer specifically designed for Content Script execution.
 * Architecture:
 * - Coarse wait: setTimeout until ~300ms before target T0
 * - Fine wait: requestAnimationFrame / performance.now() loop until target T0 is reached
 * - No busy-waiting loops (no while(true) blocking the thread)
 * - Safe against background tab throttling (falls back to setTimeout if rAF is paused)
 * - Cancellation on stop/cancel
 * - Idempotency guard: ensures the target callback runs exactly once
 */

export interface PrecisionTimerOptions {
  /** Target epoch timestamp in ms (client reference) */
  targetClientTimeMs: number;
  /** Threshold in ms before target to switch to rAF fine-stepping (default: 300ms) */
  fineWindowMs?: number;
  /** Callback fired exactly at or immediately after target timestamp */
  onTrigger: (triggerTimeMs: number) => void | Promise<void>;
}

export class PrecisionContentTimer {
  private coarseTimerHandle: ReturnType<typeof setTimeout> | null = null;
  private fineRafHandle: number | null = null;
  private fineTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private isTriggered = false;
  private isCancelled = false;

  constructor(private readonly options: PrecisionTimerOptions) {}

  public isRunning(): boolean {
    return !this.isTriggered && !this.isCancelled;
  }

  public start(clientNowMs: number = Date.now()): void {
    if (this.isTriggered || this.isCancelled) return;

    const remainingMs = this.options.targetClientTimeMs - clientNowMs;
    const fineWindowMs = this.options.fineWindowMs ?? 300;

    // If target has already arrived or within fine window, enter fine phase immediately
    if (remainingMs <= fineWindowMs) {
      this.startFinePhase();
    } else {
      // Coarse phase: sleep until (remainingMs - fineWindowMs)
      const coarseSleepMs = remainingMs - fineWindowMs;
      this.coarseTimerHandle = setTimeout(() => {
        this.coarseTimerHandle = null;
        if (!this.isCancelled && !this.isTriggered) {
          this.startFinePhase();
        }
      }, coarseSleepMs);
    }
  }

  public cancel(): void {
    this.isCancelled = true;
    if (this.coarseTimerHandle !== null) {
      clearTimeout(this.coarseTimerHandle);
      this.coarseTimerHandle = null;
    }
    if (this.fineRafHandle !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.fineRafHandle);
      this.fineRafHandle = null;
    }
    if (this.fineTimeoutHandle !== null) {
      clearTimeout(this.fineTimeoutHandle);
      this.fineTimeoutHandle = null;
    }
  }

  private startFinePhase(): void {
    if (this.isCancelled || this.isTriggered) return;

    // Use requestAnimationFrame if available in window, alongside a safety setTimeout
    // in case rAF is throttled in inactive tabs
    const checkTarget = () => {
      if (this.isCancelled || this.isTriggered) return;

      const now = Date.now();
      if (now >= this.options.targetClientTimeMs) {
        this.trigger(now);
      } else {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.fineRafHandle = requestAnimationFrame(checkTarget);
        } else {
          // In Node/non-DOM environments without rAF
          const diff = Math.max(1, this.options.targetClientTimeMs - now);
          this.fineTimeoutHandle = setTimeout(checkTarget, Math.min(diff, 16));
        }
      }
    };

    // Parallel backup timeout to avoid rAF freeze if tab loses focus
    const remainingMs = Math.max(0, this.options.targetClientTimeMs - Date.now());
    this.fineTimeoutHandle = setTimeout(() => {
      checkTarget();
    }, remainingMs);

    if (typeof requestAnimationFrame !== 'undefined') {
      this.fineRafHandle = requestAnimationFrame(checkTarget);
    }
  }

  private trigger(triggerTimeMs: number): void {
    if (this.isTriggered || this.isCancelled) return;
    this.isTriggered = true;
    this.cancel();
    void this.options.onTrigger(triggerTimeMs);
  }
}
