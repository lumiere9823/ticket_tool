export interface AlarmProvider {
  clear(name: string): void;
  create(name: string, alarmInfo: { when: number }): void;
}

/**
 * Service managing Scheduled ARM timers with strict cancellation and idempotent locking.
 * Enforces:
 * - Pre-existing timeout cancellation before setting new timers (avoids duplicate/overlapping ARM triggers)
 * - Cancellation on stop, reset, or manual cancel
 * - Idempotent lock protecting against concurrent ARM invocations
 */
export class ScheduledArmManager {
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private isExecuting = false;

  constructor(private readonly alarmProvider?: AlarmProvider) {}

  public isScheduled(): boolean {
    return this.timeoutHandle !== null;
  }

  public isRunning(): boolean {
    return this.isExecuting;
  }

  public schedule(
    startMs: number,
    onExecute: () => Promise<void>,
    nowMs: number = Date.now()
  ): { delayMs: number; isShortDelay: boolean } {
    // 1. Cancel any existing pending timer/alarm before scheduling new one
    this.cancel();

    const delayMs = startMs - nowMs;

    // 2. Schedule Chrome alarms if available
    if (this.alarmProvider) {
      this.alarmProvider.clear('SCHEDULED_ARM');
      this.alarmProvider.clear('SCHEDULED_ARM_PREWAKE');
      this.alarmProvider.create('SCHEDULED_ARM', { when: startMs });
      if (delayMs > 30_000) {
        this.alarmProvider.create('SCHEDULED_ARM_PREWAKE', { when: startMs - 25_000 });
      }
    }

    // 3. Fallback sub-second precision timeout for delays <= 5 minutes
    const isShortDelay = delayMs > 0 && delayMs <= 300_000;
    if (isShortDelay) {
      this.timeoutHandle = setTimeout(async () => {
        this.timeoutHandle = null;
        await this.execute(onExecute);
      }, delayMs);
    }

    return { delayMs, isShortDelay };
  }

  public cancel(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.alarmProvider) {
      this.alarmProvider.clear('SCHEDULED_ARM');
      this.alarmProvider.clear('SCHEDULED_ARM_PREWAKE');
    }
  }

  public async execute(onExecute: () => Promise<void>): Promise<boolean> {
    // Idempotent lock: prevent concurrent execution
    if (this.isExecuting) {
      return false;
    }

    this.isExecuting = true;

    // Clear any timeout handle if fired or executed manually
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    try {
      await onExecute();
      return true;
    } finally {
      this.isExecuting = false;
    }
  }
}
