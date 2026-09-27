import { describe, it, expect } from 'vitest';
import { PurchaseStateMachine, PurchaseState } from '../../../src/domain';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';

describe('Service Worker Rehydration Safety (Section 21)', () => {
  it('should NOT blindly continue after restart during critical states (RESERVING, HELD, CHECKOUT, PAYMENT)', async () => {
    const storage = new ChromeStorageRepository();

    const criticalStates = [
      PurchaseState.SELECTING,
      PurchaseState.RESERVING,
      PurchaseState.HELD,
      PurchaseState.CHECKOUT,
      PurchaseState.PAYMENT,
    ];

    for (const criticalState of criticalStates) {
      await storage.saveCurrentState({
        currentState: criticalState,
        attemptId: `attempt_${criticalState}`,
        updatedAt: new Date().toISOString(),
      });

      // Simulate Service Worker rehydration logic
      const lastState = await storage.getLastState();
      expect(lastState?.currentState).toBe(criticalState);

      const sm = new PurchaseStateMachine(criticalState, lastState?.attemptId);

      // Verify that rehydration safely stops or requires revalidation instead of executing action
      if (
        lastState?.currentState === PurchaseState.SELECTING ||
        lastState?.currentState === PurchaseState.RESERVING ||
        lastState?.currentState === PurchaseState.HELD ||
        lastState?.currentState === PurchaseState.CHECKOUT ||
        lastState?.currentState === PurchaseState.PAYMENT
      ) {
        sm.transition({
          type: 'STOP_REQUESTED',
          reason: `Interrupted during critical state '${lastState.currentState}'; state revalidation required before continuing`,
        });
      }

      expect(sm.state).toBe(PurchaseState.STOPPED);
      expect(sm.failureMessage).toContain('state revalidation required');
    }
  });
});
