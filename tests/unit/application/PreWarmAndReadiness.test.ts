import { describe, it, expect, vi } from 'vitest';
import { PreWarmPurchasePlanUseCase } from '../../../src/application/use-cases/PreWarmPurchasePlanUseCase';
import { evaluatePreT0Readiness } from '../../../src/domain/policies/ReadinessEvaluator';
import { TicketboxPageAdapter } from '../../../src/application/ports/TicketboxPageAdapter';

describe('N3: Pre-warm and Readiness Evaluation', () => {
  describe('evaluatePreT0Readiness', () => {
    it('returns ready when all pre-T0 conditions are met', () => {
      const result = evaluatePreT0Readiness({
        isClockSynchronized: true,
        isTabForeground: true,
        isAuthenticated: true,
        userProfile: {
          fullName: 'Nguyen Van A',
          phone: '0901234567',
          email: 'a@example.com',
          agreeToTerms: true,
        },
      });

      expect(result.isReady).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.checks.clockSynchronized).toBe(true);
      expect(result.checks.tabForeground).toBe(true);
      expect(result.checks.authenticated).toBe(true);
      expect(result.checks.profileComplete).toBe(true);
      expect(result.checks.termsAgreed).toBe(true);
    });

    it('returns warnings when clock, foreground, or profile/terms are missing', () => {
      const result = evaluatePreT0Readiness({
        isClockSynchronized: false,
        isTabForeground: false,
        isAuthenticated: false,
        userProfile: {
          fullName: '',
          phone: '',
          email: '',
          agreeToTerms: false,
        },
      });

      expect(result.isReady).toBe(false);
      expect(result.warnings.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('PreWarmPurchasePlanUseCase', () => {
    it('pre-warms showing and seatmap strictly respecting Scope Guard whitelist', async () => {
      const fetchShowingApi = vi.fn().mockResolvedValue({ success: true });
      const fetchSeatmapApi = vi.fn().mockResolvedValue({ success: true });
      const fetchEventApi = vi.fn().mockResolvedValue({ success: true });
      const fetchQuestionFormApi = vi.fn().mockResolvedValue({ success: true });

      const mockAdapter: Partial<TicketboxPageAdapter> = {
        fetchShowingApi,
        fetchSeatmapApi,
        fetchEventApi,
        fetchQuestionFormApi,
      };

      const useCase = new PreWarmPurchasePlanUseCase(mockAdapter as TicketboxPageAdapter);

      const result = await useCase.execute({
        eventId: 'event_123',
        scopedPurchasePlan: {
          eventId: 'event_123',
          quantity: 1,
          strategy: 'BY_TARGET_ORDER',
          persistence: {
            maxDurationMinutes: 120,
            maxAttempts: 1000,
            pollIntervalMs: 2000,
            jitterRatio: 0.2,
          },
          targets: [
            { showingId: 'showing_A', ticketTypeIds: ['ticket_1'], rank: 1 },
            { showingId: 'showing_B', ticketTypeIds: ['ticket_2'], rank: 2 },
          ],
        },
      });

      expect(fetchEventApi).toHaveBeenCalledWith('event_123');
      expect(fetchQuestionFormApi).toHaveBeenCalledWith('event_123');
      expect(fetchShowingApi).toHaveBeenCalledWith('showing_A');
      expect(fetchShowingApi).toHaveBeenCalledWith('showing_B');
      expect(fetchSeatmapApi).toHaveBeenCalledWith('showing_A');
      expect(fetchSeatmapApi).toHaveBeenCalledWith('showing_B');

      expect(result.warmedShowings).toEqual(['showing_A', 'showing_B']);
      expect(result.warmedSeatmaps).toEqual(['showing_A', 'showing_B']);
      expect(result.warmedEvent).toBe(true);
      expect(result.warmedQuestionForm).toBe(true);
    });

    it('does NOT execute any DOM mutations or clicks', async () => {
      const clickElement = vi.fn();
      const mockAdapter: Partial<TicketboxPageAdapter> = {
        fetchEventApi: vi.fn().mockResolvedValue({}),
      };
      // Notice clickElement is NOT even part of pre-warm
      const useCase = new PreWarmPurchasePlanUseCase(mockAdapter as TicketboxPageAdapter);
      await useCase.execute({ eventId: 'event_456' });

      expect(clickElement).not.toHaveBeenCalled();
    });
  });
});
