import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { ChromeMessageBus } from '../../src/infrastructure/messaging/ChromeMessageBus';
import { ExtensionMessage } from '../../src/extension/shared/messages';
import { PurchaseState } from '../../src/domain/states/PurchaseState';

describe('Performance Benchmark: Chrome Runtime IPC Latency & Payload Scaling', () => {
  const smallPayload: ExtensionMessage = {
    type: 'HEARTBEAT_PING',
    timestamp: new Date().toISOString(),
  };

  const mediumPayload: ExtensionMessage = {
    type: 'STATE_CHANGED',
    timestamp: new Date().toISOString(),
    attemptId: 'perf_ipc_med_1',
    state: PurchaseState.MONITORING,
    context: {
      currentState: PurchaseState.MONITORING,
      attemptId: 'perf_ipc_med_1',
      evidence: {
        selectedTicketName: 'VIP Lounge A',
        selectedTicketPrice: 2500000,
      },
      updatedAt: new Date().toISOString(),
    },
  };

  const largePayload: ExtensionMessage = {
    type: 'JOURNEY_UPDATE',
    timestamp: new Date().toISOString(),
    eventTitle: 'Concert Mega Tour 2026 - Vietnam Stadium',
    showingInfo: '19:30 • 04/04/2026 • San van dong Quan Khu 7',
    showingId: 'showing_81077997936830',
    catalogSnapshot: {
      eventId: '26416',
      eventTitle: 'Concert Mega Tour 2026',
      showings: Array.from({ length: 3 }, (_, s) => ({
        id: `showing_${s}`,
        name: `Day ${s + 1} Performance`,
        date: `2026-04-0${s + 4}`,
        venue: 'San van dong Quan Khu 7',
        tickets: Array.from({ length: 25 }, (_, t) => ({
          id: `t_${s}_${t}`,
          name: `VIP Zone ${t} - Tier ${s}`,
          price: 1500000 + t * 100000,
          currency: 'VND' as const,
          mode: 'SEATED' as const,
          availability: 'AVAILABLE' as const,
          selectable: true,
          minQuantity: 1,
          maxQuantity: 4,
          source: 'EVENT_PAGE' as const,
          evidence: ['DOM_ROW', 'PRICE_BADGE'],
        })),
      })),
      tickets: Array.from({ length: 75 }, (_, t) => ({
        id: `t_flat_${t}`,
        name: `Ticket Tier Flat ${t}`,
        price: 1000000 + t * 50000,
        currency: 'VND' as const,
        mode: 'SEATED' as const,
        availability: 'AVAILABLE' as const,
        selectable: true,
        minQuantity: 1,
        maxQuantity: 4,
        source: 'EVENT_PAGE' as const,
        evidence: ['DOM_ROW'],
      })),
      loadState: 'LOADED',
      loadMessage: '75 ticket options discovered.',
      discoveredAt: new Date().toISOString(),
    },
  };

  it('measures Small Payload (~100B) dispatch latency across 200 iterations', async () => {
    const bus = new ChromeMessageBus();
    let count = 0;
    bus.subscribe(() => {
      count++;
    });

    const stats = await BenchmarkRunner.run(
      async () => {
        await bus.publish(smallPayload);
      },
      { iterations: 200, warmupIterations: 20 }
    );

    console.info('[PERF] Small Payload IPC Stats (ms):', stats);
    expect(count).toBeGreaterThanOrEqual(200);
    expect(stats.median).toBeLessThan(1);
    expect(stats.p95).toBeLessThan(3);
  });

  it('measures Medium Payload (~2KB) dispatch latency across 200 iterations', async () => {
    const bus = new ChromeMessageBus();
    let count = 0;
    bus.subscribe(() => {
      count++;
    });

    const stats = await BenchmarkRunner.run(
      async () => {
        await bus.publish(mediumPayload);
      },
      { iterations: 200, warmupIterations: 20 }
    );

    console.info('[PERF] Medium Payload IPC Stats (ms):', stats);
    expect(count).toBeGreaterThanOrEqual(200);
    expect(stats.median).toBeLessThan(1.5);
    expect(stats.p95).toBeLessThan(4);
  });

  it('measures Large Payload (~50KB) dispatch and structured cloning latency across 100 iterations', async () => {
    const bus = new ChromeMessageBus();
    let count = 0;
    bus.subscribe(() => {
      count++;
    });

    const stats = await BenchmarkRunner.run(
      async () => {
        await bus.publish(largePayload);
      },
      { iterations: 100, warmupIterations: 10 }
    );

    console.info('[PERF] Large Payload IPC Stats (ms):', stats);
    expect(count).toBeGreaterThanOrEqual(100);
    expect(stats.median).toBeLessThan(5);
    expect(stats.p95).toBeLessThan(10);
  });

  it('compares Cold vs Warm IPC dispatch overhead', async () => {
    // Cold run: fresh instance without JIT warmup
    const coldBus = new ChromeMessageBus();
    const tStartCold = performance.now();
    await coldBus.publish(mediumPayload);
    const coldDuration = performance.now() - tStartCold;

    // Warm run: multiple pre-warmed dispatches
    const warmBus = new ChromeMessageBus();
    for (let i = 0; i < 20; i++) {
      await warmBus.publish(mediumPayload);
    }
    const tStartWarm = performance.now();
    await warmBus.publish(mediumPayload);
    const warmDuration = performance.now() - tStartWarm;

    console.info('[PERF] Cold vs Warm IPC Dispatch:', {
      coldDurationMs: Number(coldDuration.toFixed(4)),
      warmDurationMs: Number(warmDuration.toFixed(4)),
    });

    expect(coldDuration).toBeGreaterThanOrEqual(0);
    expect(warmDuration).toBeLessThan(10);
  });
});
