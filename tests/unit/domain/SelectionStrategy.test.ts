import { describe, it, expect } from 'vitest';
import {
  SelectionStrategy,
  TicketPreference,
  Quantity,
  Money,
  CandidateTicket,
} from '../../../src/domain';

describe('SelectionStrategy', () => {
  const mockCandidates: CandidateTicket[] = [
    {
      id: 'cat-2-std',
      categoryName: 'CAT 2',
      price: new Money(800000),
      availableQuantity: 4,
      isAvailable: true,
    },
    {
      id: 'cat-1-std',
      categoryName: 'CAT 1',
      price: new Money(1500000),
      availableQuantity: 2,
      isAvailable: true,
    },
    {
      id: 'vip-std',
      categoryName: 'VIP',
      price: new Money(3000000),
      availableQuantity: 2,
      isAvailable: true,
    },
  ];

  it('should select first priority candidate when available', () => {
    const preference = new TicketPreference({
      categoryPriority: ['VIP', 'CAT 1', 'CAT 2'],
      quantity: new Quantity(2),
      allowFallback: true,
    });

    const result = SelectionStrategy.selectCandidate(mockCandidates, preference);
    expect(result).not.toBeNull();
    expect(result?.candidate.id).toBe('vip-std');
    expect(result?.isFallback).toBe(false);
    expect(result?.matchedPriorityIndex).toBe(0);
  });

  it('should fallback to second priority when first priority is unavailable', () => {
    const candidatesWithoutVip: CandidateTicket[] = [
      {
        id: 'vip-std',
        categoryName: 'VIP',
        price: new Money(3000000),
        availableQuantity: 0,
        isAvailable: false,
      },
      ...mockCandidates.filter((c) => c.categoryName !== 'VIP'),
    ];

    const preference = new TicketPreference({
      categoryPriority: ['VIP', 'CAT 1', 'CAT 2'],
      quantity: new Quantity(2),
      allowFallback: true,
    });

    const result = SelectionStrategy.selectCandidate(candidatesWithoutVip, preference);
    expect(result).not.toBeNull();
    expect(result?.candidate.id).toBe('cat-1-std');
    expect(result?.isFallback).toBe(true);
    expect(result?.matchedPriorityIndex).toBe(1);
  });

  it('should return null when first priority is unavailable and allowFallback is false', () => {
    const candidatesWithoutVip = mockCandidates.map((c) =>
      c.categoryName === 'VIP' ? { ...c, isAvailable: false, availableQuantity: 0 } : c
    );

    const preference = new TicketPreference({
      categoryPriority: ['VIP', 'CAT 1'],
      quantity: new Quantity(2),
      allowFallback: false,
    });

    const result = SelectionStrategy.selectCandidate(candidatesWithoutVip, preference);
    expect(result).toBeNull();
  });

  it('should filter out candidates with insufficient availableQuantity', () => {
    const preference = new TicketPreference({
      categoryPriority: ['CAT 1', 'CAT 2'],
      quantity: new Quantity(3), // CAT 1 only has 2 available
      allowFallback: true,
    });

    const result = SelectionStrategy.selectCandidate(mockCandidates, preference);
    expect(result).not.toBeNull();
    expect(result?.candidate.id).toBe('cat-2-std'); // CAT 2 has 4 available
    expect(result?.isFallback).toBe(true);
  });

  it('should sort deterministically by price (lowest price first) for same priority', () => {
    const candidatesWithDualCat1: CandidateTicket[] = [
      {
        id: 'cat-1-expensive',
        categoryName: 'CAT 1',
        price: new Money(1800000),
        availableQuantity: 2,
        isAvailable: true,
      },
      {
        id: 'cat-1-standard',
        categoryName: 'CAT 1',
        price: new Money(1500000),
        availableQuantity: 2,
        isAvailable: true,
      },
    ];

    const preference = new TicketPreference({
      categoryPriority: ['CAT 1'],
      quantity: new Quantity(2),
    });

    const result = SelectionStrategy.selectCandidate(candidatesWithDualCat1, preference);
    expect(result?.candidate.id).toBe('cat-1-standard');
  });
});
