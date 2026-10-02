import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { PurchaseStateMachine } from '../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../src/domain/states/PurchaseState';
import { PriorityCategoryEngine } from '../../src/domain/policies/PriorityCategoryEngine';
import { JourneyTicketType } from '../../src/domain/entities/BookingJourneyModels';

describe('Performance Benchmark: Multi-Profile Isolation & Parallel Orchestration', () => {
  function createProfileSession(profileId: string) {
    const sm = new PurchaseStateMachine(PurchaseState.READY);
    sm.setProfileId(profileId);
    sm.setAttemptId(`attempt_${profileId}`);
    return {
      profileId,
      stateMachine: sm,
      tickets: [
        {
          id: `t1_${profileId}`,
          name: 'VIP Standard',
          price: 1500000,
          currency: 'VND',
          mode: 'STANDING' as const,
          availability: 'AVAILABLE' as const,
          minQuantity: 1,
          maxQuantity: 4,
          selectable: true,
          evidence: ['bench'],
        },
      ] as JourneyTicketType[],
    };
  }

  function simulateProfileJourney(session: ReturnType<typeof createProfileSession>) {
    session.stateMachine.transition({ type: 'ARM' });
    session.stateMachine.transition({ type: 'MONITORING_STARTED' });
    session.stateMachine.transition({
      type: 'TICKETS_DETECTED',
      ticketCount: session.tickets.length,
    });
    session.stateMachine.transition({ type: 'EVALUATING_TICKETS' });
    const decision = PriorityCategoryEngine.evaluate(session.tickets, ['VIP Standard'], false, 1);
    expect(decision.selectedTicket).not.toBeNull();
    session.stateMachine.transition({
      type: 'TICKET_SELECTED',
      ticketId: decision.selectedTicket!.id!,
      ticketName: decision.selectedTicket!.name,
      price: decision.selectedTicket!.price,
    });
    session.stateMachine.transition({
      type: 'SELECTING_QUANTITY',
      quantity: 1,
    });
  }

  it('measures execution across 1 profile (Baseline)', async () => {
    const stats = await BenchmarkRunner.run(
      () => {
        const session = createProfileSession('profile_1');
        simulateProfileJourney(session);
      },
      { iterations: 200, warmupIterations: 20 }
    );

    console.info('[PERF] 1 Profile Isolation Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(5);
  });

  it('measures concurrent execution across 2 isolated profiles', async () => {
    const stats = await BenchmarkRunner.run(
      () => {
        const p1 = createProfileSession('profile_1');
        const p2 = createProfileSession('profile_2');
        simulateProfileJourney(p1);
        simulateProfileJourney(p2);
      },
      { iterations: 200, warmupIterations: 20 }
    );

    console.info('[PERF] 2 Profiles Concurrent Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(10);
  });

  it('measures concurrent execution across 4 isolated profiles', async () => {
    const stats = await BenchmarkRunner.run(
      () => {
        const profiles = Array.from({ length: 4 }, (_, i) =>
          createProfileSession(`profile_${i + 1}`)
        );
        for (const p of profiles) {
          simulateProfileJourney(p);
        }
      },
      { iterations: 100, warmupIterations: 10 }
    );

    console.info('[PERF] 4 Profiles Concurrent Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(8);
  });

  it('measures concurrent execution across 8 isolated profiles', async () => {
    const stats = await BenchmarkRunner.run(
      () => {
        const profiles = Array.from({ length: 8 }, (_, i) =>
          createProfileSession(`profile_${i + 1}`)
        );
        for (const p of profiles) {
          simulateProfileJourney(p);
        }
      },
      { iterations: 50, warmupIterations: 5 }
    );

    console.info('[PERF] 8 Profiles Concurrent Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(16);
  });
});
