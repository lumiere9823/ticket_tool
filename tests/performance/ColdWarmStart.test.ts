import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { PurchaseStateMachine } from '../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../src/domain/states/PurchaseState';
import { ChromeStorageRepository } from '../../src/infrastructure/storage/ChromeStorageRepository';
import { TicketboxJourneyAdapter } from '../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';

describe('Performance Benchmark: Cold-start vs Warm-start', () => {
  it('measures cold-start initialization latency (state machine + storage + adapter)', async () => {
    const stats = await BenchmarkRunner.run(
      () => {
        // Cold instantiation of core components
        const sm = new PurchaseStateMachine(PurchaseState.INIT);
        const storage = new ChromeStorageRepository();
        const adapter = new TicketboxJourneyAdapter();
        expect(sm.state).toBe(PurchaseState.INIT);
        expect(storage).toBeDefined();
        expect(adapter).toBeDefined();
      },
      { iterations: 100, warmupIterations: 10 }
    );

    console.info('[PERF] Cold Start Stats (ms):', stats);
    expect(stats.median).toBeLessThan(5); // Cold start should instantiate under 5ms
  });

  it('measures warm-start state rehydration latency from stored state', async () => {
    const storage = new ChromeStorageRepository();
    const testContext = {
      currentState: PurchaseState.MONITORING,
      attemptId: 'perf_attempt_1',
      workflowId: 'perf_wf_1',
      updatedAt: new Date().toISOString(),
      retryCount: 0,
    };
    await storage.saveJourneyState(testContext);

    const stats = await BenchmarkRunner.run(
      async () => {
        const sm = new PurchaseStateMachine(PurchaseState.READY);
        const stored = await storage.getJourneyState();
        if (stored) {
          sm.restore(stored);
        }
        expect(sm.state).toBe(PurchaseState.MONITORING);
      },
      { iterations: 100, warmupIterations: 10 }
    );

    console.info('[PERF] Warm Start Rehydration Stats (ms):', stats);
    expect(stats.median).toBeLessThan(10);
  });
});
