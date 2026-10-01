import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduledArmManager, AlarmProvider } from '../../../src/application/services/ScheduledArmManager';

describe('P2-6: ScheduledArmManager idempotent lock and handle cancellation', () => {
  let mockAlarmProvider: AlarmProvider;
  let manager: ScheduledArmManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAlarmProvider = {
      clear: vi.fn(),
      create: vi.fn(),
    };
    manager = new ScheduledArmManager(mockAlarmProvider);
  });

  afterEach(() => {
    manager.cancel();
    vi.useRealTimers();
  });

  it('should cancel existing timeout handle when re-scheduling (preventing multiple overlapping timers)', () => {
    const onExecute1 = vi.fn().mockResolvedValue(undefined);
    const onExecute2 = vi.fn().mockResolvedValue(undefined);

    const now = 100000;
    // Schedule 1: 50s in future
    manager.schedule(now + 50000, onExecute1, now);
    expect(manager.isScheduled()).toBe(true);

    // User updates schedule before timer fires: 100s in future
    manager.schedule(now + 100000, onExecute2, now);
    expect(manager.isScheduled()).toBe(true);

    // Fast-forward 60s: onExecute1 should NOT have been called!
    vi.advanceTimersByTime(60000);
    expect(onExecute1).not.toHaveBeenCalled();
    expect(onExecute2).not.toHaveBeenCalled();

    // Fast-forward another 40s (100s total): onExecute2 should be called once
    vi.advanceTimersByTime(40000);
    expect(onExecute1).not.toHaveBeenCalled();
    expect(onExecute2).toHaveBeenCalledTimes(1);
  });

  it('cancel() should clear timeout handle and alarm so callback never fires', () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const now = 100000;

    manager.schedule(now + 5000, onExecute, now);
    expect(manager.isScheduled()).toBe(true);

    // User stops or resets config
    manager.cancel();
    expect(manager.isScheduled()).toBe(false);
    expect(mockAlarmProvider.clear).toHaveBeenCalledWith('SCHEDULED_ARM');
    expect(mockAlarmProvider.clear).toHaveBeenCalledWith('SCHEDULED_ARM_PREWAKE');

    // Advance time past the scheduled time
    vi.advanceTimersByTime(10000);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('execute() should enforce idempotent lock and reject concurrent execution', async () => {
    let finishFirstExecution: () => void = () => {};
    const longRunningExecution = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        finishFirstExecution = resolve;
      });
    });

    const secondExecution = vi.fn().mockResolvedValue(undefined);

    // Start first execution
    const firstPromise = manager.execute(longRunningExecution);
    expect(manager.isRunning()).toBe(true);

    // Second execution arrives concurrently while first is still running
    const secondResult = await manager.execute(secondExecution);
    expect(secondResult).toBe(false);
    expect(secondExecution).not.toHaveBeenCalled();

    // Finish first execution
    finishFirstExecution();
    const firstResult = await firstPromise;
    expect(firstResult).toBe(true);
    expect(manager.isRunning()).toBe(false);

    // Now a subsequent execution is permitted
    const thirdResult = await manager.execute(secondExecution);
    expect(thirdResult).toBe(true);
    expect(secondExecution).toHaveBeenCalledTimes(1);
  });
});
