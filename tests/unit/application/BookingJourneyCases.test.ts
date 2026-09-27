import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { BOOKING_JOURNEY_FIXTURES } from '../../fixtures/booking/bookingFixtures';
import { BookingPreferences } from '../../../src/domain/entities/BookingJourneyModels';
import { BookingError } from '../../../src/domain/errors/BookingErrors';

describe('Booking Journey Cases and Flows (Cases A - L & Flows 1 - 7)', () => {
  let stateMachine: PurchaseStateMachine;
  let eventBus: ChromeMessageBus;
  let logger: SanitizedLogger;

  beforeEach(() => {
    stateMachine = new PurchaseStateMachine(PurchaseState.READY);
    eventBus = new ChromeMessageBus();
    logger = new SanitizedLogger();
  });

  // FLOW 1 & CASE A: Normal Standing Flow
  it('Flow 1 & Case A: should complete standing flow up to PAYMENT_GATE', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['Hoả Tâm 2'],
      quantity: 2,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.requiresUserAction).toBe(true);
    expect(result.selection).toBeDefined();
    expect(result.selection?.name).toBe('Hoả Tâm 2');
    expect(result.selection?.quantity).toBe(2);
    expect(result.selection?.mode).toBe('STANDING');
  });

  // CASE B: Standing ticket with max quantity = 1
  it('Case B: should reject when requested quantity exceeds observable max quantity', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_B_STANDING_MAX_QTY_1);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    // Requesting 2 when max is 1
    const preferences: BookingPreferences = {
      categoryPriority: ['GA Special Limited'],
      quantity: 2,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(false);
    expect(result.finalState).toBe(PurchaseState.WAITING);
    expect(result.actionRequiredReason).toContain('cannot satisfy requested quantity of 2');
  });

  it('Case B: should succeed when requested quantity equals 1', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_B_STANDING_MAX_QTY_1);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['GA Special Limited'],
      quantity: 1,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.selection?.quantity).toBe(1);
  });

  // FLOW 3 & CASE C: Fallback flow when preferred ticket is sold out
  it('Flow 3 & Case C: should select available fallback ticket when top priority is sold out', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_C_MULTIPLE_STANDING);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['VIP Standing', 'CAT 1 Standing'],
      quantity: 2,
      allowFallback: true,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.selection?.name).toBe('CAT 1 Standing');
    expect(result.selection?.quantity).toBe(2);
  });

  // FLOW 4: Waiting flow when fallback is disabled
  it('Flow 4: should transition to WAITING when top priority is sold out and fallback is disabled', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_C_MULTIPLE_STANDING);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['VIP Standing'],
      quantity: 1,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(false);
    expect(result.finalState).toBe(PurchaseState.WAITING);
  });

  // FLOW 2 & CASE D: Seated Flow with Area Selection
  it('Flow 2 & Case D: should execute seated flow with area selection and summary verification', async () => {
    const root = parseHtmlToDOMElementLike(
      BOOKING_JOURNEY_FIXTURES.CASE_D_SEATED_WITH_AREA_SELECTION
    );
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['Ngoại Ô 1'],
      quantity: 2,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.selection?.name).toBe('Ngoại Ô 1');
    expect(result.selection?.areaId).toBe('zone-ngoai-o-1');
    expect(result.selection?.seats).toEqual(['A12', 'A13']);
  });

  // CASE E: Seated ticket with seat map
  it('Case E: should select individual seats from seat map', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_E_SEATED_WITH_SEAT_MAP);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['VIP Seated'],
      quantity: 2,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.selection?.seats).toEqual(['A01', 'A02']);
  });

  // CASE F: Two adjacent seats selection
  it('Case F: should select adjacent available seats and bypass occupied seats', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_F_TWO_ADJACENT_SEATS);
    const adapter = new TicketboxJourneyAdapter(logger, root);

    const seats = await adapter.discoverSeats();
    expect(seats).toHaveLength(5);

    const { AdjacentSeatStrategy } =
      await import('../../../src/domain/policies/AdjacentSeatStrategy');
    const decision = AdjacentSeatStrategy.selectSeats(seats, 2);

    expect(decision.status).toBe('SUCCESS');
    expect(decision.isAdjacent).toBe(true);
    expect(decision.selectedSeats.map((s) => s.label)).toEqual(['A02', 'A03']);
  });

  // CASE G: Only non-adjacent seats available
  it('Case G: should follow nonAdjacentFallback policy when no adjacent seats exist', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_G_ONLY_NON_ADJACENT_SEATS);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const seats = await adapter.discoverSeats();

    const { AdjacentSeatStrategy } =
      await import('../../../src/domain/policies/AdjacentSeatStrategy');

    // Policy 1: WAIT
    const waitDecision = AdjacentSeatStrategy.selectSeats(
      seats,
      2,
      undefined,
      'ANY_AVAILABLE',
      'WAIT'
    );
    expect(waitDecision.status).toBe('WAIT');

    // Policy 2: SELECT_NON_ADJACENT
    const nonAdjDecision = AdjacentSeatStrategy.selectSeats(
      seats,
      2,
      undefined,
      'ANY_AVAILABLE',
      'SELECT_NON_ADJACENT'
    );
    expect(nonAdjDecision.status).toBe('SUCCESS');
    expect(nonAdjDecision.isAdjacent).toBe(false);
    expect(nonAdjDecision.selectedSeats.map((s) => s.label)).toEqual(['A01', 'A04']);
  });

  // FLOW 5 & CASE H: Stale Element Recovery with Retry
  it('Flow 5 & Case H: should recover from transient failure using retry mechanism', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING);
    const adapter = new TicketboxJourneyAdapter(logger, root);

    // Spy on selectTicket to fail once with recoverable BookingError, then succeed
    let attempts = 0;
    const originalSelectTicket = adapter.selectTicket.bind(adapter);
    vi.spyOn(adapter, 'selectTicket').mockImplementation(async (id: string, qty: number) => {
      attempts++;
      if (attempts === 1) {
        throw new BookingError({
          code: 'STALE_ELEMENT',
          message: 'Element detached from DOM during click',
          state: PurchaseState.TICKETS_DETECTED,
          recoverable: true,
        });
      }
      return originalSelectTicket(id, qty);
    });

    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);
    const preferences: BookingPreferences = {
      categoryPriority: ['Hoả Tâm 2'],
      quantity: 2,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(attempts).toBe(2);
    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
  });

  // CASE I: Question Form with required fields
  it('Case I: should fill and validate attendee questionnaire when profile matches', async () => {
    // Combine ticket fixture with Case I question form
    const combinedHtml = `
      ${BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING}
      ${BOOKING_JOURNEY_FIXTURES.CASE_I_QUESTION_FORM}
    `;
    const root = parseHtmlToDOMElementLike(combinedHtml);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['Hoả Tâm 2'],
      quantity: 2,
      allowFallback: false,
      userProfile: {
        fullName: 'Nguyen Van A',
        phone: '0901234567',
        email: 'nguyenvana@example.com',
        agreeToTerms: true,
      },
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
  });

  // CASE J: Consent Required Gate
  it('Case J: should stop at CONSENT_REQUIRED gate when terms are not agreed', async () => {
    // Combine ticket fixture with Case J consent form
    const combinedHtml = `
      ${BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING}
      ${BOOKING_JOURNEY_FIXTURES.CASE_J_CONSENT_FORM}
    `;
    const root = parseHtmlToDOMElementLike(combinedHtml);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['Hoả Tâm 2'],
      quantity: 2,
      allowFallback: false,
      userProfile: {
        fullName: 'Nguyen Van A',
        phone: '0901234567',
        email: 'nguyenvana@example.com',
        agreeToTerms: false, // User has NOT given explicit consent
      },
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(PurchaseState.CONSENT_REQUIRED);
    expect(result.requiresUserAction).toBe(true);
    expect(result.actionRequiredReason).toBe('User consent required');
  });

  // FLOW 7 & CASE K: Payment Gate Handoff
  it('Flow 7 & Case K: should halt at PAYMENT_GATE and notify user without attempting automated payment', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);
    const preferences: BookingPreferences = {
      categoryPriority: ['Hoả Tâm 2'],
      quantity: 2,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.requiresUserAction).toBe(true);
    expect(result.actionRequiredReason).toContain('Payment step reached');

    // Confirm notification was emitted
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NOTIFICATION_EVENT',
        category: 'PAYMENT_REQUIRED',
      })
    );
  });

  // FLOW 6 & CASE L: Unsupported Flow Fail-Safe
  it('Flow 6 & Case L: should fail safely when DOM has unsupported structure', async () => {
    const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_L_UNSUPPORTED_STRUCTURE);
    const adapter = new TicketboxJourneyAdapter(logger, root);
    const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

    const preferences: BookingPreferences = {
      categoryPriority: ['Any Ticket'],
      quantity: 1,
      allowFallback: false,
    };

    const result = await useCase.execute(preferences);

    expect(result.success).toBe(false);
    expect(result.finalState).toBe(PurchaseState.FAILED);
    expect(result.error).toContain('No ticket tiers detected');
  });
});
