import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { PriorityCategoryEngine } from '../../src/domain/policies/PriorityCategoryEngine';
import { JourneyTicketType } from '../../src/domain/entities/BookingJourneyModels';

describe('Performance Benchmark: Candidate Selection & Priority Category Engine', () => {
  function generateTickets(count: number): JourneyTicketType[] {
    const tiers = [
      'VIP Lounge',
      'VIP A',
      'VIP B',
      'CAT 1',
      'CAT 2',
      'CAT 3',
      'STANDARD',
      'EARLY BIRD',
    ];
    const tickets: JourneyTicketType[] = [];
    for (let i = 0; i < count; i++) {
      const tierName = tiers[i % tiers.length]!;
      tickets.push({
        id: `ticket_${i}`,
        showingId: 'showing_bench_1',
        name: `${tierName} Zone ${Math.floor(i / tiers.length) + 1}`,
        price: 1000000 + (i % 5) * 200000,
        currency: 'VND',
        mode: i % 2 === 0 ? 'SEATED' : 'STANDING',
        availability: i === count - 1 ? 'AVAILABLE' : i % 3 === 0 ? 'SOLD_OUT' : 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: true,
        evidence: ['bench'],
      });
    }
    return tickets;
  }

  it('measures candidate evaluation with small ticket set (8 tickets)', async () => {
    const tickets = generateTickets(8);
    const priorities = ['VIP A', 'CAT 1', 'CAT 2'];

    const stats = await BenchmarkRunner.run(
      () => {
        const result = PriorityCategoryEngine.evaluate(tickets, priorities, true, 2);
        expect(result.selectedTicket).not.toBeNull();
      },
      { iterations: 500, warmupIterations: 50 }
    );

    console.info('[PERF] Small Candidate Selection Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(2);
  });

  it('measures candidate evaluation with medium ticket set (50 tickets)', async () => {
    const tickets = generateTickets(50);
    const priorities = ['NON_EXISTENT_1', 'NON_EXISTENT_2', 'CAT 2 Zone 3', 'CAT 1'];

    const stats = await BenchmarkRunner.run(
      () => {
        const result = PriorityCategoryEngine.evaluate(tickets, priorities, true, 2);
        expect(result.selectedTicket).not.toBeNull();
      },
      { iterations: 300, warmupIterations: 30 }
    );

    console.info('[PERF] Medium Candidate Selection Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(5);
  });

  it('measures candidate evaluation with large ticket set (500 tickets)', async () => {
    const tickets = generateTickets(500);
    const priorities = ['NON_EXISTENT_1', 'NON_EXISTENT_2', 'VIP B Zone 10', 'ANY'];

    const stats = await BenchmarkRunner.run(
      () => {
        const result = PriorityCategoryEngine.evaluate(tickets, priorities, true, 2);
        expect(result.selectedTicket).not.toBeNull();
      },
      { iterations: 200, warmupIterations: 20 }
    );

    console.info('[PERF] Large Candidate Selection Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(15);
  });
});
