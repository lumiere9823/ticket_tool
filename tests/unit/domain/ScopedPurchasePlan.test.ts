import { describe, it, expect, vi } from 'vitest';
import {
  ScopedPurchasePlan,
  createDefaultScopedPurchasePlan,
  filterByScope,
  assertInScope,
  pickTarget,
  DEFAULT_PERSISTENCE_POLICY,
  sanitizePersistencePolicy,
} from '../../../src/domain/entities/ScopedPurchasePlan';
import { ScopeViolationError } from '../../../src/domain/errors/DomainError';
import { ScopedPurchasePlanValidator } from '../../../src/domain/policies/ScopedPurchasePlanValidator';
import {
  EventCatalog,
  ShowingSnapshot,
  TicketType,
} from '../../../src/domain/entities/EventCatalog';
import { PriorityCategoryEngine } from '../../../src/domain/policies/PriorityCategoryEngine';
import { ArmAssistantUseCase } from '../../../src/application/use-cases/ArmAssistantUseCase';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { StorageRepository } from '../../../src/application/ports/StorageRepository';
import { EventBus } from '../../../src/application/ports/EventBus';
import { LoggerPort } from '../../../src/application/ports/LoggerPort';
import { JourneyTicketType } from '../../../src/domain/entities/BookingJourneyModels';

function makeTicket(props: Partial<TicketType> & { name: string }): TicketType {
  return {
    id: props.id ?? props.name.toLowerCase().replace(/\s+/g, '-'),
    name: props.name,
    price: props.price ?? { amount: 1000000, currency: 'VND' },
    mode: props.mode ?? 'STANDING',
    availability: props.availability ?? 'AVAILABLE',
    minQuantity: props.minQuantity ?? 1,
    maxQuantity: props.maxQuantity ?? 4,
    selectedQuantity: 0,
    selectable: props.selectable ?? true,
    source: { page: 'EVENT', evidence: ['test'] },
    rawLabel: props.rawLabel,
  };
}

function makeShowing(id: string, name: string, tickets: TicketType[]): ShowingSnapshot {
  return {
    id,
    name,
    date: name,
    ticketTypes: tickets,
  };
}

describe('Scoped Purchase Plan — Domain Model & Defaults', () => {
  it('creates default scoped purchase plan with expected initial values', () => {
    const plan = createDefaultScopedPurchasePlan('evt-100');
    expect(plan.eventId).toBe('evt-100');
    expect(plan.targets).toHaveLength(0);
    expect(plan.quantity).toBe(1);
    expect(plan.strategy).toBe('BY_TARGET_ORDER');
    expect(plan.persistence.maxDurationMinutes).toBe(120);
    expect(plan.persistence.maxAttempts).toBe(1000);
    expect(plan.persistence.pollIntervalMs).toBe(2000);
    expect(plan.persistence.jitterRatio).toBe(0.2);
  });
});

