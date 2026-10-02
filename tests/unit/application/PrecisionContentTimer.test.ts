import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrecisionContentTimer } from '../../../src/application/services/PrecisionContentTimer';

describe('PrecisionContentTimer (N2 - Content Script Precision Timer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers callback when target timestamp is reached via coarse + fine phase', () => {
    const onTrigger = vi.fn();
    const now = 100_000;
    const target = now + 5000; // 5s in future

    const timer = new PrecisionContentTimer({
      targetClientTimeMs: target,
      fineWindowMs: 300,
      onTrigger,
    });

    timer.start(now);
    expect(timer.isRunning()).toBe(true);

    // Fast-forward coarse phase (4700ms)
    vi.advanceTimersByTime(4700);
    expect(onTrigger).not.toHaveBeenCalled();

    // Fast-forward fine phase (300ms)
    vi.advanceTimersByTime(300);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(timer.isRunning()).toBe(false);
  });

  it('triggers immediately if target has already passed or is within fine window', () => {
    const onTrigger = vi.fn();
    const now = 100_000;
    const target = now + 100; // only 100ms remaining (< 300ms fine window)

    const timer = new PrecisionContentTimer({
      targetClientTimeMs: target,
      fineWindowMs: 300,
      onTrigger,
    });

    timer.start(now);
    vi.advanceTimersByTime(100);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('cancels gracefully without firing callback if user stops/cancels', () => {
    const onTrigger = vi.fn();
    const now = 100_000;
    const target = now + 5000;

    const timer = new PrecisionContentTimer({
      targetClientTimeMs: target,
      fineWindowMs: 300,
      onTrigger,
    });

    timer.start(now);
    vi.advanceTimersByTime(2000);
    timer.cancel();
    expect(timer.isRunning()).toBe(false);

    vi.advanceTimersByTime(10000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('enforces idempotency: triggers exactly once even if multiple timers/triggers fire', () => {
    const onTrigger = vi.fn();
    const now = 100_000;
    const target = now + 1000;

    const timer = new PrecisionContentTimer({
      targetClientTimeMs: target,
      fineWindowMs: 300,
      onTrigger,
    });

    timer.start(now);
    vi.advanceTimersByTime(2000); // Past target

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
