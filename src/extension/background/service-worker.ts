import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { PurchaseState, StateContext } from '../../domain/states/PurchaseState';
import { ChromeStorageRepository } from '../../infrastructure/storage/ChromeStorageRepository';
import { ChromeMessageBus } from '../../infrastructure/messaging/ChromeMessageBus';
import { SanitizedLogger } from '../../infrastructure/logging/SanitizedLogger';
import { ArmAssistantUseCase } from '../../application/use-cases/ArmAssistantUseCase';
import { StartMonitoringUseCase } from '../../application/use-cases/StartMonitoringUseCase';
import { StopAssistantUseCase } from '../../application/use-cases/StopAssistantUseCase';
import { ExtensionMessage } from '../shared/messages';

const logger = new SanitizedLogger({ state: 'SERVICE_WORKER' });
const storage = new ChromeStorageRepository();
const eventBus = new ChromeMessageBus(logger);
const stateMachine = new PurchaseStateMachine(PurchaseState.INIT);

const armUseCase = new ArmAssistantUseCase(stateMachine, storage, eventBus, logger);
const startMonitoringUseCase = new StartMonitoringUseCase(stateMachine, storage, eventBus, logger);
const stopUseCase = new StopAssistantUseCase(stateMachine, storage, eventBus, logger);

/**
 * Rehydrates state machine from persistent storage on service worker wake-up (MV3 lifecycle).
 */
async function initializeWorker(): Promise<void> {
  logger.info('Service Worker initializing');

  try {
    const lastState = await storage.getLastState();
    if (lastState && lastState.currentState) {
      logger.info('Rehydrating last known state', {
        state: lastState.currentState,
        attemptId: lastState.attemptId,
      });

      // If previous state was active in the middle of a purchase when killed, fail safely to STOPPED
      if (
        lastState.currentState === PurchaseState.SELECTING ||
        lastState.currentState === PurchaseState.RESERVING
      ) {
        logger.warn('Interrupted during critical action; recovering to safe STOPPED state');
        stateMachine.transition({
          type: 'STOP_REQUESTED',
          reason: 'Recovered from interrupted service worker lifecycle',
        });
      }
    } else {
      // Normal fresh initialization
      stateMachine.transition({ type: 'EXTENSION_READY' });
      await storage.saveCurrentState(stateMachine.getContext());
    }
  } catch (err) {
    logger.error('Error during service worker initialization', err);
  }
}

// Subscribe to messages from popup or content script
eventBus.subscribe(async (message: ExtensionMessage) => {
  logger.debug('Received extension message in Service Worker', { type: message.type });

  switch (message.type) {
    case 'SYNC_STATE_REQUEST': {
      await eventBus.publish({
        type: 'SYNC_STATE_RESPONSE',
        timestamp: new Date().toISOString(),
        attemptId: stateMachine.attemptId,
        state: stateMachine.state,
        context: stateMachine.getContext(),
      });
      break;
    }

    case 'STOP_REQUESTED': {
      await stopUseCase.execute(message.reason);
      break;
    }

    case 'START_MONITORING': {
      if (stateMachine.state === PurchaseState.ARMED) {
        await startMonitoringUseCase.execute(message.eventUrl);
      }
      break;
    }

    default:
      break;
  }
});

// Sync state machine transitions back to storage
stateMachine.subscribe(async (context: StateContext) => {
  await storage.saveCurrentState(context);
});

// Run initialization
initializeWorker();

export { stateMachine, storage, eventBus, armUseCase, stopUseCase };
