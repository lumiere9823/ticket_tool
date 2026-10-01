import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState, StateContext } from '../../../src/domain/states/PurchaseState';
import { StateTransitionError } from '../../../src/domain/errors/DomainError';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import {
  handleServiceWorkerMessage,
  getMirroredJourneyContext,
  resetMirroredJourneyContext,
} from '../../../src/extension/background/service-worker';

describe('P1-5: Single Source of Truth for State Machine', () => {
  describe('PurchaseStateMachine.restore(context) Invariant Enforcement', () => {
    it('should reject restoring to CONFIRMED when authoritative payment evidence is missing (Invariant 3 / Rule 06)', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      const invalidConfirmedContext: StateContext = {
        currentState: PurchaseState.CONFIRMED,
        attemptId: 'att-1',
        updatedAt: new Date().toISOString(),
      };

      expect(() => sm.restore(invalidConfirmedContext)).toThrow(StateTransitionError);
      expect(() => sm.restore(invalidConfirmedContext)).toThrow(
        /Cannot restore to CONFIRMED without authoritative confirmation evidence/
      );
    });

    it('should successfully restore to CONFIRMED when authoritative payment evidence (orderId) is present', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      const validConfirmedContext: StateContext = {
        currentState: PurchaseState.CONFIRMED,
        attemptId: 'att-1',
        evidence: {
          orderId: 'TB-ORDER-12345',
        },
        updatedAt: new Date().toISOString(),
      };

      sm.restore(validConfirmedContext);
      expect(sm.state).toBe(PurchaseState.CONFIRMED);
      expect(sm.attemptId).toBe('att-1');
      expect(sm.evidence?.orderId).toBe('TB-ORDER-12345');
    });

    it('should reject restoring to HELD when reservation evidence (reservationId) is missing (Rule 06)', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      const invalidHeldContext: StateContext = {
        currentState: PurchaseState.HELD,
        attemptId: 'att-2',
        updatedAt: new Date().toISOString(),
      };

      expect(() => sm.restore(invalidHeldContext)).toThrow(StateTransitionError);
      expect(() => sm.restore(invalidHeldContext)).toThrow(
        /Cannot restore to HELD without authoritative reservation evidence/
      );
    });

    it('should successfully restore to HELD when reservation evidence (reservationId) is present', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      const validHeldContext: StateContext = {
        currentState: PurchaseState.HELD,
        attemptId: 'att-2',
        evidence: {
          reservationId: 'RES-HOLD-789',
        },
        updatedAt: new Date().toISOString(),
      };

      sm.restore(validHeldContext);
      expect(sm.state).toBe(PurchaseState.HELD);
      expect(sm.evidence?.reservationId).toBe('RES-HOLD-789');
    });

    it('should reject restoring with an invalid or unknown state string', () => {
      const sm = new PurchaseStateMachine(PurchaseState.READY);
      const malformedContext = {
        currentState: 'SOME_NONEXISTENT_STATE' as PurchaseState,
        attemptId: 'att-bad',
        updatedAt: new Date().toISOString(),
      };

      expect(() => sm.restore(malformedContext)).toThrow(StateTransitionError);
    });

    it('should successfully restore to active journey states like PAYMENT_GATE without reverting to MONITORING', () => {
      const sm = new PurchaseStateMachine(PurchaseState.INIT);
      const paymentGateContext: StateContext = {
        currentState: PurchaseState.PAYMENT_GATE,
        attemptId: 'att-pay-99',
        eventId: 'event-101',
        updatedAt: new Date().toISOString(),
      };

      sm.restore(paymentGateContext);
      expect(sm.state).toBe(PurchaseState.PAYMENT_GATE);
      expect(sm.attemptId).toBe('att-pay-99');
      expect(sm.eventId).toBe('event-101');
    });
  });

  describe('Storage Isolation: Separate Journey vs Lifecycle Storage Keys', () => {
    it('should maintain independent storage for journey state and lifecycle state without cross-overwrites', async () => {
      const storage = new ChromeStorageRepository();

      const journeyContext: StateContext = {
        currentState: PurchaseState.PAYMENT_GATE,
        attemptId: 'att-content',
        updatedAt: new Date().toISOString(),
      };

      const lifecycleContext: StateContext = {
        currentState: PurchaseState.ARMED,
        attemptId: 'att-sw',
        updatedAt: new Date().toISOString(),
      };

      await storage.saveJourneyState(journeyContext);
      await storage.saveLifecycleState(lifecycleContext);

      const retrievedJourney = await storage.getJourneyState();
      const retrievedLifecycle = await storage.getLifecycleState();

      expect(retrievedJourney?.currentState).toBe(PurchaseState.PAYMENT_GATE);
      expect(retrievedJourney?.attemptId).toBe('att-content');

      expect(retrievedLifecycle?.currentState).toBe(PurchaseState.ARMED);
      expect(retrievedLifecycle?.attemptId).toBe('att-sw');
    });
  });

  describe('Mid-journey page reload / rehydration safety', () => {
    it('should NOT reset state to MONITORING when restored state is PAYMENT_GATE or HELD', async () => {
      const storage = new ChromeStorageRepository();
      const heldContext: StateContext = {
        currentState: PurchaseState.PAYMENT_GATE,
        attemptId: 'journey-reload-test',
        updatedAt: new Date().toISOString(),
      };
      await storage.saveJourneyState(heldContext);

      // Emulate content script boot check
      const savedJourney = await storage.getJourneyState();
      expect(savedJourney?.currentState).toBe(PurchaseState.PAYMENT_GATE);

      const contentSm = new PurchaseStateMachine(PurchaseState.READY);
      contentSm.restore(savedJourney!);

      // Invariant: The restored machine must stay in PAYMENT_GATE and not be silently forced to MONITORING
      expect(contentSm.state).toBe(PurchaseState.PAYMENT_GATE);
      expect(contentSm.state).not.toBe(PurchaseState.MONITORING);
    });
  });

  describe('Service Worker Mirroring & Extension Badge Reflection', () => {
    let setBadgeTextMock = vi.fn();
    let setBadgeBackgroundColorMock = vi.fn();

    beforeEach(() => {
      setBadgeTextMock = vi.fn();
      setBadgeBackgroundColorMock = vi.fn();
      vi.stubGlobal('chrome', {
        runtime: { id: 'test-extension-id' },
        action: {
          setBadgeText: setBadgeTextMock,
          setBadgeBackgroundColor: setBadgeBackgroundColorMock,
        },
      });
      resetMirroredJourneyContext();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should update extension badge to BUY when receiving STATE_CHANGED with PAYMENT_GATE', async () => {
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.PAYMENT_GATE,
            attemptId: 'att-pay',
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'test-extension-id', frameId: 0 }
      );

      expect(setBadgeTextMock).toHaveBeenCalledWith({ text: 'BUY' });
      expect(setBadgeBackgroundColorMock).toHaveBeenCalledWith({ color: '#ec4899' });
      expect(getMirroredJourneyContext()?.currentState).toBe(PurchaseState.PAYMENT_GATE);
    });

    it('should update extension badge to DONE when receiving STATE_CHANGED with CONFIRMED', async () => {
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.CONFIRMED,
            attemptId: 'att-done',
            evidence: { orderId: 'TB-999' },
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'test-extension-id', frameId: 0 }
      );

      expect(setBadgeTextMock).toHaveBeenCalledWith({ text: 'DONE' });
      expect(setBadgeBackgroundColorMock).toHaveBeenCalledWith({ color: '#10b981' });
      expect(getMirroredJourneyContext()?.currentState).toBe(PurchaseState.CONFIRMED);
    });

    it('should update extension badge to CAPT when receiving STATE_CHANGED with HUMAN_INTERVENTION_REQUIRED', async () => {
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.HUMAN_INTERVENTION_REQUIRED,
            attemptId: 'att-capt',
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'test-extension-id', frameId: 0 }
      );

      expect(setBadgeTextMock).toHaveBeenCalledWith({ text: 'CAPT' });
      expect(setBadgeBackgroundColorMock).toHaveBeenCalledWith({ color: '#ef4444' });
    });

    it('should reject STATE_CHANGED from untrusted sender id and not update badge', async () => {
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.PAYMENT_GATE,
            attemptId: 'att-spoof',
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'malicious-extension-id', frameId: 0 }
      );

      expect(setBadgeTextMock).not.toHaveBeenCalled();
      expect(getMirroredJourneyContext()).toBeNull();
    });

    it('should reject STATE_CHANGED from non-top frame and not update badge', async () => {
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.PAYMENT_GATE,
            attemptId: 'att-iframe',
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'test-extension-id', frameId: 1 }
      );

      expect(setBadgeTextMock).not.toHaveBeenCalled();
      expect(getMirroredJourneyContext()).toBeNull();
    });
  });
});
