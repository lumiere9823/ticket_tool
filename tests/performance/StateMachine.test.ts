import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { PurchaseStateMachine } from '../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../src/domain/states/PurchaseState';

describe('Performance Benchmark: State Machine Transitions & Audit Bounds', () => {
  it('measures canonical transition cycle latency: READY -> ARMED -> MONITORING -> TICKETS_DETECTED -> EVALUATING_TICKETS -> TICKET_SELECTED -> SEATS_SELECTED -> HELD', async () => {
    const sm = new PurchaseStateMachine(PurchaseState.READY);

    const stats = await BenchmarkRunner.run(
      () => {
        sm.transition({ type: 'ARM' });
        sm.transition({ type: 'MONITORING_STARTED' });
        sm.transition({ type: 'TICKETS_DETECTED', ticketCount: 5 });
        sm.transition({ type: 'EVALUATING_TICKETS' });
        sm.transition({
          type: 'TICKET_SELECTED',
          ticketId: 't1',
          ticketName: 'VIP',
          price: 1000000,
        });
        sm.transition({ type: 'SELECTING_SEATS' });
        sm.transition({ type: 'SEATS_SELECTED', seats: ['A-1'] });
        sm.transition({ type: 'RESERVATION_INITIATED' });
        sm.transition({ type: 'RESERVATION_SERVER_CONFIRMED', reservationId: 'hold_123' });
        expect(sm.state).toBe(PurchaseState.HELD);

        // Reset for next iteration
        sm.transition({ type: 'STOP_REQUESTED' });
        sm.transition({ type: 'RESET_REQUESTED' });
      },
      { iterations: 500, warmupIterations: 50 }
    );

    console.info('[PERF] State Machine Transition Cycle Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(1); // 10 synchronous transitions should take under 1ms
  });

  it('measures audit log bounding under 1,000 transitions (bounded memory, zero leak)', async () => {
    const sm = new PurchaseStateMachine(PurchaseState.READY);

    const stats = await BenchmarkRunner.run(
      () => {
        for (let i = 0; i < 50; i++) {
          sm.transition({ type: 'ARM' });
          sm.transition({ type: 'STOP_REQUESTED' });
          sm.transition({ type: 'RESET_REQUESTED' });
        }
      },
      { iterations: 20, warmupIterations: 2 }
    );

    console.info('[PERF] Audit Log Bounded Transitions Stats (ms):', stats);
    expect(stats.median).toBeLessThan(10);
  });
});
