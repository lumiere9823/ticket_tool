/**
 * popup/timer-manager.ts
 *
 * Manages the live elapsed-time and scheduled-countdown timers in the popup UI.
 * Single source of truth for activeStartedAtMs and activeScheduledTargetMs.
 *
 * Extracted from the monolithic popup.ts to isolate timer lifecycle concerns.
 */

/** Phases that indicate monitoring has stopped — timer should halt. */
export const STOPPED_PHASES = new Set(['STOPPED', 'STOPPED_LIMIT_REACHED', 'CONFIRMED', 'FAILED']);

export interface TimerRefs {
  persistentElapsedDisplay: HTMLElement | null;
  scheduledArmCountdown: HTMLElement | null;
  basicScheduledCountdown: HTMLElement | null;
}

export interface TimerState {
  activeStartedAtMs: number | null;
  activeScheduledTargetMs: number | null;
  liveTimerInterval: number | null;
}

/** Formats elapsed milliseconds as MM:SS or HH:MM:SS */
export function formatElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${pad(hr)}:${pad(remMin)}:${pad(sec)}`;
  }
  return `${pad(min)}:${pad(sec)}`;
}

/** Formats remaining milliseconds as HH:MM:SS countdown */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '00:00:00';
  const totalSec = Math.floor(remainingMs / 1000);
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hr)}:${pad(min)}:${pad(sec)}`;
}

/**
 * PopupTimerManager — encapsulates all timer state and live-update logic
 * for the popup UI. Provides a clean start/stop/reset API.
 */
export class PopupTimerManager {
  private activeStartedAtMs: number | null = null;
  private activeScheduledTargetMs: number | null = null;
  private liveTimerInterval: number | null = null;
  private readonly refs: TimerRefs;
  private onScheduledArmFired?: (() => void) | undefined;

  constructor(refs: TimerRefs, onScheduledArmFired?: (() => void) | undefined) {
    this.refs = refs;
    this.onScheduledArmFired = onScheduledArmFired;
  }

  /** Start the 1-second live ticker. Idempotent (safe to call multiple times). */
  start(): void {
    if (typeof window === 'undefined' || this.liveTimerInterval !== null) return;
    this.tick();
    this.liveTimerInterval = window.setInterval(() => this.tick(), 1000);
    window.addEventListener('unload', () => this.stop(), { once: true });
  }

  /** Stop and cleanup all timers. */
  stop(): void {
    if (this.liveTimerInterval !== null && typeof window !== 'undefined') {
      window.clearInterval(this.liveTimerInterval);
      this.liveTimerInterval = null;
    }
    this.activeStartedAtMs = null;
    this.activeScheduledTargetMs = null;
  }

  /**
   * Update the started-at timestamp from persistent state.
   * Clears the timer when phase is terminal (STOPPED, FAILED, etc).
   */
  updateFromPersistentState(
    startedAt: string | number | undefined | null,
    currentPhase: string | undefined | null,
    maxDurationMinutes: number
  ): void {
    const durationCapStr = maxDurationMinutes > 0 ? `${maxDurationMinutes}m` : '∞';

    // Stop timer on terminal phases — even if startedAt still exists in storage
    if (startedAt && !STOPPED_PHASES.has(currentPhase ?? '')) {
      this.activeStartedAtMs =
        typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime();
    } else {
      this.activeStartedAtMs = null;
    }

    if (this.refs.persistentElapsedDisplay) {
      if (this.activeStartedAtMs) {
        const elapsedMs = Math.max(0, Date.now() - this.activeStartedAtMs);
        this.refs.persistentElapsedDisplay.textContent = `${formatElapsed(elapsedMs)} / ${durationCapStr}`;
      } else {
        this.refs.persistentElapsedDisplay.textContent = `00:00 / ${durationCapStr}`;
      }
    }
  }

  /** Immediately reset elapsed timer display (called on Stop button click). */
  resetElapsed(maxDurationMinutes: number): void {
    this.activeStartedAtMs = null;
    if (this.refs.persistentElapsedDisplay) {
      const durationCapStr = maxDurationMinutes > 0 ? `${maxDurationMinutes}m` : '∞';
      this.refs.persistentElapsedDisplay.textContent = `00:00 / ${durationCapStr}`;
    }
  }

  /** Set the scheduled ARM countdown target. */
  setScheduledTarget(targetMs: number | null): void {
    this.activeScheduledTargetMs = targetMs;
  }

  /** Clear the scheduled ARM countdown. */
  clearScheduledTarget(): void {
    this.activeScheduledTargetMs = null;
    if (this.refs.scheduledArmCountdown) this.refs.scheduledArmCountdown.style.display = 'none';
    if (this.refs.basicScheduledCountdown) this.refs.basicScheduledCountdown.style.display = 'none';
  }

  /** Exposes current started-at for display sync. */
  getActiveStartedAtMs(): number | null {
    return this.activeStartedAtMs;
  }

  private tick(): void {
    this.tickElapsed();
    this.tickCountdown();
  }

  private tickElapsed(): void {
    // Elapsed ticking is driven by updateFromPersistentState; tick only refreshes display
    if (!this.refs.persistentElapsedDisplay || !this.activeStartedAtMs) return;
    // Read maxDuration from display text to avoid circular dependency
    const elapsedMs = Math.max(0, Date.now() - this.activeStartedAtMs);
    const existingText = this.refs.persistentElapsedDisplay.textContent ?? '';
    const capPart = existingText.split('/')[1]?.trim() ?? '∞';
    this.refs.persistentElapsedDisplay.textContent = `${formatElapsed(elapsedMs)} / ${capPart}`;
  }

  private tickCountdown(): void {
    if (!this.activeScheduledTargetMs) {
      if (this.refs.scheduledArmCountdown) this.refs.scheduledArmCountdown.style.display = 'none';
      if (this.refs.basicScheduledCountdown)
        this.refs.basicScheduledCountdown.style.display = 'none';
      return;
    }

    const remainingMs = this.activeScheduledTargetMs - Date.now();
    if (remainingMs > 0) {
      const cdStr = `(Còn lại ${formatCountdown(remainingMs)})`;
      if (this.refs.scheduledArmCountdown) {
        this.refs.scheduledArmCountdown.textContent = cdStr;
        this.refs.scheduledArmCountdown.style.display = 'inline-flex';
      }
      if (this.refs.basicScheduledCountdown) {
        this.refs.basicScheduledCountdown.textContent = cdStr;
        this.refs.basicScheduledCountdown.style.display = 'inline-flex';
      }
    } else {
      const activatingStr = '(Đang kích hoạt...)';
      if (this.refs.scheduledArmCountdown) {
        this.refs.scheduledArmCountdown.textContent = activatingStr;
        this.refs.scheduledArmCountdown.style.display = 'inline-flex';
      }
      if (this.refs.basicScheduledCountdown) {
        this.refs.basicScheduledCountdown.textContent = activatingStr;
        this.refs.basicScheduledCountdown.style.display = 'inline-flex';
      }
      this.activeScheduledTargetMs = null;
      this.onScheduledArmFired?.();
    }
  }
}
