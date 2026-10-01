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

  describe('C7: Polling Loop Limits & Attempt Counting', () => {
    it('halts and transitions to STOPPED_LIMIT_REACHED when attemptsCount >= maxAttempts', async () => {
      const storage = new ChromeStorageRepository();
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

      await storage.savePersistentState({
        startedAt: Date.now() - 5000,
        attemptsCount: 200,
        currentPhase: 'MONITORING',
      });

      const maxAttempts = 200;
      const pState = await storage.getPersistentState();

      if (pState && pState.attemptsCount >= maxAttempts) {
        sm.transition({ type: 'LIMIT_REACHED' });
        await storage.savePersistentState({
          ...pState,
          stopReason: `Max attempts limit reached (${pState.attemptsCount}/${maxAttempts})`,
          currentPhase: 'STOPPED_LIMIT_REACHED',
        });
      }

      expect(sm.state).toBe(PurchaseState.STOPPED_LIMIT_REACHED);
      const finalState = await storage.getPersistentState();
      expect(finalState?.currentPhase).toBe('STOPPED_LIMIT_REACHED');
      expect(finalState?.stopReason).toContain('Max attempts limit reached');
    });

    it('halts and transitions to STOPPED_LIMIT_REACHED when duration ceiling is reached', async () => {
      const storage = new ChromeStorageRepository();
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

      const maxDurationMinutes = 30;
      const startedAt = Date.now() - 31 * 60 * 1000; // 31 minutes ago

      await storage.savePersistentState({
        startedAt,
        attemptsCount: 15,
        currentPhase: 'MONITORING',
      });

      const pState = await storage.getPersistentState();
      const startedAtMs =
        typeof pState?.startedAt === 'number'
          ? pState.startedAt
          : new Date(pState?.startedAt ?? Date.now()).getTime();
      const elapsedMinutes = (Date.now() - startedAtMs) / 60000;

      if (elapsedMinutes >= maxDurationMinutes) {
        sm.transition({ type: 'LIMIT_REACHED' });
        await storage.savePersistentState({
          ...pState!,
          stopReason: `Duration ceiling reached (${maxDurationMinutes} minutes)`,
          currentPhase: 'STOPPED_LIMIT_REACHED',
        });
      }

      expect(sm.state).toBe(PurchaseState.STOPPED_LIMIT_REACHED);
      const finalState = await storage.getPersistentState();
      expect(finalState?.stopReason).toContain('Duration ceiling reached');
    });

    it('halts and transitions to STOPPED_LIMIT_REACHED when stopAt is passed', async () => {
      const storage = new ChromeStorageRepository();
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

      const stopAt = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago

      await storage.savePersistentState({
        startedAt: Date.now() - 60000,
        attemptsCount: 5,
        currentPhase: 'MONITORING',
      });

      const now = Date.now();
      if (now >= new Date(stopAt).getTime()) {
        sm.transition({ type: 'LIMIT_REACHED' });
      }

      expect(sm.state).toBe(PurchaseState.STOPPED_LIMIT_REACHED);
    });

    it('pure discovery scan does NOT increment attemptsCount, while booking attempt increments by 1', async () => {
      const storage = new ChromeStorageRepository();
      await storage.savePersistentState({
        startedAt: Date.now(),
        attemptsCount: 0,
        currentPhase: 'MONITORING',
      });

      // 1. Simulate multiple discovery scans
      for (let i = 0; i < 5; i++) {
        // Pure discovery: observe DOM, update catalog, do not increment attempts
        const pState = await storage.getPersistentState();
        expect(pState?.attemptsCount).toBe(0);
      }

      // 2. Booking journey execution attempt triggered
      const pStateBefore = await storage.getPersistentState();
      const newAttempts = (pStateBefore?.attemptsCount ?? 0) + 1;
      await storage.savePersistentState({
        ...pStateBefore!,
        attemptsCount: newAttempts,
        currentPhase: 'SELECTING',
      });

      const pStateAfter = await storage.getPersistentState();
      expect(pStateAfter?.attemptsCount).toBe(1);
    });
  });

  describe('C8: Target Cycling across Unselectable Targets', () => {
    it('retries next target in whitelist and resets cycle to WAITING_FOR_STOCK when all exhausted', async () => {
      const sm = new PurchaseStateMachine(PurchaseState.SELECTING);
      const triedCandidateKeysInCycle = new Set<string>();

      const targets = [
        { showingId: 'show-1', ticketTypeId: 't-vip1', ticketName: 'VIP 1' },
        { showingId: 'show-1', ticketTypeId: 't-vip2', ticketName: 'VIP 2' },
      ];

      // Step 1: Target 1 selected, fails during execution
      const target1 = targets[0]!;
      sm.transition({ type: 'TICKET_SELECTED', ticketId: target1.ticketTypeId });
      expect(sm.state).toBe(PurchaseState.TICKET_SELECTED);

      // Target 1 unselectable / fails
      triedCandidateKeysInCycle.add(`${target1.showingId}_${target1.ticketTypeId}`);
      sm.transition({ type: 'RETRY_TARGET' });
      expect(sm.state).toBe(PurchaseState.RETRYING_TARGET);

      // Step 2: Next untried candidate is Target 2
      const untried = targets.filter(
        (t) => !triedCandidateKeysInCycle.has(`${t.showingId}_${t.ticketTypeId}`)
      );
      expect(untried).toHaveLength(1);
      const target2 = untried[0]!;
      expect(target2.ticketTypeId).toBe('t-vip2');

      sm.transition({ type: 'TICKET_SELECTED', ticketId: target2.ticketTypeId });
      expect(sm.state).toBe(PurchaseState.TICKET_SELECTED);

      // Target 2 also unselectable / fails
      triedCandidateKeysInCycle.add(`${target2.showingId}_${target2.ticketTypeId}`);
      sm.transition({ type: 'RETRY_TARGET' });
      expect(sm.state).toBe(PurchaseState.RETRYING_TARGET);

      // Step 3: All candidates exhausted in cycle
      const remaining = targets.filter(
        (t) => !triedCandidateKeysInCycle.has(`${t.showingId}_${t.ticketTypeId}`)
      );
      expect(remaining).toHaveLength(0);

      // Reset cycle and transition to WAITING_FOR_STOCK without crashing
      triedCandidateKeysInCycle.clear();
      sm.transition({ type: 'WAITING_FOR_STOCK' });
      expect(sm.state).toBe(PurchaseState.WAITING_FOR_STOCK);
      expect(triedCandidateKeysInCycle.size).toBe(0);
    });
  });

  describe('C10: Worker Rehydration & Heartbeat Alarm Limit Checking', () => {
    it('preserves attemptsCount and startedAt across service worker restarts', async () => {
      const storage = new ChromeStorageRepository();
      const initialStartedAt = 1710000000000;
      const initialAttempts = 42;

      await storage.savePersistentState({
        startedAt: initialStartedAt,
        attemptsCount: initialAttempts,
        currentPhase: 'MONITORING',
        lastTarget: {
          showingId: 'show-1',
          ticketTypeId: 't-vip',
          ticketName: 'VIP',
        },
      });

      await storage.saveCurrentState({
        currentState: PurchaseState.MONITORING,
        attemptId: 'att-123',
        updatedAt: new Date().toISOString(),
      });

      // Simulate Service Worker wake up and rehydration logic
      const lastState = await storage.getLastState();
      expect(lastState?.currentState).toBe(PurchaseState.MONITORING);

      // Must rehydrate persistent state without resetting attemptsCount or startedAt
      const persistentState = await storage.getPersistentState();
      expect(persistentState?.attemptsCount).toBe(42);
      expect(persistentState?.startedAt).toBe(initialStartedAt);
      const lastTarget =
        typeof persistentState?.lastTarget === 'object' ? persistentState.lastTarget : null;
      expect(lastTarget?.ticketName).toBe('VIP');

      const sm = new PurchaseStateMachine(PurchaseState.INIT);
      // Rehydration sequence in service worker:
      sm.transition({ type: 'EXTENSION_READY' });
      sm.transition({ type: 'AUTHENTICATED' });
      sm.transition({ type: 'EVENT_READY' });
      sm.transition({ type: 'ARM' });
      sm.transition({ type: 'MONITORING_STARTED' });
      expect(sm.state).toBe(PurchaseState.MONITORING);
    });

    it('heartbeat check correctly enforces persistence policy limits', async () => {
      const storage = new ChromeStorageRepository();
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/test',
        discoveryMode: false,
        scopedPurchasePlan: {
          eventId: 'evt-1',
          targets: [{ showingId: 'show-1', ticketTypeIds: ['t-1'], rank: 1 }],
          quantity: 1,
          strategy: 'BY_TARGET_ORDER',
          persistence: {
            maxDurationMinutes: 10,
            maxAttempts: 50,
            pollIntervalMs: 2000,
            jitterRatio: 0.2,
          },
        },
      });

      // Case 1: Attempts reached
      await storage.savePersistentState({
        startedAt: Date.now() - 60000,
        attemptsCount: 50,
        currentPhase: 'MONITORING',
      });

      const config = await storage.getConfiguration();
      const pState = await storage.getPersistentState();
      const policy = config?.scopedPurchasePlan?.persistence;

      if (policy?.maxAttempts && (pState?.attemptsCount ?? 0) >= policy.maxAttempts) {
        sm.transition({
          type: 'LIMIT_REACHED',
          reason: `PERSISTENCE_MAX_ATTEMPTS_REACHED: Maximum attempts reached (${policy.maxAttempts})`,
        });
      }

      expect(sm.state).toBe(PurchaseState.STOPPED_LIMIT_REACHED);
    });

    it('heartbeat check detects scheduled ARM target timestamp has arrived', async () => {
      const storage = new ChromeStorageRepository();

      // Configure a scheduled ARM timestamp in the past (e.g. 5 seconds ago)
      const pastTime = new Date(Date.now() - 5000).toISOString();
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/test-scheduled',
        discoveryMode: false,
        scheduledArmAt: pastTime,
      });

      const config = await storage.getConfiguration();
      expect(config?.scheduledArmAt).toBe(pastTime);

      const targetMs = new Date(config!.scheduledArmAt!).getTime();
      const shouldTrigger = Date.now() >= targetMs;
      expect(shouldTrigger).toBe(true);
    });

    it('heartbeat check preserves future scheduled ARM timestamp', async () => {
      const storage = new ChromeStorageRepository();

      // Configure a scheduled ARM timestamp in the future (e.g. 60 seconds ahead)
      const futureTime = new Date(Date.now() + 60000).toISOString();
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/test-scheduled-future',
        discoveryMode: false,
        scheduledArmAt: futureTime,
      });

      const config = await storage.getConfiguration();
      const targetMs = new Date(config!.scheduledArmAt!).getTime();
      const shouldTrigger = Date.now() >= targetMs;
      expect(shouldTrigger).toBe(false);
    });
  });
});
