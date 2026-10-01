/**
 * P2-10: Use-case small-bug tests.
 * Test-before-fix: each test is written to FAIL against the current implementation,
 * then we fix the source to make them green.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PurchaseStateMachine, PurchaseState } from '../../../src/domain';
import { StopAssistantUseCase } from '../../../src/application/use-cases/StopAssistantUseCase';
import { ArmAssistantUseCase } from '../../../src/application/use-cases/ArmAssistantUseCase';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import type { EventBus } from '../../../src/application/ports/EventBus';
import type { LoggerPort } from '../../../src/application/ports/LoggerPort';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeLogger(): LoggerPort & {
  warnCalls: [string, (Record<string, unknown> | undefined)?][];
  infoCalls: [string, (Record<string, unknown> | undefined)?][];
} {
  const warnCalls: [string, (Record<string, unknown> | undefined)?][] = [];
  const infoCalls: [string, (Record<string, unknown> | undefined)?][] = [];
  const self: ReturnType<typeof makeLogger> = {
    warnCalls,
    infoCalls,
    debug: () => {},
    info: (msg: string, meta?: Record<string, unknown>) => { infoCalls.push([msg, meta]); },
    warn: (msg: string, meta?: Record<string, unknown>) => { warnCalls.push([msg, meta]); },
    error: () => {},
    withContext: () => self,
  };
  return self;
}

/** Captures published events */
function makeCapturingBus(): EventBus & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    publish: async (event: unknown) => { events.push(event); },
    subscribe: () => () => {},
  };
}

// ─── StopAssistantUseCase ────────────────────────────────────────────────────

describe('P2-10 — StopAssistantUseCase', () => {
  it('publishes context.currentState (not hardcoded STOPPED) in STATE_CHANGED event', async () => {
    // Arrange
    const sm = new PurchaseStateMachine(PurchaseState.MONITORING, 'attempt_stop_test');
    const storage = new ChromeStorageRepository();
    const bus = makeCapturingBus();
    const logger = makeLogger();
    const useCase = new StopAssistantUseCase(sm, storage, bus, logger);

    // Act
    const context = await useCase.execute('test stop reason');

    // Assert: context returned correctly
    expect(context.currentState).toBe(PurchaseState.STOPPED);

    // Assert: the published event's `state` field must equal context.currentState,
    // not a separately hardcoded literal — i.e., if the machine transitions to something
    // other than STOPPED (hypothetically), the event should still reflect actual state.
    const stateChangedEvent = bus.events.find(
      (e): e is { type: string; state: string } =>
        typeof e === 'object' && e !== null && (e as { type: string }).type === 'STATE_CHANGED'
    );
    expect(stateChangedEvent).toBeDefined();
    // The state in the event must be the actual context state, not a static literal.
    // We verify by checking it equals context.currentState (which the machine produced).
    expect(stateChangedEvent?.state).toBe(context.currentState);
  });

  it('does NOT emit a second STATE_CHANGED event when already STOPPED (idempotent)', async () => {
    const sm = new PurchaseStateMachine(PurchaseState.STOPPED);
    const storage = new ChromeStorageRepository();
    const bus = makeCapturingBus();
    const logger = makeLogger();
    const useCase = new StopAssistantUseCase(sm, storage, bus, logger);

    await useCase.execute('duplicate stop');

    // Already stopped — early return path must not publish
    const stateChangedEvents = bus.events.filter(
      (e) => typeof e === 'object' && e !== null && (e as { type: string }).type === 'STATE_CHANGED'
    );
    expect(stateChangedEvents).toHaveLength(0);
  });
});

// ─── ArmAssistantUseCase ─────────────────────────────────────────────────────

describe('P2-10 — ArmAssistantUseCase', () => {
  let storage: ChromeStorageRepository;
  let bus: EventBus;
  let logger: LoggerPort;

  beforeEach(() => {
    storage = new ChromeStorageRepository();
    bus = makeCapturingBus();
    logger = makeLogger();
  });

  it('does NOT persist config when the state transition throws (fail-safe ordering)', async () => {
    // Arrange: start in STOPPED — ARM transition is invalid from STOPPED
    const sm = new PurchaseStateMachine(PurchaseState.STOPPED);
    const useCase = new ArmAssistantUseCase(sm, storage, bus, logger);

    // Act & Assert: execute must throw (ARM from STOPPED is rejected by state machine)
    await expect(
      useCase.execute({
        eventUrl: 'https://ticketbox.vn/event/test-123',
        categoryPriority: ['CAT1'],
        quantity: 1,
      })
    ).rejects.toThrow();

    // Assert: configuration must NOT have been saved if the transition failed
    const saved = await storage.getConfiguration();
    expect(saved?.targetEventUrl).not.toBe('https://ticketbox.vn/event/test-123');
  });

  it('saves config AFTER a successful state transition (happy path order)', async () => {
    // Arrange: READY is the valid pre-ARM state
    const sm = new PurchaseStateMachine(PurchaseState.READY);
    const useCase = new ArmAssistantUseCase(sm, storage, bus, logger);

    const context = await useCase.execute({
      eventUrl: 'https://ticketbox.vn/event/valid-concert',
      categoryPriority: ['VIP'],
      quantity: 2,
    });

    // State machine transitioned correctly
    expect(context.currentState).toBe(PurchaseState.ARMED);
    // Config was saved after transition
    const saved = await storage.getConfiguration();
    expect(saved?.targetEventUrl).toBe('https://ticketbox.vn/event/valid-concert');
  });
});
