/**
 * Purchase Plan Test Fixtures
 * Covers 10 scenarios (A-J) as required by the implementation spec.
 *
 * Each fixture provides:
 * - catalog: TicketOption[] (discovered tickets)
 * - plan: PurchasePlan (user configuration)
 * - description: scenario description
 */

import { TicketOption } from '../../../src/domain/entities/PurchasePlan';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeTicket(
  id: string,
  name: string,
  price: number,
  mode: TicketOption['mode'],
  availability: TicketOption['availability'],
  minQty: number | null = 1,
  maxQty: number | null = 4
): TicketOption {
  return {
    id,
    name,
    price,
    currency: 'VND',
    mode,
    availability,
    selectable: availability === 'AVAILABLE',
    minQuantity: minQty,
    maxQuantity: maxQty,
    source: 'EVENT_PAGE',
    evidence: [`status-text: ${availability === 'AVAILABLE' ? 'Còn vé' : 'Hết vé'}`],
  };
}

// ─── Scenario A: VIP Standing, Available ─────────────────────────────────────

export const FIXTURE_A_VIP_STANDING_AVAILABLE: TicketOption[] = [
  makeTicket('vip-stand-a', 'VIP Standing', 1_500_000, 'STANDING', 'AVAILABLE', 1, 4),
];

// ─── Scenario B: VIP Standing, Sold Out ──────────────────────────────────────

export const FIXTURE_B_VIP_STANDING_SOLDOUT: TicketOption[] = [
  makeTicket('vip-stand-b', 'VIP Standing', 1_500_000, 'STANDING', 'SOLD_OUT', 1, 4),
];

// ─── Scenario C: VIP Seated, Area Selection Required ─────────────────────────

export const FIXTURE_C_VIP_SEATED_AREA: TicketOption[] = [
  makeTicket('vip-seated-c', 'VIP Seated', 3_500_000, 'SEATED', 'AVAILABLE', 1, 2),
];

// ─── Scenario D: VIP Seated, Seat Selection Required ─────────────────────────

export const FIXTURE_D_VIP_SEATED_SEATS: TicketOption[] = [
  makeTicket('vip-seat-d', 'VIP (Ngồi)', 4_000_000, 'SEATED', 'AVAILABLE', 1, 2),
];

// ─── Scenario E: Multiple Areas ───────────────────────────────────────────────

export const FIXTURE_E_MULTIPLE_AREAS: TicketOption[] = [
  makeTicket('area-ht1', 'Hoả Tâm 1', 3_000_000, 'AREA_BASED', 'AVAILABLE', 1, 4),
  makeTicket('area-ht2', 'Hoả Tâm 2', 2_500_000, 'AREA_BASED', 'AVAILABLE', 1, 4),
  makeTicket('area-ct1', 'Chiến Tướng 1', 2_000_000, 'AREA_BASED', 'AVAILABLE', 1, 4),
  makeTicket('area-ct2', 'Chiến Tướng 2', 2_000_000, 'AREA_BASED', 'SOLD_OUT', 1, 4),
];

// ─── Scenario F: Multiple Seats ───────────────────────────────────────────────

export const FIXTURE_F_MULTIPLE_SEATS: TicketOption[] = [
  makeTicket('ngoai-o-1', 'Ngoại Ô 1 (Seated)', 3_200_000, 'SEATED', 'AVAILABLE', 1, 4),
  makeTicket('ngoai-o-2', 'Ngoại Ô 2 (Seated)', 3_200_000, 'SEATED', 'AVAILABLE', 1, 4),
];

// ─── Scenario G: Quantity max = 1 ─────────────────────────────────────────────

export const FIXTURE_G_QTY_MAX_ONE: TicketOption[] = [
  makeTicket('exclusive-1', 'Exclusive Pass', 5_000_000, 'STANDING', 'AVAILABLE', 1, 1),
];

// ─── Scenario H: Quantity max = 4 ─────────────────────────────────────────────

export const FIXTURE_H_QTY_MAX_FOUR: TicketOption[] = [
  makeTicket('family-1', 'Family Bundle', 6_000_000, 'STANDING', 'AVAILABLE', 2, 4),
];

// ─── Scenario I: Ticket becomes sold out after discovery ─────────────────────

export const FIXTURE_I_BECOMES_SOLDOUT_INITIAL: TicketOption[] = [
  makeTicket('cat1-i', 'CAT 1', 1_000_000, 'STANDING', 'AVAILABLE', 1, 4),
  makeTicket('cat2-i', 'CAT 2', 800_000, 'STANDING', 'AVAILABLE', 1, 4),
];

/** Simulates the catalog after CAT 1 sells out. */
export const FIXTURE_I_BECOMES_SOLDOUT_AFTER: TicketOption[] = [
  makeTicket('cat1-i', 'CAT 1', 1_000_000, 'STANDING', 'SOLD_OUT', 1, 4),
  makeTicket('cat2-i', 'CAT 2', 800_000, 'STANDING', 'AVAILABLE', 1, 4),
];

// ─── Scenario J: Mixed ticket types, single booking flow ─────────────────────

/** A catalog where mixed ticket selection is NOT supported (single-ticket flow). */
export const FIXTURE_J_MIXED_NOT_SUPPORTED: TicketOption[] = [
  makeTicket('ga-j', 'GA Standing', 800_000, 'STANDING', 'AVAILABLE', 1, 4),
  makeTicket('vip-j', 'VIP Seated', 2_000_000, 'SEATED', 'AVAILABLE', 1, 2),
];
