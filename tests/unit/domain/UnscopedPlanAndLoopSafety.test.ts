import { describe, it, expect } from 'vitest';
import { RetryPolicy } from '../../../src/domain/policies/RetryPolicy';
import { BookingSummaryVerifier } from '../../../src/domain/policies/BookingSummaryVerifier';
import { DEFAULT_PURCHASE_PLAN_LIMITS } from '../../../src/domain/entities/PurchasePlan';
import {
  CurrentSelection,
  BookingSummary,
} from '../../../src/domain/entities/BookingJourneyModels';

describe('P2-8: Non-scoped plan limits, retry bounds, and loop safety', () => {
  it('DEFAULT_PURCHASE_PLAN_LIMITS provides mandatory default bounds for non-scoped plans', () => {
    expect(DEFAULT_PURCHASE_PLAN_LIMITS.maxDurationMinutes).toBe(120);
    expect(DEFAULT_PURCHASE_PLAN_LIMITS.maxAttempts).toBe(1000);
    expect(DEFAULT_PURCHASE_PLAN_LIMITS.maxPricePerTicket).toBe(20_000_000);
    expect(DEFAULT_PURCHASE_PLAN_LIMITS.maxTotal).toBe(50_000_000);
  });

  it('RetryPolicy.getBackoffDelayMs() at attempts=0 is never less than initialDelayMs', () => {
    const policy = new RetryPolicy({
      initialDelayMs: 600,
      backoffMultiplier: 1.5,
      maxDelayMs: 4000,
    });

    expect(policy.attempts).toBe(0);
    // At attempts = 0, exponent must be clamped to 0, delay = initialDelayMs
    const delay = policy.getBackoffDelayMs();
    expect(delay).toBe(600);
    expect(delay).toBeGreaterThanOrEqual(600);
  });

  it('RetryPolicy with jitter never drops below initialDelayMs', () => {
    const policy = new RetryPolicy({
      initialDelayMs: 400,
      backoffMultiplier: 2.0,
      maxDelayMs: 5000,
    });

    for (let i = 0; i < 100; i++) {
      const delay = policy.getBackoffDelayMs(true, 0.25);
      expect(delay).toBeGreaterThanOrEqual(400);
    }
  });

  it('BookingSummaryVerifier rejects when ticket price exceeds maxPricePerTicket ceiling', () => {
    const expected: CurrentSelection = {
      ticketId: 't-1',
      name: 'Standard Ticket',
      price: 1500000,
      currency: 'VND',
      mode: 'STANDING',
      quantity: 1,
      seats: [],
      selectedAt: new Date().toISOString(),
      maxPricePerTicket: 1000000, // Ceiling 1,000,000 VND
    };

    const summary: BookingSummary = {
      items: [{ ticket: 'Standard Ticket', quantity: 1, price: 1500000 }],
      subtotal: 1500000,
      fees: 0,
      currency: 'VND',
      total: 1500000,
    };

    const result = BookingSummaryVerifier.verify(summary, expected);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxPricePerTicket ceiling'))).toBe(true);
  });

  it('BookingSummaryVerifier rejects when subtotal exceeds maxTotal ceiling', () => {
    const expected: CurrentSelection = {
      ticketId: 't-1',
      name: 'Standard Ticket',
      price: 1000000,
      currency: 'VND',
      mode: 'STANDING',
      quantity: 3,
      seats: [],
      selectedAt: new Date().toISOString(),
      maxTotal: 2000000, // Ceiling 2,000,000 VND
    };

    const summary: BookingSummary = {
      items: [{ ticket: 'Standard Ticket', quantity: 3, price: 1000000 }],
      subtotal: 3000000,
      fees: 0,
      currency: 'VND',
      total: 3000000,
    };

    const result = BookingSummaryVerifier.verify(summary, expected);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxTotal ceiling'))).toBe(true);
  });
});
