import { describe, it, expect } from 'vitest';
import { AdjacentSeatStrategy } from '../../../src/domain/policies/AdjacentSeatStrategy';
import { Seat } from '../../../src/domain/entities/BookingJourneyModels';

describe('AdjacentSeatStrategy', () => {
  const sampleSeats: Seat[] = [
    {
      id: 's-a1',
      label: 'A01',
      row: 'A',
      number: 1,
      area: 'Zone 1',
      status: 'OCCUPIED',
      selectable: false,
    },
    {
      id: 's-a2',
      label: 'A02',
      row: 'A',
      number: 2,
      area: 'Zone 1',
      status: 'AVAILABLE',
      selectable: true,
    },
    {
      id: 's-a3',
      label: 'A03',
      row: 'A',
      number: 3,
      area: 'Zone 1',
      status: 'AVAILABLE',
      selectable: true,
    },
    {
      id: 's-a5',
      label: 'A05',
      row: 'A',
      number: 5,
      area: 'Zone 1',
      status: 'AVAILABLE',
      selectable: true,
    },
    {
      id: 's-a6',
      label: 'A06',
      row: 'A',
      number: 6,
      area: 'Zone 1',
      status: 'AVAILABLE',
      selectable: true,
    },
  ];

  it('should prefer adjacent seats (A02 + A03) over non-adjacent seats (A02 + A05)', () => {
    const decision = AdjacentSeatStrategy.selectSeats(sampleSeats, 2, 'Zone 1');

    expect(decision.status).toBe('SUCCESS');
    expect(decision.isAdjacent).toBe(true);
    expect(decision.selectedSeats.length).toBe(2);
    expect(decision.selectedSeats[0]?.label).toBe('A02');
    expect(decision.selectedSeats[1]?.label).toBe('A03');
  });

  it('should never select occupied or blocked seats', () => {
    const decision = AdjacentSeatStrategy.selectSeats(sampleSeats, 2, 'Zone 1');
    for (const seat of decision.selectedSeats) {
      expect(seat.status).toBe('AVAILABLE');
      expect(seat.label).not.toBe('A01');
    }
  });

  it('should handle quantity = 1 seamlessly', () => {
    const decision = AdjacentSeatStrategy.selectSeats(sampleSeats, 1, 'Zone 1');
    expect(decision.status).toBe('SUCCESS');
    expect(decision.selectedSeats.length).toBe(1);
    expect(decision.selectedSeats[0]?.label).toBe('A02');
  });

  it('should handle quantity = 3 by finding 3 contiguous seats if available', () => {
    const threeContiguous: Seat[] = [
      ...sampleSeats,
      {
        id: 's-a4',
        label: 'A04',
        row: 'A',
        number: 4,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
    ];

    const decision = AdjacentSeatStrategy.selectSeats(threeContiguous, 3, 'Zone 1');
    expect(decision.status).toBe('SUCCESS');
    expect(decision.isAdjacent).toBe(true);
    expect(decision.selectedSeats.map((s) => s.label)).toEqual(['A02', 'A03', 'A04']);
  });

  it('should respect fallback policy SELECT_NON_ADJACENT when adjacent seats are not available', () => {
    const nonAdjacentSeats: Seat[] = [
      {
        id: 's-1',
        label: 'A01',
        row: 'A',
        number: 1,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
      {
        id: 's-2',
        label: 'A02',
        row: 'A',
        number: 2,
        area: 'Zone 1',
        status: 'OCCUPIED',
        selectable: false,
      },
      {
        id: 's-3',
        label: 'A03',
        row: 'A',
        number: 3,
        area: 'Zone 1',
        status: 'OCCUPIED',
        selectable: false,
      },
      {
        id: 's-4',
        label: 'A04',
        row: 'A',
        number: 4,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
    ];

    const decision = AdjacentSeatStrategy.selectSeats(
      nonAdjacentSeats,
      2,
      'Zone 1',
      'ANY_AVAILABLE',
      'SELECT_NON_ADJACENT'
    );

    expect(decision.status).toBe('SUCCESS');
    expect(decision.isAdjacent).toBe(false);
    expect(decision.selectedSeats.map((s) => s.label)).toEqual(['A01', 'A04']);
  });

  it('should return WAIT when adjacent seats are unavailable and fallback is WAIT', () => {
    const nonAdjacentSeats: Seat[] = [
      {
        id: 's-1',
        label: 'A01',
        row: 'A',
        number: 1,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
      {
        id: 's-3',
        label: 'A03',
        row: 'A',
        number: 3,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
    ];

    const decision = AdjacentSeatStrategy.selectSeats(
      nonAdjacentSeats,
      2,
      'Zone 1',
      'ANY_AVAILABLE',
      'WAIT'
    );

    expect(decision.status).toBe('WAIT');
    expect(decision.selectedSeats.length).toBe(0);
  });

  it('should return STOP when adjacent seats are unavailable and fallback is STOP', () => {
    const nonAdjacentSeats: Seat[] = [
      {
        id: 's-1',
        label: 'A01',
        row: 'A',
        number: 1,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
      {
        id: 's-3',
        label: 'A03',
        row: 'A',
        number: 3,
        area: 'Zone 1',
        status: 'AVAILABLE',
        selectable: true,
      },
    ];

    const decision = AdjacentSeatStrategy.selectSeats(
      nonAdjacentSeats,
      2,
      'Zone 1',
      'ANY_AVAILABLE',
      'STOP'
    );

    expect(decision.status).toBe('STOP');
    expect(decision.selectedSeats.length).toBe(0);
  });
});
