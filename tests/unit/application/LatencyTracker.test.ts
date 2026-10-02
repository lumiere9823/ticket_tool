import { describe, it, expect, vi } from 'vitest';
import { LatencyTracker } from '../../../src/application/services/LatencyTracker';
import { LoggerPort } from '../../../src/application/ports/LoggerPort';

describe('N4: LatencyTracker and Telemetry', () => {
  it('records timing sync parameters (offset, RTT, uncertainty, T_target) and calculates target delta on T_first_action', () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      withContext: vi.fn().mockReturnThis(),
    };

    const tracker = new LatencyTracker('attempt_test_123', mockLogger);

    const offsetMs = 250;
    const rttMs = 60;
    const uncertaintyMs = 1030;
    const tArmedMs = 1_000_000;
    const tTargetServerMs = 1_005_000;

    tracker.recordTimingSync(offsetMs, rttMs, uncertaintyMs, tArmedMs, tTargetServerMs);

    // Target in client time reference = tTargetServerMs - offsetMs = 1_005_000 - 250 = 1_004_750
    // Suppose first action is executed at client timestamp 1_004_785 (35ms after target)
    const tFirstActionMs = 1_004_785;
    tracker.recordTFirstAction(tFirstActionMs);

    const breakdown = tracker.getBreakdown();
    expect(breakdown.tArmed).toBe(tArmedMs);
    expect(breakdown.tTarget).toBe(tTargetServerMs);
    expect(breakdown.tFirstAction).toBe(tFirstActionMs);
    expect(breakdown.serverOffsetMs).toBe(offsetMs);
    expect(breakdown.serverRttMs).toBe(rttMs);
    expect(breakdown.clockUncertaintyMs).toBe(uncertaintyMs);
    expect(breakdown.targetDeltaMs).toBe(35); // 1_004_785 - 1_004_750 = 35ms

    // Ensure logger is called with purely numerical telemetry without sensitive fields
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Recorded T_FIRST_ACTION',
      expect.objectContaining({
        attemptId: 'attempt_test_123',
        tFirstAction: tFirstActionMs,
        targetDeltaMs: 35,
      })
    );
  });

  it('contains strictly sanitized numerical fields without PII or credentials', () => {
    const tracker = new LatencyTracker('attempt_clean_123');
    tracker.recordTimingSync(100, 40, 1020, 1000, 2000);
    tracker.recordTFirstAction(1950);

    const breakdown = tracker.getBreakdown();
    const keys = Object.keys(breakdown);

    // Ensure no sensitive keys exist
    const forbiddenKeys = ['password', 'token', 'cookie', 'email', 'phone', 'otp', 'cvv'];
    for (const key of keys) {
      expect(forbiddenKeys).not.toContain(key.toLowerCase());
    }
  });
});
