import { describe, it, expect } from 'vitest';
import { BookingSummaryVerifier } from '../../../src/domain/policies/BookingSummaryVerifier';
import {
  BookingSummary,
  CurrentSelection,
} from '../../../src/domain/entities/BookingJourneyModels';

describe('BookingSummaryVerifier', () => {
  const validSelection: CurrentSelection = {
    ticketId: 't-cat1',
    name: 'CAT 1 Standing',
    quantity: 2,
    price: 1500000,
    currency: 'VND',
    mode: 'STANDING',
    seats: [],
    selectedAt: '2026-10-18T10:00:00Z',
  };

  const validSummary: BookingSummary = {
    items: [
      {
        ticket: 'CAT 1 Standing',
        quantity: 2,
        price: 1500000,
      },
    ],
    subtotal: 3000000,
    fees: 0,
    currency: 'VND',
    total: 3000000,
  };

  it('should validate perfectly matching standing selection', () => {
    const result = BookingSummaryVerifier.verify(validSummary, validSelection);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject when summary is null or missing items', () => {
    const nullRes = BookingSummaryVerifier.verify(null, validSelection);
    expect(nullRes.isValid).toBe(false);
    expect(nullRes.errors[0]).toContain('Booking summary panel was not detected');

    const emptyRes = BookingSummaryVerifier.verify(
      { items: [], subtotal: 0, fees: 0, currency: 'VND', total: 0 },
      validSelection
    );
    expect(emptyRes.isValid).toBe(false);
    expect(emptyRes.errors[0]).toContain('contains 0 selected items');
  });

  it('should reject when ticket name does not match', () => {
    const wrongTicketSummary: BookingSummary = {
      items: [{ ticket: 'VIP Lounge', quantity: 2, price: 4000000 }],
      subtotal: 8000000,
      fees: 0,
      currency: 'VND',
      total: 8000000,
    };

    const result = BookingSummaryVerifier.verify(wrongTicketSummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Summary ticket name mismatch');
  });

  it('should reject when quantity does not match', () => {
    const wrongQtySummary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 1, price: 1500000 }],
      subtotal: 1500000,
      fees: 0,
      currency: 'VND',
      total: 1500000,
    };

    const result = BookingSummaryVerifier.verify(wrongQtySummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Summary quantity mismatch');
  });

  it('should validate seated selection when seats match exactly', () => {
    const seatedSelection: CurrentSelection = {
      ticketId: 't-vip-seated',
      name: 'VIP Seated',
      quantity: 2,
      price: 2500000,
      currency: 'VND',
      mode: 'SEATED',
      areaId: 'Zone A',
      seats: ['A01', 'A02'],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const seatedSummary: BookingSummary = {
      items: [
        {
          ticket: 'VIP Seated',
          quantity: 2,
          price: 2500000,
          seats: ['A01', 'A02'],
        },
      ],
      subtotal: 5000000,
      fees: 0,
      currency: 'VND',
      total: 5000000,
    };

    const result = BookingSummaryVerifier.verify(seatedSummary, seatedSelection);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject seated selection when a selected seat is missing from summary', () => {
    const seatedSelection: CurrentSelection = {
      ticketId: 't-vip-seated',
      name: 'VIP Seated',
      quantity: 2,
      price: 2500000,
      currency: 'VND',
      mode: 'SEATED',
      areaId: 'Zone A',
      seats: ['A01', 'A02'],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const mismatchedSeatsSummary: BookingSummary = {
      items: [
        {
          ticket: 'VIP Seated',
          quantity: 2,
          price: 2500000,
          seats: ['A01', 'A05'],
        },
      ],
      subtotal: 5000000,
      fees: 0,
      currency: 'VND',
      total: 5000000,
    };

    const result = BookingSummaryVerifier.verify(mismatchedSeatsSummary, seatedSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Expected seat 'A02' not confirmed");
  });

  it('should reject when subtotal does not equal price * quantity', () => {
    const wrongSubtotalSummary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 2, price: 1500000 }],
      subtotal: 9999999,
      fees: 0,
      currency: 'VND',
      total: 9999999,
    };

    const result = BookingSummaryVerifier.verify(wrongSubtotalSummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('Summary subtotal mismatch');
  });

  it('should support diacritics normalization in ticket name comparison', () => {
    const vnSelection: CurrentSelection = {
      ticketId: 't-pho-thong',
      name: 'Vé Phổ Thông',
      quantity: 1,
      price: 500000,
      currency: 'VND',
      mode: 'STANDING',
      seats: [],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const summaryWithoutDiacritics: BookingSummary = {
      items: [{ ticket: 'Ve Pho Thong', quantity: 1, price: 500000 }],
      subtotal: 500000,
      fees: 0,
      currency: 'VND',
      total: 500000,
    };

    const result = BookingSummaryVerifier.verify(summaryWithoutDiacritics, vnSelection);
    expect(result.isValid).toBe(true);
  });

  it('should reject when summary ticket name is a compound or superset of expected name (e.g. VIP PLUS vs VIP)', () => {
    const vipSelection: CurrentSelection = {
      ticketId: 't-vip',
      name: 'VIP',
      quantity: 1,
      price: 2000000,
      currency: 'VND',
      mode: 'STANDING',
      seats: [],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const vipPlusSummary: BookingSummary = {
      items: [{ ticket: 'VIP PLUS', quantity: 1, price: 2000000 }],
      subtotal: 2000000,
      fees: 0,
      currency: 'VND',
      total: 2000000,
    };

    const result = BookingSummaryVerifier.verify(vipPlusSummary, vipSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Expected ticket 'VIP' not found");
  });

  it('should reject when summary ticket name has compound prefix like SUPER VIP for VIP', () => {
    const vipSelection: CurrentSelection = {
      ticketId: 't-vip',
      name: 'VIP',
      quantity: 1,
      price: 2000000,
      currency: 'VND',
      mode: 'STANDING',
      seats: [],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const superVipSummary: BookingSummary = {
      items: [{ ticket: 'SUPER VIP', quantity: 1, price: 2000000 }],
      subtotal: 2000000,
      fees: 0,
      currency: 'VND',
      total: 2000000,
    };

    const result = BookingSummaryVerifier.verify(superVipSummary, vipSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Expected ticket 'VIP' not found");
  });

  it('should fail-closed when subtotal is <= 0 for paid tickets', () => {
    const zeroSubtotalSummary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 2, price: 1500000 }],
      subtotal: 0,
      fees: 0,
      currency: 'VND',
      total: 0,
    };

    const result = BookingSummaryVerifier.verify(zeroSubtotalSummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('subtotal') && e.includes('greater than 0'))).toBe(true);
  });

  it('should fail-closed when item price is <= 0 or missing for paid tickets', () => {
    const zeroPriceSummary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 2, price: 0 }],
      subtotal: 3000000,
      fees: 0,
      currency: 'VND',
      total: 3000000,
    };

    const result = BookingSummaryVerifier.verify(zeroPriceSummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('price') && e.includes('greater than 0'))).toBe(true);
  });

  it('should reject when summary currency does not match expected currency', () => {
    const wrongCurrencySummary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 2, price: 1500000 }],
      subtotal: 3000000,
      fees: 0,
      currency: 'USD',
      total: 3000000,
    };

    const result = BookingSummaryVerifier.verify(wrongCurrencySummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('currency mismatch'))).toBe(true);
  });

  it('should reject seated mode when summary has missing or empty seat list', () => {
    const seatedSelection: CurrentSelection = {
      ticketId: 't-vip-seated',
      name: 'VIP Seated',
      quantity: 2,
      price: 2500000,
      currency: 'VND',
      mode: 'SEATED',
      areaId: 'Zone A',
      seats: ['A01', 'A02'],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const noSeatsSummary: BookingSummary = {
      items: [
        {
          ticket: 'VIP Seated',
          quantity: 2,
          price: 2500000,
          seats: [],
        },
      ],
      subtotal: 5000000,
      fees: 0,
      currency: 'VND',
      total: 5000000,
    };

    const result = BookingSummaryVerifier.verify(noSeatsSummary, seatedSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing seat list'))).toBe(true);
  });

  it('should reject seated mode when summary seat count does not match expected quantity', () => {
    const seatedSelection: CurrentSelection = {
      ticketId: 't-vip-seated',
      name: 'VIP Seated',
      quantity: 2,
      price: 2500000,
      currency: 'VND',
      mode: 'SEATED',
      areaId: 'Zone A',
      seats: ['A01', 'A02'],
      selectedAt: '2026-10-18T10:00:00Z',
    };

    const partialSeatsSummary: BookingSummary = {
      items: [
        {
          ticket: 'VIP Seated',
          quantity: 2,
          price: 2500000,
          seats: ['A01'],
        },
      ],
      subtotal: 5000000,
      fees: 0,
      currency: 'VND',
      total: 5000000,
    };

    const result = BookingSummaryVerifier.verify(partialSeatsSummary, seatedSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('seats count'))).toBe(true);
  });

  it('should reject when summary contains unexpected extra items', () => {
    const extraItemSummary: BookingSummary = {
      items: [
        { ticket: 'CAT 1 Standing', quantity: 2, price: 1500000 },
        { ticket: 'VIP Lounge Pass', quantity: 1, price: 500000 },
      ],
      subtotal: 3500000,
      fees: 0,
      currency: 'VND',
      total: 3500000,
    };

    const result = BookingSummaryVerifier.verify(extraItemSummary, validSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unexpected item') || e.includes('extra items'))).toBe(true);
  });

  it('should reject when ticket price exceeds maxPricePerTicket ceiling', () => {
    const ceilingSelection: CurrentSelection = {
      ...validSelection,
      maxPricePerTicket: 1000000,
    };

    const summary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 2, price: 1500000 }],
      subtotal: 3000000,
      fees: 0,
      currency: 'VND',
      total: 3000000,
    };

    const result = BookingSummaryVerifier.verify(summary, ceilingSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxPricePerTicket ceiling'))).toBe(true);
  });

  it('should reject when subtotal exceeds maxTotal ceiling', () => {
    const totalCeilingSelection: CurrentSelection = {
      ...validSelection,
      maxTotal: 2500000,
    };

    const summary: BookingSummary = {
      items: [{ ticket: 'CAT 1 Standing', quantity: 2, price: 1500000 }],
      subtotal: 3000000,
      fees: 0,
      currency: 'VND',
      total: 3000000,
    };

    const result = BookingSummaryVerifier.verify(summary, totalCeilingSelection);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxTotal ceiling'))).toBe(true);
  });
});
