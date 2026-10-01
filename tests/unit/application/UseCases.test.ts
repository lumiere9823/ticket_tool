import { describe, it, expect, beforeEach } from 'vitest';
import { PurchaseStateMachine, PurchaseState } from '../../../src/domain';
import { ArmAssistantUseCase } from '../../../src/application/use-cases/ArmAssistantUseCase';
import { StartMonitoringUseCase } from '../../../src/application/use-cases/StartMonitoringUseCase';
import { StopAssistantUseCase } from '../../../src/application/use-cases/StopAssistantUseCase';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';

describe('Application Layer Use Cases', () => {
  let stateMachine: PurchaseStateMachine;
  let storage: ChromeStorageRepository;
  let eventBus: ChromeMessageBus;
  let logger: SanitizedLogger;

  beforeEach(() => {
    stateMachine = new PurchaseStateMachine(PurchaseState.READY);
    storage = new ChromeStorageRepository();
    eventBus = new ChromeMessageBus();
    logger = new SanitizedLogger();
  });

  it('ArmAssistantUseCase should configure preferences and transition READY -> ARMED', async () => {
    const useCase = new ArmAssistantUseCase(stateMachine, storage, eventBus, logger);

    const context = await useCase.execute({
      eventUrl: 'https://ticketbox.vn/event/sample-concert-1234',
      categoryPriority: ['VIP', 'CAT 1'],
      quantity: 2,
      allowFallback: true,
    });

    expect(context.currentState).toBe(PurchaseState.ARMED);
    const savedConfig = await storage.getConfiguration();
    expect(savedConfig?.targetEventUrl).toBe('https://ticketbox.vn/event/sample-concert-1234');
    expect(savedConfig?.preferences?.categoryPriority).toEqual(['VIP', 'CAT 1']);
  });

  it('StartMonitoringUseCase should assign attemptId and transition ARMED -> MONITORING', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.ARMED);
    const useCase = new StartMonitoringUseCase(stateMachine, storage, eventBus, logger);

    const context = await useCase.execute('https://ticketbox.vn/event/sample-concert-1234');

    expect(context.currentState).toBe(PurchaseState.MONITORING);
    expect(context.attemptId).toBeDefined();
    expect(context.attemptId).toMatch(/^attempt_/);
  });

  it('StopAssistantUseCase should transition active state to STOPPED and notify', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING, 'attempt_test');
    const useCase = new StopAssistantUseCase(stateMachine, storage, eventBus, logger);

    const context = await useCase.execute('User pressed stop button');
    expect(context.currentState).toBe(PurchaseState.STOPPED);
    expect(stateMachine.state).toBe(PurchaseState.STOPPED);
  });
});
