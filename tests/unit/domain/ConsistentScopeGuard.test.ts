import { describe, it, expect, vi } from 'vitest';
import { PriorityCategoryEngine } from '../../../src/domain/policies/PriorityCategoryEngine';
import { JourneyTicketType } from '../../../src/domain/entities/BookingJourneyModels';
import { ScopedPurchasePlan, filterByScope } from '../../../src/domain/entities/ScopedPurchasePlan';
import { EventCatalog } from '../../../src/domain/entities/EventCatalog';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { TicketboxPageAdapter } from '../../../src/application/ports/TicketboxPageAdapter';
import { EventBus } from '../../../src/application/ports/EventBus';
import { LoggerPort } from '../../../src/application/ports/LoggerPort';

describe('P2-2: Scope Guard Consistency & Fail-Closed Behavior', () => {
  const baseScopedPlan: ScopedPurchasePlan = {
    eventId: 'evt-100',
    targets: [
      {
        showingId: 'showing-1',
        ticketTypeIds: ['ticket-vip', 'VIP'],
        rank: 1,
      },
    ],
    quantity: 1,
    strategy: 'BY_TARGET_ORDER',
    allowPartialQuantity: false,
    persistence: {
      maxDurationMinutes: 30,
      maxAttempts: 100,
      pollIntervalMs: 2000,
      jitterRatio: 0.2,
    },
  };

  describe('PriorityCategoryEngine.evaluate Fail-Closed Rules', () => {
    it('should REJECT ticket when ticket.showingId is missing/null, even if allowFallback=true', () => {
      const ticketsWithMissingShowing: JourneyTicketType[] = [
        {
          id: 'ticket-vip',
          showingId: null, // MISSING showingId
          name: 'VIP',
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

      const result = PriorityCategoryEngine.evaluate(
        ticketsWithMissingShowing,
        ['VIP'],
        true, // allowFallback=true
        1,
        baseScopedPlan
      );

      // Ticket missing showingId must be excluded by the hard scope guard
      expect(result.selectedTicket).toBeNull();
      expect(result.reason).toContain('outside the scoped whitelist');
    });

    it('should REJECT target with showingId="default" when catalog has multiple showings', () => {
      const planWithDefaultShowing: ScopedPurchasePlan = {
        ...baseScopedPlan,
        targets: [
          {
            showingId: 'default',
            ticketTypeIds: ['ticket-vip', 'VIP'],
            rank: 1,
          },
        ],
      };

      const ticketsMultipleShowings: JourneyTicketType[] = [
        {
          id: 'ticket-vip',
          showingId: 'showing-1',
          name: 'VIP',
          price: 2000000,
          currency: 'VND',
          mode: 'STANDING',
          availability: 'AVAILABLE',
          minQuantity: 1,
          maxQuantity: 4,
          selectable: true,
          evidence: [],
        },
        {
          id: 'ticket-vip-2',
          showingId: 'showing-2',
          name: 'VIP',
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

      const result = PriorityCategoryEngine.evaluate(
        ticketsMultipleShowings,
        ['VIP'],
        true,
        1,
        planWithDefaultShowing
      );

      // In multiple showings, 'default' is ambiguous and must be rejected
      expect(result.selectedTicket).toBeNull();
      expect(result.reason).toContain('outside the scoped whitelist');
    });

    it('should ACCEPT target with showingId="default" only when there is strictly a single showing', () => {
      const planWithDefaultShowing: ScopedPurchasePlan = {
        ...baseScopedPlan,
        targets: [
          {
            showingId: 'default',
            ticketTypeIds: ['ticket-vip', 'VIP'],
            rank: 1,
          },
        ],
      };

      const ticketsSingleShowing: JourneyTicketType[] = [
        {
          id: 'ticket-vip',
          showingId: 'showing-only-1',
          name: 'VIP',
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

      const result = PriorityCategoryEngine.evaluate(
        ticketsSingleShowing,
        ['VIP'],
        false,
        1,
        planWithDefaultShowing
      );

      expect(result.selectedTicket).not.toBeNull();
      expect(result.selectedTicket?.id).toBe('ticket-vip');
    });

    it('should REJECT ticket matched by name when name is ambiguous within the same showing (AMBIGUOUS_MATCH)', () => {
      const ticketsWithDuplicateName: JourneyTicketType[] = [
        {
          id: 'vip-zone-a',
          showingId: 'showing-1',
          name: 'VIP', // Duplicate name in same showing
          price: 2000000,
          currency: 'VND',
          mode: 'STANDING',
          availability: 'AVAILABLE',
          minQuantity: 1,
          maxQuantity: 4,
          selectable: true,
          evidence: [],
        },
        {
          id: 'vip-zone-b',
          showingId: 'showing-1',
          name: 'VIP', // Duplicate name in same showing
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

      // Plan targets "VIP" by name only (does not specify 'vip-zone-a' or 'vip-zone-b')
      const planNameTarget: ScopedPurchasePlan = {
        ...baseScopedPlan,
        targets: [
          {
            showingId: 'showing-1',
            ticketTypeIds: ['VIP'],
            rank: 1,
          },
        ],
      };

      const result = PriorityCategoryEngine.evaluate(
        ticketsWithDuplicateName,
        ['VIP'],
        false,
        1,
        planNameTarget
      );

      // Must be rejected due to ambiguity
      expect(result.selectedTicket).toBeNull();
      expect(result.reason).toContain('outside the scoped whitelist');
    });
  });

  describe('filterByScope with default showing and multiple showings', () => {
    it('should reject showingId="default" in filterByScope when catalog contains more than 1 showing', () => {
      const multiShowingCatalog: EventCatalog = {
        eventId: 'evt-1',
        eventTitle: 'Concert',
        eventUrl: 'https://ticketbox.vn/event/1',
        showings: [
          {
            id: 'sh-1',
            name: 'Night 1',
            date: '2026-10-10',
            ticketTypes: [
              {
                id: 't-1',
                name: 'VIP',
                price: { amount: 1000000, currency: 'VND' },
                mode: 'STANDING',
                availability: 'AVAILABLE',
                minQuantity: 1,
                maxQuantity: 4,
                selectedQuantity: 0,
                selectable: true,
                source: { page: 'EVENT', evidence: [] },
              },
            ],
          },
          {
            id: 'sh-2',
            name: 'Night 2',
            date: '2026-10-11',
            ticketTypes: [
              {
                id: 't-2',
                name: 'VIP',
                price: { amount: 1000000, currency: 'VND' },
                mode: 'STANDING',
                availability: 'AVAILABLE',
                minQuantity: 1,
                maxQuantity: 4,
                selectedQuantity: 0,
                selectable: true,
                source: { page: 'EVENT', evidence: [] },
              },
            ],
          },
        ],
      };

      const defaultPlan: ScopedPurchasePlan = {
        ...baseScopedPlan,
        targets: [{ showingId: 'default', ticketTypeIds: ['t-1'], rank: 1 }],
      };

      const result = filterByScope(multiShowingCatalog, defaultPlan);
      expect(result.validCandidates.length).toBe(0);
      expect(result.rejectedCandidates.some((r) => r.reason.includes('outside scoped targets'))).toBe(true);
    });
  });

  describe('ExecuteBookingJourneyUseCase Area Selection Safety', () => {
    it('should NOT match "VIP" ticket tier to "ULTRA VIP" area (no loose two-way includes match)', async () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      const fakeAdapter = {
        getEventState: vi.fn().mockResolvedValue({ event: { id: 'e1', name: 'Show' } }),
        discoverShowings: vi.fn().mockResolvedValue([{ id: 's1', name: 'Show 1', ticketTypes: [] }]),
        discoverJourneyTickets: vi.fn().mockResolvedValue([
          {
            id: 't-vip',
            showingId: 's1',
            name: 'VIP',
            price: 1500000,
            currency: 'VND',
            mode: 'SEATED',
            availability: 'AVAILABLE',
            minQuantity: 1,
            maxQuantity: 4,
            selectable: true,
            evidence: [],
          },
        ]),
        detectSeatMap: vi.fn().mockResolvedValue({ hasSeatMap: true }),
        discoverAreas: vi.fn().mockResolvedValue([
          {
            id: 'area-ultra-vip',
            name: 'ULTRA VIP', // Should NOT match "VIP"
            ticketTypeId: 't-ultra-vip',
            ticketTypeName: 'ULTRA VIP',
            availability: 'AVAILABLE',
            selectable: true,
          },
        ]),
        selectTicket: vi.fn().mockResolvedValue(true),
        selectArea: vi.fn(),
        discoverSeats: vi.fn().mockResolvedValue([]),
      };

      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const eventBus = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };

      const useCase = new ExecuteBookingJourneyUseCase(
        sm,
        fakeAdapter as unknown as TicketboxPageAdapter,
        eventBus as unknown as EventBus,
        logger as unknown as LoggerPort
      );

      // Attempting to select area should fail with NO_AVAILABLE_SEATS and NOT pick "ULTRA VIP"
      const result = await useCase.execute({
        categoryPriority: ['VIP'],
        quantity: 1,
        allowFallback: false,
        seatPreference: 'ANY_AVAILABLE',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No available seat areas found matching 'VIP'");
      expect(fakeAdapter.selectArea).not.toHaveBeenCalledWith(
        'area-ultra-vip',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });
});
