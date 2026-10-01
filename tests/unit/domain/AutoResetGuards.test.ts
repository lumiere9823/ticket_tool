import { describe, it, expect, vi } from 'vitest';
import { PurchaseStateMachine, PurchaseState, canAutoReset } from '../../../src/domain';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';

describe('Auto-Reset Guards (P1-3)', () => {
  describe('canAutoReset domain policy', () => {
    it('returns false for all human intervention states', () => {
      const humanInterventionStates = [
        PurchaseState.CAPTCHA_REQUIRED,
        PurchaseState.OTP_REQUIRED,
        PurchaseState.PAYMENT_ACTION_REQUIRED,
        PurchaseState.SESSION_REAUTH_REQUIRED,
        PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
        PurchaseState.HUMAN_INTERVENTION_REQUIRED,
        PurchaseState.CONSENT_REQUIRED,
        PurchaseState.PAYMENT_GATE,
      ];

      for (const state of humanInterventionStates) {
        expect(canAutoReset(state)).toBe(false);
      }
    });

    it('returns false for critical reservation, payment, and transitional verification states', () => {
      const protectedStates = [
        PurchaseState.HELD,
        PurchaseState.CHECKOUT,
        PurchaseState.PAYMENT,
        PurchaseState.CONFIRMATION_PENDING,
        PurchaseState.CONFIRMED,
        PurchaseState.STATE_RECHECK,
      ];

      for (const state of protectedStates) {
        expect(canAutoReset(state)).toBe(false);
      }
    });

    it('returns true for normal pre-reservation, monitoring, and failure states', () => {
      const autoResettableStates = [
        PurchaseState.INIT,
        PurchaseState.AUTH_CHECK,
        PurchaseState.EVENT_CHECK,
        PurchaseState.READY,
        PurchaseState.ARMED,
        PurchaseState.MONITORING,
        PurchaseState.AVAILABLE_DETECTED,
        PurchaseState.SELECTING,
        PurchaseState.TICKET_SELECTED,
        PurchaseState.RESERVING,
        PurchaseState.STOPPED,
        PurchaseState.STOPPED_LIMIT_REACHED,
        PurchaseState.STOPPED_NO_TARGET,
        PurchaseState.FAILED,
        PurchaseState.WAITING_FOR_STOCK,
        PurchaseState.RETRYING_TARGET,
      ];

      for (const state of autoResettableStates) {
        expect(canAutoReset(state)).toBe(true);
      }
    });
  });

  describe('ExecuteBookingJourneyUseCase auto-reset guards', () => {
    it('halts and preserves human intervention states without resetting to MONITORING', async () => {
      const interventionStates = [
        PurchaseState.CAPTCHA_REQUIRED,
        PurchaseState.OTP_REQUIRED,
        PurchaseState.PAYMENT_ACTION_REQUIRED,
        PurchaseState.SESSION_REAUTH_REQUIRED,
        PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
        PurchaseState.HUMAN_INTERVENTION_REQUIRED,
      ];

      for (const state of interventionStates) {
        const sm = new PurchaseStateMachine(state);
        const logger = new SanitizedLogger();
        const adapter = new TicketboxJourneyAdapter(logger);
        const eventBus: import('../../../src/application/ports/EventBus').EventBus = {
          publish: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(() => {}),
        };
        const useCase = new ExecuteBookingJourneyUseCase(sm, adapter, eventBus, logger);

        const result = await useCase.execute({
          categoryPriority: ['VIP'],
          quantity: 1,
          allowFallback: false,
        });

        expect(result.success).toBe(true);
        expect(result.finalState).toBe(state);
        expect(result.requiresUserAction).toBe(true);
        // State machine must NOT have been silently reset
        expect(sm.state).toBe(state);
      }
    });
  });
});
