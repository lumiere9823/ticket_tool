import { describe, it, expect } from 'vitest';
import { PriorityCategoryEngine } from '../../../src/domain/policies/PriorityCategoryEngine';
import { JourneyTicketType } from '../../../src/domain/entities/BookingJourneyModels';

describe('PriorityCategoryEngine', () => {
  const sampleTickets: JourneyTicketType[] = [
    {
      id: 'vip-1',
      showingId: 's1',
      name: 'VIP Standing',
      price: 4000000,
      currency: 'VND',
      mode: 'STANDING',
      availability: 'SOLD_OUT',
      minQuantity: 1,
      maxQuantity: 4,
      selectable: false,
      evidence: [],
    },
    {
      id: 'cat-1',
      showingId: 's1',
      name: 'CAT 1 (Standing)',
      price: 2500000,
      currency: 'VND',
      mode: 'STANDING',
      availability: 'AVAILABLE',
      minQuantity: 1,
      maxQuantity: 4,
      selectable: true,
      evidence: [],
    },
    {
      id: 'cat-10',
      showingId: 's1',
      name: 'CAT 10 Economy',
      price: 500000,
      currency: 'VND',
      mode: 'STANDING',
      availability: 'AVAILABLE',
      minQuantity: 1,
      maxQuantity: 4,
      selectable: true,
      evidence: [],
    },
    {
      id: 'cat-2',
      showingId: 's1',
      name: 'CAT 2 Standard',
      price: 1800000,
      currency: 'VND',
      mode: 'STANDING',
      availability: 'AVAILABLE',
      minQuantity: 1,
      maxQuantity: 4,
      selectable: true,
      evidence: [],
    },
  ];

  it('should ignore unavailable tickets and select top available priority', () => {
    const priorities = ['VIP', 'CAT 1', 'CAT 2'];
    const result = PriorityCategoryEngine.evaluate(sampleTickets, priorities, true, 2);

    expect(result.selectedTicket).not.toBeNull();
    expect(result.selectedTicket?.id).toBe('cat-1');
    expect(result.matchedPriorityIndex).toBe(1);
    expect(result.fallbackUsed).toBe(true);
  });

  it('should match exact normalized names first', () => {
    const ticketsWithExact: JourneyTicketType[] = [
      ...sampleTickets,
      {
        id: 'cat-1-exact',
        showingId: 's1',
        name: 'CAT 1',
        price: 2500000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: true,
        evidence: [],
      },
    ];

    const result = PriorityCategoryEngine.evaluate(ticketsWithExact, ['CAT 1'], false, 2);
    expect(result.selectedTicket?.id).toBe('cat-1-exact');
    expect(result.fallbackUsed).toBe(false);
  });

  it('should not use fuzzy matching that accidentally matches CAT 10 when searching for CAT 1', () => {
    const onlyCat10: JourneyTicketType[] = [
      {
        id: 'cat-10',
        showingId: 's1',
        name: 'CAT 10 Economy',
        price: 500000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: true,
        evidence: [],
      },
    ];

    const result = PriorityCategoryEngine.evaluate(onlyCat10, ['CAT 1'], false, 1);
    expect(result.selectedTicket).toBeNull();
    expect(result.reason).toContain('No configured priority ticket is currently available');
  });

  it('should remain waiting when preferred ticket is sold out and fallback=false', () => {
    const priorities = ['VIP Standing'];
    const result = PriorityCategoryEngine.evaluate(sampleTickets, priorities, false, 1);

    expect(result.selectedTicket).toBeNull();
    expect(result.fallbackUsed).toBe(false);
  });

  it('should select next available priority when top priority is sold out and fallback=true', () => {
    const priorities = ['VIP Standing', 'CAT 2 Standard'];
    const result = PriorityCategoryEngine.evaluate(sampleTickets, priorities, true, 1);

    expect(result.selectedTicket?.id).toBe('cat-2');
    expect(result.fallbackUsed).toBe(true);
  });

  it('should support wildcard ANY to match any available eligible tier', () => {
    const priorities = ['ANY'];
    const result = PriorityCategoryEngine.evaluate(sampleTickets, priorities, false, 1);

    expect(result.selectedTicket).not.toBeNull();
    expect(result.selectedTicket?.availability).toBe('AVAILABLE');
  });

  it('should reject tickets when requested quantity exceeds observable maxQuantity', () => {
    const limitedTickets: JourneyTicketType[] = [
      {
        id: 'lim-1',
        showingId: 's1',
        name: 'Limited Ticket',
        price: 1000000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 1,
        selectable: true,
        evidence: [],
      },
    ];

    const result = PriorityCategoryEngine.evaluate(limitedTickets, ['Limited Ticket'], false, 2);
    expect(result.selectedTicket).toBeNull();
    expect(result.reason).toContain('cannot satisfy requested quantity of 2');
  });

  it('should match tickets by numeric ID or string ID in priority categories', () => {
    const numericTickets: JourneyTicketType[] = [
      {
        id: '1086256',
        showingId: '79214083095652',
        name: 'ULTRA VIP - L2',
        price: 2500000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: true,
        evidence: [],
      },
    ];

    // Priority specified by ID first
    const resultWithIdFirst = PriorityCategoryEngine.evaluate(
      numericTickets,
      ['1086256', 'ULTRA VIP - L2'],
      false,
      1
    );
    expect(resultWithIdFirst.selectedTicket).not.toBeNull();
    expect(resultWithIdFirst.selectedTicket?.id).toBe('1086256');
    expect(resultWithIdFirst.fallbackUsed).toBe(false);

    // Priority specified by Name first
    const resultWithNameFirst = PriorityCategoryEngine.evaluate(
      numericTickets,
      ['ULTRA VIP - L2', '1086256'],
      false,
      1
    );
    expect(resultWithNameFirst.selectedTicket).not.toBeNull();
    expect(resultWithNameFirst.selectedTicket?.name).toBe('ULTRA VIP - L2');
    expect(resultWithNameFirst.fallbackUsed).toBe(false);
  });

  it('should not reject lower priority whitelisted targets when scopedPlan is active even if allowFallback is false', () => {
    const multiTickets: JourneyTicketType[] = [
      {
        id: '1086255',
        showingId: 's1',
        name: 'VIP 1',
        price: 3000000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'SOLD_OUT',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: false,
        evidence: [],
      },
      {
        id: '1086256',
        showingId: 's1',
        name: 'VIP 2',
        price: 2000000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: true,
        evidence: [],
      },
    ];

    const scopedPlan = {
      eventId: 'evt-test',
      targets: [
        {
          showingId: 's1',
          ticketTypeIds: ['1086255', '1086256'],
          rank: 1,
        },
      ],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER' as const,
      allowPartialQuantity: false,
      persistence: {
        maxDurationMinutes: 120,
        maxAttempts: 1000,
        pollIntervalMs: 1800,
        jitterRatio: 0.2,
      },
    };

    const result = PriorityCategoryEngine.evaluate(
      multiTickets,
      ['VIP 1', 'VIP 2'],
      false, // allowFallback false
      1,
      scopedPlan
    );

    expect(result.selectedTicket).not.toBeNull();
    expect(result.selectedTicket?.id).toBe('1086256');
    expect(result.selectedTicket?.name).toBe('VIP 2');
  });
});