describe('filterByScope (BR-S01 & AC-01)', () => {
  it('AC-01: whitelist {15/10: VIP1}, only 16/10 VIP1 and 15/10 CAT2 are available -> do not buy, candidates rejected with reasons', () => {
    // 15/10 showing has VIP1 (SOLD_OUT) and CAT2 (AVAILABLE)
    const showing15 = makeShowing('show-15-10', '15/10/2026', [
      makeTicket({ id: 't-vip1', name: 'VIP1', availability: 'SOLD_OUT', selectable: false }),
      makeTicket({ id: 't-cat2', name: 'CAT2', availability: 'AVAILABLE', selectable: true }),
    ]);

    // 16/10 showing has VIP1 (AVAILABLE)
    const showing16 = makeShowing('show-16-10', '16/10/2026', [
      makeTicket({ id: 't-vip1-16', name: 'VIP1', availability: 'AVAILABLE', selectable: true }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-concert',
      eventTitle: 'Concert Test',
      eventUrl: 'https://ticketbox.vn/event/test',
      showings: [showing15, showing16],
    };

    // User plan: whitelist is strictly 15/10: VIP1
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-concert',
      targets: [
        {
          showingId: 'show-15-10',
          ticketTypeIds: ['t-vip1'],
          rank: 1,
        },
      ],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = filterByScope(catalog, plan);

    // 1. No valid candidates ready to purchase
    expect(result.validCandidates).toHaveLength(0);

    // 2. VIP1 on 15/10 is in-scope but rejected because it is SOLD_OUT
    expect(result.inScopeCandidates).toHaveLength(1);
    expect(result.inScopeCandidates[0]!.ticketName).toBe('VIP1');
    expect(result.inScopeCandidates[0]!.canAttemptSelection).toBe(false);

    // 3. 16/10 showing is outside whitelist -> all its tickets rejected
    const rejectedShowing16 = result.rejectedCandidates.find((r) => r.showingId === 'show-16-10');
    expect(rejectedShowing16).toBeDefined();
    expect(rejectedShowing16?.reason).toContain('SHOWING_NOT_IN_WHITELIST');

    // 4. CAT2 on 15/10 is outside whitelist -> rejected
    const rejectedCat2 = result.rejectedCandidates.find(
      (r) => r.showingId === 'show-15-10' && r.ticketName === 'CAT2'
    );
    expect(rejectedCat2).toBeDefined();
    expect(rejectedCat2?.reason).toContain('TICKET_NOT_IN_WHITELIST');
  });

  it('selects valid candidate when whitelisted ticket is available and within quantity limits', () => {
    const showing = makeShowing('show-1', 'Đêm 1', [
      makeTicket({ id: 't-vip', name: 'VIP', availability: 'AVAILABLE', maxQuantity: 4 }),
      makeTicket({ id: 't-ga', name: 'GA', availability: 'AVAILABLE', maxQuantity: 4 }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Show 1',
      eventUrl: 'https://ticketbox.vn/event/1',
      showings: [showing],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 2,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = filterByScope(catalog, plan);
    expect(result.validCandidates).toHaveLength(1);
    expect(result.validCandidates[0]!.ticketId).toBe('t-vip');
    expect(result.validCandidates[0]!.rank).toBe(1);
    expect(result.validCandidates[0]!.canAttemptSelection).toBe(true);
  });

  it('rejects candidate when requested quantity exceeds ticket maxQuantity', () => {
    const showing = makeShowing('show-1', 'Đêm 1', [
      makeTicket({ id: 't-vip', name: 'VIP', availability: 'AVAILABLE', maxQuantity: 2 }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Show 1',
      eventUrl: 'https://ticketbox.vn/event/1',
      showings: [showing],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 4, // exceeds maxQuantity of 2
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = filterByScope(catalog, plan);
    expect(result.validCandidates).toHaveLength(0);
    expect(result.inScopeCandidates).toHaveLength(1);
    expect(result.inScopeCandidates[0]!.canAttemptSelection).toBe(false);
    expect(result.inScopeCandidates[0]!.rejectionReason).toContain('QUANTITY_EXCEEDS_MAX');
  });

  it('handles edge case: ticket without ID matching by name', () => {
    const showing = makeShowing('show-1', 'Đêm 1', [
      makeTicket({
        id: null as unknown as string,
        name: 'Hạng Đặc Biệt',
        availability: 'AVAILABLE',
      }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Show 1',
      eventUrl: 'https://ticketbox.vn/event/1',
      showings: [showing],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['Hạng Đặc Biệt'], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = filterByScope(catalog, plan);
    expect(result.validCandidates).toHaveLength(1);
    expect(result.validCandidates[0]!.ticketName).toBe('Hạng Đặc Biệt');
  });
});

describe('ScopedPurchasePlanValidator (BR-S02, BR-S03, BR-S07, AC-09, AC-11)', () => {
  it('AC-09: blocks validation when whitelist is empty (empty targets)', () => {
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Whitelist is empty'))).toBe(true);
  });

  it('AC-09: blocks validation when targets have empty ticketTypeIds', () => {
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: [], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('At least one ticket type must be selected'))).toBe(
      true
    );
  });

  it('AC-11: blocks validation when quantity (4) exceeds maxQtyPerOrder (2)', () => {
    const showing = makeShowing('show-1', 'Đêm 1', [
      makeTicket({ id: 't-vip', name: 'VIP', maxQuantity: 2 }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Concert',
      eventUrl: 'https://ticketbox.vn',
      showings: [showing],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 4,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan, catalog);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds maxQtyPerOrder (2)'))).toBe(true);
  });

  it('blocks validation when pollIntervalMs is below the 1500ms floor (BR-S03)', () => {
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: {
        ...DEFAULT_PERSISTENCE_POLICY,
        pollIntervalMs: 1200, // below 1500ms floor
      },
    };

    const result = ScopedPurchasePlanValidator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('below the minimum allowed floor of 1500ms'))).toBe(
      true
    );
  });

  it('blocks validation when duplicate ranks are used across targets', () => {
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [
        { showingId: 'show-1', ticketTypeIds: ['t-vip1'], rank: 1 },
        { showingId: 'show-2', ticketTypeIds: ['t-vip2'], rank: 1 }, // duplicate rank 1
      ],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate rank 1 detected'))).toBe(true);
  });

  it('blocks validation when showing does not exist in catalog', () => {
    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Concert',
      eventUrl: 'https://ticketbox.vn',
      showings: [makeShowing('show-1', 'Đêm 1', [makeTicket({ id: 't-vip', name: 'VIP' })])],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'non-existent-showing', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan, catalog);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('does not exist in the current event catalog'))
    ).toBe(true);
  });

  it('blocks validation when ticket type does not exist in showing', () => {
    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Concert',
      eventUrl: 'https://ticketbox.vn',
      showings: [makeShowing('show-1', 'Đêm 1', [makeTicket({ id: 't-vip', name: 'VIP' })])],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-ghost-ticket'], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan, catalog);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Ticket type 't-ghost-ticket' does not exist"))
    ).toBe(true);
  });

  it('blocks validation when quantity exceeds declared attendee count (BR-S07)', () => {
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 3,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan, null, 2); // 2 declared attendees
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds declared attendee count (2)'))).toBe(true);
  });

  it('passes validation when all rules and constraints are satisfied', () => {
    const catalog: EventCatalog = {
      eventId: 'evt-1',
      eventTitle: 'Concert',
      eventUrl: 'https://ticketbox.vn',
      showings: [
        makeShowing('show-1', 'Đêm 1', [makeTicket({ id: 't-vip', name: 'VIP', maxQuantity: 4 })]),
      ],
    };

    const plan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
      quantity: 2,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = ScopedPurchasePlanValidator.validate(plan, catalog, 2);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('Scope Guard in PriorityCategoryEngine', () => {
  it('never falls back to an out-of-whitelist ticket even when allowFallback is true', () => {
    const tickets: JourneyTicketType[] = [
      {
        id: 't-vip1',
        showingId: 'show-1',
        name: 'VIP1',
        price: 2000000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'SOLD_OUT',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: false,
        evidence: [],
      },
      {
        id: 't-cat1',
        showingId: 'show-1',
        name: 'CAT1',
        price: 1000000,
        currency: 'VND',
        mode: 'STANDING',
        availability: 'AVAILABLE',
        minQuantity: 1,
        maxQuantity: 4,
        selectable: true,
        evidence: [],
      },
    ];

    // Scoped whitelist only includes VIP1
    const scopedPlan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip1'], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    // Even though allowFallback is true and CAT1 is AVAILABLE, Scope Guard MUST NOT select CAT1!
    const decision = PriorityCategoryEngine.evaluate(
      tickets,
      ['VIP1'],
      true, // allowFallback = true
      1,
      scopedPlan
    );

    expect(decision.selectedTicket).toBeNull();
    expect(decision.reason).toContain('No available tickets found');
  });
});

describe('ArmAssistantUseCase with Scope Guard (AC-09)', () => {
  it('throws DomainError and blocks ARM when scopedPurchasePlan has empty whitelist', async () => {
    const sm = new PurchaseStateMachine(PurchaseState.READY);
    const mockStorage: StorageRepository = {
      getConfiguration: vi.fn().mockResolvedValue(null),
      saveConfiguration: vi.fn().mockResolvedValue(undefined),
      clearConfiguration: vi.fn().mockResolvedValue(undefined),
      getLastState: vi.fn().mockResolvedValue(null),
      saveCurrentState: vi.fn().mockResolvedValue(undefined),
      getJourneyState: vi.fn().mockResolvedValue(null),
      saveJourneyState: vi.fn().mockResolvedValue(undefined),
      getLifecycleState: vi.fn().mockResolvedValue(null),
      saveLifecycleState: vi.fn().mockResolvedValue(undefined),
      getPersistentState: vi.fn().mockResolvedValue(null),
      savePersistentState: vi.fn().mockResolvedValue(undefined),
      clearPersistentState: vi.fn().mockResolvedValue(undefined),
      getProfiles: vi.fn().mockResolvedValue([]),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      getHumanInterventionRecord: vi.fn().mockResolvedValue(null),
      saveHumanInterventionRecord: vi.fn().mockResolvedValue(undefined),
      purgeUserProfile: vi.fn().mockResolvedValue(undefined),
      clearSession: vi.fn().mockResolvedValue(undefined),
    };
    const mockEventBus: EventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
    };
    const mockLogger: LoggerPort = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      withContext: vi.fn().mockReturnThis(),
    };

    const useCase = new ArmAssistantUseCase(sm, mockStorage, mockEventBus, mockLogger);

    const emptyScopedPlan: ScopedPurchasePlan = {
      eventId: 'evt-1',
      targets: [], // empty targets!
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    await expect(
      useCase.execute({
        eventUrl: 'https://ticketbox.vn/event/1',
        categoryPriority: [],
        quantity: 1,
        scopedPurchasePlan: emptyScopedPlan,
      })
    ).rejects.toThrow('ARM blocked by Scope Guard validation: Whitelist is empty');

    expect(sm.state).toBe(PurchaseState.READY); // Did NOT transition to ARMED
  });
});

describe('Phase 2: Scoped Persistent Purchase Requirements (C1, C2, C3, C6, C9)', () => {
  // C1 (A1)
  it('C1: two showings both have "VIP 1", but only one showing is whitelisted -> other showing VIP 1 is NEVER selected', () => {
    const showing1 = makeShowing('showing-night-1', 'Đêm 1', [
      makeTicket({ id: 't-vip1-n1', name: 'VIP 1', availability: 'SOLD_OUT', selectable: false }),
    ]);
    const showing2 = makeShowing('showing-night-2', 'Đêm 2', [
      makeTicket({ id: 't-vip1-n2', name: 'VIP 1', availability: 'AVAILABLE', selectable: true }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-c1',
      eventTitle: 'Concert C1',
      eventUrl: 'https://ticketbox.vn/c1',
      showings: [showing1, showing2],
    };

    // User only whitelisted showing-night-1
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-c1',
      targets: [
        {
          showingId: 'showing-night-1',
          ticketTypeIds: ['t-vip1-n1'],
          rank: 1,
        },
      ],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = filterByScope(catalog, plan);

    // Night 2 has available VIP 1, but must NOT be selected
    expect(result.validCandidates).toHaveLength(0);
    expect(result.inScopeCandidates).toHaveLength(1);
    expect(result.inScopeCandidates[0]!.showingId).toBe('showing-night-1');
    expect(result.inScopeCandidates[0]!.canAttemptSelection).toBe(false);

    const night2Rejected = result.rejectedCandidates.find((r) => r.showingId === 'showing-night-2');
    expect(night2Rejected).toBeDefined();
    expect(night2Rejected?.reason).toContain('SHOWING_NOT_IN_WHITELIST');
  });

  // C2 (A1)
  it('C2: duplicate ticket names in the same showing are rejected with AMBIGUOUS_MATCH without guessing', () => {
    const showing = makeShowing('show-ambig', 'Suất Duy Nhất', [
      makeTicket({ id: 't-zone-a-std', name: 'Zone A', availability: 'AVAILABLE' }),
      makeTicket({ id: 't-zone-a-combo', name: 'Zone A', availability: 'AVAILABLE' }),
    ]);

    const catalog: EventCatalog = {
      eventId: 'evt-c2',
      eventTitle: 'Show C2',
      eventUrl: 'https://ticketbox.vn/c2',
      showings: [showing],
    };

    // Whitelist configured by name "Zone A" (or target ticketTypeId is "Zone A")
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-c2',
      targets: [
        {
          showingId: 'show-ambig',
          ticketTypeIds: ['Zone A'],
          rank: 1,
        },
      ],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    const result = filterByScope(catalog, plan);

    expect(result.validCandidates).toHaveLength(0);
    const ambiguous = result.rejectedCandidates.filter((r) =>
      r.reason.startsWith('AMBIGUOUS_MATCH')
    );
    expect(ambiguous.length).toBeGreaterThanOrEqual(2);
  });

  // C3 (A2)
  it('C3: assertInScope throws ScopeViolationError for out-of-scope showing and ticket', () => {
    const plan: ScopedPurchasePlan = {
      eventId: 'evt-c3',
      targets: [
        {
          showingId: 'showing-auth',
          ticketTypeIds: ['t-auth-1', 't-auth-2'],
          rank: 1,
        },
      ],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    // Valid showing and ticket
    expect(() => assertInScope(plan, 'showing-auth', 't-auth-1')).not.toThrow();
    expect(() => assertInScope(plan, 'showing-auth', null)).not.toThrow();

    // Out of scope showing
    expect(() => assertInScope(plan, 'showing-evil', 't-auth-1')).toThrow(ScopeViolationError);
    expect(() => assertInScope(plan, 'showing-evil', null)).toThrow(
      'Showing showing-evil is outside whitelist'
    );

    // Out of scope ticket
    expect(() => assertInScope(plan, 'showing-auth', 't-unauthorized')).toThrow(
      ScopeViolationError
    );
    expect(() => assertInScope(plan, 'showing-auth', 't-unauthorized')).toThrow(
      'Ticket t-unauthorized is outside whitelist'
    );
  });

  // C6 (B2)
  describe('C6: pickTarget pure domain strategy engine', () => {
    function makeCandidate(props: {
      showingId: string;
      showingName: string;
      ticketId: string;
      ticketName: string;
      rank: number;
    }) {
      const t = makeTicket({ id: props.ticketId, name: props.ticketName });
      return {
        showingId: props.showingId,
        showingName: props.showingName,
        ticketId: props.ticketId,
        ticketName: props.ticketName,
        rank: props.rank,
        price: 1000000,
        mode: 'STANDING' as const,
        availability: 'AVAILABLE' as const,
        selectable: true,
        minQuantity: 1,
        maxQuantity: 4,
        inScope: true,
        canAttemptSelection: true,
        ticket: t,
      };
    }

    const candidateA = makeCandidate({
      showingId: 'show-1',
      showingName: 'Đêm 1',
      ticketId: 't-vip',
      ticketName: 'VIP',
      rank: 1,
    });
    const candidateB = makeCandidate({
      showingId: 'show-1',
      showingName: 'Đêm 1',
      ticketId: 't-ga',
      ticketName: 'GA',
      rank: 1,
    });
    const candidateC = makeCandidate({
      showingId: 'show-2',
      showingName: 'Đêm 2',
      ticketId: 't-vip',
      ticketName: 'VIP',
      rank: 2,
    });

    it('returns null when candidates list is empty', () => {
      const plan = createDefaultScopedPurchasePlan('evt-test');
      expect(pickTarget([], plan)).toBeNull();
    });

    it('BY_TARGET_ORDER: picks highest priority target in plan order', () => {
      const plan: ScopedPurchasePlan = {
        eventId: 'evt-c6',
        targets: [
          { showingId: 'show-1', ticketTypeIds: ['t-vip', 't-ga'], rank: 1 },
          { showingId: 'show-2', ticketTypeIds: ['t-vip'], rank: 2 },
        ],
        quantity: 1,
        strategy: 'BY_TARGET_ORDER',
        persistence: { ...DEFAULT_PERSISTENCE_POLICY },
      };

      // 1. All available -> picks first target in plan: show-1 / t-vip
      const target1 = pickTarget([candidateB, candidateA, candidateC], plan);
      expect(target1?.showingId).toBe('show-1');
      expect(target1?.ticketId).toBe('t-vip');

      // 2. Highest target (show-1 / t-vip) unavailable -> picks show-1 / t-ga
      const target2 = pickTarget([candidateB, candidateC], plan);
      expect(target2?.showingId).toBe('show-1');
      expect(target2?.ticketId).toBe('t-ga');

      // 3. show-1 unavailable -> picks show-2 / t-vip
      const target3 = pickTarget([candidateC], plan);
      expect(target3?.showingId).toBe('show-2');
      expect(target3?.ticketId).toBe('t-vip');
    });

    it('SHOWING_FIRST: prioritizes lowest rank (best showing) then earliest ticket', () => {
      const plan: ScopedPurchasePlan = {
        eventId: 'evt-c6',
        targets: [
          { showingId: 'show-2', ticketTypeIds: ['t-vip'], rank: 2 },
          { showingId: 'show-1', ticketTypeIds: ['t-ga', 't-vip'], rank: 1 },
        ],
        quantity: 1,
        strategy: 'SHOWING_FIRST',
        persistence: { ...DEFAULT_PERSISTENCE_POLICY },
      };

      const target = pickTarget([candidateC, candidateA, candidateB], plan);
      expect(target?.showingId).toBe('show-1');
      expect(target?.ticketId).toBe('t-ga');
    });

    it('TIER_FIRST: prioritizes tier name order then showing rank', () => {
      const plan: ScopedPurchasePlan = {
        eventId: 'evt-c6',
        targets: [
          { showingId: 'show-1', ticketTypeIds: ['t-ga'], rank: 1 },
          { showingId: 'show-2', ticketTypeIds: ['t-vip'], rank: 2 },
        ],
        quantity: 1,
        strategy: 'TIER_FIRST',
        persistence: { ...DEFAULT_PERSISTENCE_POLICY },
      };

      // In candidate list, t-ga is from show-1 (rank 1), t-vip is from show-2 (rank 2)
      // TIER_FIRST groups by ticketTypeId in plan target order
      const target = pickTarget([candidateC, candidateB], plan);
      expect(target?.ticketId).toBe('t-ga');
    });
  });

  // C9
  describe('C9: allowPartialQuantity support', () => {
    it('when allowPartialQuantity is false, rejects candidate if requested quantity > maxQuantity', () => {
      const showing = makeShowing('show-1', 'Đêm 1', [
        makeTicket({ id: 't-vip', name: 'VIP', availability: 'AVAILABLE', maxQuantity: 1 }),
      ]);
      const catalog: EventCatalog = {
        eventId: 'evt-c9',
        eventTitle: 'Concert C9',
        eventUrl: 'https://ticketbox.vn/c9',
        showings: [showing],
      };

      const plan: ScopedPurchasePlan = {
        eventId: 'evt-c9',
        targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
        quantity: 2, // Request 2, but max is 1
        strategy: 'BY_TARGET_ORDER',
        persistence: { ...DEFAULT_PERSISTENCE_POLICY },
        allowPartialQuantity: false,
      };

      const result = filterByScope(catalog, plan);
      expect(result.validCandidates).toHaveLength(0);
      const rejected = result.rejectedCandidates.find((r) => r.ticketId === 't-vip');
      expect(rejected?.reason).toContain('QUANTITY_EXCEEDS_MAX');
    });

    it('when allowPartialQuantity is true, accepts candidate even if requested quantity > maxQuantity', () => {
      const showing = makeShowing('show-1', 'Đêm 1', [
        makeTicket({ id: 't-vip', name: 'VIP', availability: 'AVAILABLE', maxQuantity: 1 }),
      ]);
      const catalog: EventCatalog = {
        eventId: 'evt-c9',
        eventTitle: 'Concert C9',
        eventUrl: 'https://ticketbox.vn/c9',
        showings: [showing],
      };

      const plan: ScopedPurchasePlan = {
        eventId: 'evt-c9',
        targets: [{ showingId: 'show-1', ticketTypeIds: ['t-vip'], rank: 1 }],
        quantity: 2, // Request 2, but partial is allowed
        strategy: 'BY_TARGET_ORDER',
        persistence: { ...DEFAULT_PERSISTENCE_POLICY },
        allowPartialQuantity: true,
      };

      const result = filterByScope(catalog, plan);
      expect(result.validCandidates).toHaveLength(1);
      expect(result.validCandidates[0]!.ticketId).toBe('t-vip');
      expect(result.validCandidates[0]!.canAttemptSelection).toBe(true);
    });

    it('matches ticket names case-insensitively and with trimmed whitespace in filterByScope and pickTarget', () => {
      const showing = makeShowing('show-1', 'Đêm 1', [
        makeTicket({ id: '1086256', name: 'ULTRA VIP - L2', availability: 'AVAILABLE' }),
      ]);
      const catalog: EventCatalog = {
        eventId: 'evt-c10',
        eventTitle: 'Concert C10',
        eventUrl: 'https://ticketbox.vn/c10',
        showings: [showing],
      };

      const plan: ScopedPurchasePlan = {
        eventId: 'evt-c10',
        targets: [{ showingId: 'show-1', ticketTypeIds: [' ultra vip - l2 '], rank: 1 }],
        quantity: 1,
        strategy: 'BY_TARGET_ORDER',
        persistence: { ...DEFAULT_PERSISTENCE_POLICY },
      };

      const result = filterByScope(catalog, plan);
      expect(result.validCandidates).toHaveLength(1);
      expect(result.validCandidates[0]!.ticketName).toBe('ULTRA VIP - L2');

      const picked = pickTarget(result.validCandidates, plan);
      expect(picked).not.toBeNull();
      expect(picked?.ticketName).toBe('ULTRA VIP - L2');

      // assertInScope with matching case variations and trims
      expect(() => assertInScope(plan, 'show-1', 'ultra vip - l2')).not.toThrow();
      expect(() => assertInScope(plan, 'show-1', 'ULTRA VIP - L2')).not.toThrow();
      expect(() => assertInScope(plan, 'show-1', '  ULTRA VIP - L2  ')).not.toThrow();
    });
  });

  describe('T1: Hard limits in ScopedPurchasePlanValidator and persistence sanitization', () => {
    const baseValidPlan: ScopedPurchasePlan = {
      eventId: 'evt-test',
      targets: [{ showingId: 'show-1', ticketTypeIds: ['t-1'], rank: 1 }],
      quantity: 1,
      strategy: 'BY_TARGET_ORDER',
      persistence: { ...DEFAULT_PERSISTENCE_POLICY },
    };

    it('rejects 0, negative, NaN, and exceeding ceilings in ScopedPurchasePlanValidator', () => {
      // 0 maxDurationMinutes
      const planZeroDuration = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxDurationMinutes: 0 },
      };
      const resZeroDuration = ScopedPurchasePlanValidator.validate(planZeroDuration);
      expect(resZeroDuration.valid).toBe(false);
      expect(resZeroDuration.errors.some((e) => e.includes('maxDurationMinutes'))).toBe(true);

      // negative maxDurationMinutes
      const planNegDuration = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxDurationMinutes: -10 },
      };
      expect(ScopedPurchasePlanValidator.validate(planNegDuration).valid).toBe(false);

      // NaN maxDurationMinutes
      const planNaNDuration = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxDurationMinutes: NaN },
      };
      expect(ScopedPurchasePlanValidator.validate(planNaNDuration).valid).toBe(false);

      // maxDurationMinutes > 240
      const planOverDuration = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxDurationMinutes: 241 },
      };
      const resOverDuration = ScopedPurchasePlanValidator.validate(planOverDuration);
      expect(resOverDuration.valid).toBe(false);
      expect(resOverDuration.errors.some((e) => e.includes('exceeds maximum ceiling of 240'))).toBe(true);

      // 0 maxAttempts
      const planZeroAttempts = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxAttempts: 0 },
      };
      expect(ScopedPurchasePlanValidator.validate(planZeroAttempts).valid).toBe(false);

      // negative maxAttempts
      const planNegAttempts = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxAttempts: -5 },
      };
      expect(ScopedPurchasePlanValidator.validate(planNegAttempts).valid).toBe(false);

      // NaN maxAttempts
      const planNaNAttempts = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxAttempts: NaN },
      };
      expect(ScopedPurchasePlanValidator.validate(planNaNAttempts).valid).toBe(false);

      // maxAttempts > 5000
      const planOverAttempts = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, maxAttempts: 5001 },
      };
      const resOverAttempts = ScopedPurchasePlanValidator.validate(planOverAttempts);
      expect(resOverAttempts.valid).toBe(false);
      expect(resOverAttempts.errors.some((e) => e.includes('exceeds maximum ceiling of 5000'))).toBe(true);

      // pollIntervalMs < 1500
      const planLowPoll = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, pollIntervalMs: 1499 },
      };
      expect(ScopedPurchasePlanValidator.validate(planLowPoll).valid).toBe(false);

      // pollIntervalMs NaN
      const planNaNPoll = {
        ...baseValidPlan,
        persistence: { ...baseValidPlan.persistence, pollIntervalMs: NaN },
      };
      expect(ScopedPurchasePlanValidator.validate(planNaNPoll).valid).toBe(false);
    });

    it('sanitizePersistencePolicy resolves safe defaults and enforces ceilings on 0, negative, NaN, missing, and over-limit values', () => {
      // Missing / empty policy
      const sanitizedEmpty = sanitizePersistencePolicy(undefined);
      expect(sanitizedEmpty.maxDurationMinutes).toBe(120);
      expect(sanitizedEmpty.maxAttempts).toBe(1000);
      expect(sanitizedEmpty.pollIntervalMs).toBe(2000);

      // 0, negative, NaN values
      const sanitizedInvalid = sanitizePersistencePolicy({
        maxDurationMinutes: 0,
        maxAttempts: -10,
        pollIntervalMs: NaN,
      });
      expect(sanitizedInvalid.maxDurationMinutes).toBe(120);
      expect(sanitizedInvalid.maxAttempts).toBe(1000);
      expect(sanitizedInvalid.pollIntervalMs).toBe(2000);

      // Values exceeding ceiling are clamped
      const sanitizedCeiling = sanitizePersistencePolicy({
        maxDurationMinutes: 500,
        maxAttempts: 99999,
        pollIntervalMs: 500, // below 1500 floor
      });
      expect(sanitizedCeiling.maxDurationMinutes).toBe(240);
      expect(sanitizedCeiling.maxAttempts).toBe(5000);
      expect(sanitizedCeiling.pollIntervalMs).toBe(1500);
    });
  });
});

