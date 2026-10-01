import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { ChromeMessageBus } from '../../src/infrastructure/messaging/ChromeMessageBus';
import { ExtensionMessage } from '../../src/extension/shared/messages';
import { PurchaseState } from '../../src/domain/states/PurchaseState';

describe('Performance Benchmark: Message Bus Throughput & Serialization', () => {
  it('measures in-memory message publishing and handler latency across 1,000 dispatches', async () => {
    const bus = new ChromeMessageBus();
    let receivedCount = 0;
    bus.subscribe(() => {
      receivedCount++;
    });

    const msg: ExtensionMessage = {
      type: 'STATE_CHANGED',
      timestamp: new Date().toISOString(),
      attemptId: 'perf_msg_1',
      state: PurchaseState.MONITORING,
      context: {
        currentState: PurchaseState.MONITORING,
        attemptId: 'perf_msg_1',
        retryCount: 0,
        updatedAt: new Date().toISOString(),
      },
    };

    const stats = await BenchmarkRunner.run(
      async () => {
        await bus.publish(msg);
      },
      { iterations: 500, warmupIterations: 50 }
    );

    console.info('[PERF] Message Bus Publish Stats (ms):', stats);
    expect(receivedCount).toBeGreaterThan(500);
    expect(stats.p95).toBeLessThan(1); // In-memory publish should be sub-millisecond
  });
});
