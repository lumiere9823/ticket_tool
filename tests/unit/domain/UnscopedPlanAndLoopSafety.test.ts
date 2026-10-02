import { describe, it, expect } from 'vitest';
import { RetryPolicy } from '../../../src/domain/policies/RetryPolicy';
import { BookingSummaryVerifier } from '../../../src/domain/policies/BookingSummaryVerifier';
import {
  DEFAULT_PURCHASE_PLAN_LIMITS,
  sanitizePurchasePlanLimits,
} from '../../../src/domain/entities/PurchasePlan';
import { PurchasePlanValidator } from '../../../src/domain/policies/PurchasePlanValidator';
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

  describe('T1: PurchasePlanValidator limits validation and sanitizePurchasePlanLimits', () => {
    const basePlan = {
      showingId: null,
      ticketRules: [{ ticketId: 't-1', ticketName: 'Standard', quantity: 1 }],
      fallbackPolicy: 'STOP_AND_NOTIFY' as const,
      allowFallback: false,
    };
    const catalogTickets = [
      {
        id: 't-1',
        name: 'Standard',
        price: 1000000,
        currency: 'VND' as const,
        mode: 'STANDING' as const,
        availability: 'AVAILABLE' as const,
        selectable: true,
        minQuantity: 1,
        maxQuantity: 4,
        source: 'BOOKING_PAGE' as const,
        evidence: ['test'],
      },
    ];

    it('validates and rejects 0, negative, NaN, and exceeding limits in PurchasePlanValidator', () => {
      // 0 maxDurationMinutes
      const planZeroDuration = {
        ...basePlan,
        limits: { maxDurationMinutes: 0 },
      };
      const res1 = PurchasePlanValidator.validate(planZeroDuration, catalogTickets);
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes('maxDurationMinutes'))).toBe(true);

      // maxDurationMinutes > 240
      const planOverDuration = {
        ...basePlan,
        limits: { maxDurationMinutes: 241 },
      };
      const res2 = PurchasePlanValidator.validate(planOverDuration, catalogTickets);
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes('exceeds maximum ceiling of 240'))).toBe(true);

      // maxAttempts <= 0 or > 5000
      const planZeroAttempts = {
        ...basePlan,
        limits: { maxAttempts: 0 },
      };
      expect(PurchasePlanValidator.validate(planZeroAttempts, catalogTickets).valid).toBe(false);

      const planOverAttempts = {
        ...basePlan,
        limits: { maxAttempts: 5001 },
      };
      const res3 = PurchasePlanValidator.validate(planOverAttempts, catalogTickets);
      expect(res3.valid).toBe(false);
      expect(res3.errors.some((e) => e.includes('exceeds maximum ceiling of 5000'))).toBe(true);
    });

    it('sanitizePurchasePlanLimits enforces safe defaults and clamps to ceilings', () => {
      const sanitizedEmpty = sanitizePurchasePlanLimits(undefined);
      expect(sanitizedEmpty.maxDurationMinutes).toBe(120);
      expect(sanitizedEmpty.maxAttempts).toBe(1000);

      const sanitizedInvalid = sanitizePurchasePlanLimits({
        maxDurationMinutes: 0,
        maxAttempts: -1,
      });
      expect(sanitizedInvalid.maxDurationMinutes).toBe(120);
      expect(sanitizedInvalid.maxAttempts).toBe(1000);

      const sanitizedClamped = sanitizePurchasePlanLimits({
        maxDurationMinutes: 300,
        maxAttempts: 9999,
      });
      expect(sanitizedClamped.maxDurationMinutes).toBe(240);
      expect(sanitizedClamped.maxAttempts).toBe(5000);
    });
  });
});
