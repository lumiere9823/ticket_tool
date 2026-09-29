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
 * Advances initialization state machine to READY through canonical auth and event check.
 */
async function advanceToReady(): Promise<void> {
  if (stateMachine.state === PurchaseState.INIT) {
    stateMachine.transition({ type: 'EXTENSION_READY' });
  }
  if (stateMachine.state === PurchaseState.AUTH_CHECK) {
    stateMachine.transition({ type: 'AUTHENTICATED' });
  }
  if (stateMachine.state === PurchaseState.EVENT_CHECK) {
    stateMachine.transition({ type: 'EVENT_READY' });
  }
  await storage.saveCurrentState(stateMachine.getContext());
}

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

      // For critical states: RESERVING, HELD, CHECKOUT, PAYMENT (and SELECTING)
      // Do NOT blindly continue after restart. Perform state revalidation before executing any action.
      if (
        lastState.currentState === PurchaseState.SELECTING ||
        lastState.currentState === PurchaseState.RESERVING ||
        lastState.currentState === PurchaseState.HELD ||
        lastState.currentState === PurchaseState.CHECKOUT ||
        lastState.currentState === PurchaseState.PAYMENT
      ) {
        logger.warn(
          'Service worker restarted during critical flow; halting for safety to require state revalidation',
          {
            previousState: lastState.currentState,
          }
        );
        stateMachine.transition({
          type: 'STOP_REQUESTED',
          reason: `Interrupted during critical state '${lastState.currentState}'; state revalidation required before continuing`,
        });
      } else if (
        lastState.currentState === PurchaseState.INIT ||
        lastState.currentState === PurchaseState.AUTH_CHECK ||
        lastState.currentState === PurchaseState.EVENT_CHECK
      ) {
        await advanceToReady();
      } else if (lastState.currentState === PurchaseState.READY) {
        if (stateMachine.state === PurchaseState.INIT) {
          await advanceToReady();
        }
      }
    } else {
      // Normal fresh initialization
      await advanceToReady();
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
      if (
        stateMachine.state === PurchaseState.INIT ||
        stateMachine.state === PurchaseState.AUTH_CHECK ||
        stateMachine.state === PurchaseState.EVENT_CHECK
      ) {
        await advanceToReady();
      }

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

    case 'ARM_REQUESTED': {
      try {
        if (
          stateMachine.state === PurchaseState.FAILED ||
          stateMachine.state === PurchaseState.STOPPED ||
          stateMachine.state === PurchaseState.CONFIRMED ||
          stateMachine.state === PurchaseState.SOLD_OUT ||
          stateMachine.state === PurchaseState.INVALID_SELECTION ||
          stateMachine.state === PurchaseState.RESERVATION_FAILED
        ) {
          stateMachine.transition({ type: 'RESET_REQUESTED' });
        }

        if (
          stateMachine.state === PurchaseState.INIT ||
          stateMachine.state === PurchaseState.AUTH_CHECK ||
          stateMachine.state === PurchaseState.EVENT_CHECK
        ) {
          await advanceToReady();
        }

        if (
          stateMachine.state === PurchaseState.READY ||
          stateMachine.state === PurchaseState.IDLE
        ) {
          logger.info('Arming assistant upon user request', { eventUrl: message.eventUrl });
          await armUseCase.execute({
            eventUrl: message.eventUrl,
            categoryPriority: message.categoryPriority,
            quantity: message.quantity,
            allowFallback: message.allowFallback ?? true,
          });

          // Immediately start monitoring the target event
          logger.info('Starting monitoring for armed event', { eventUrl: message.eventUrl });
          await startMonitoringUseCase.execute(message.eventUrl);
        } else {
          logger.warn('Cannot arm assistant from current state', { state: stateMachine.state });
        }
      } catch (err) {
        logger.error('Failed to arm and start monitoring', err);
      }
      break;
    }

    case 'START_MONITORING': {
      if (stateMachine.state === PurchaseState.READY || stateMachine.state === PurchaseState.IDLE) {
        stateMachine.transition({ type: 'ARM' });
      }
      if (stateMachine.state === PurchaseState.ARMED) {
        await startMonitoringUseCase.execute(message.eventUrl);
      }
      break;
    }

    case 'NOTIFICATION_EVENT': {
      logger.info('Notification Event dispatched', {
        category: message.category,
        title: message.title,
        body: message.body,
        ticket: message.ticketName,
        quantity: message.quantity,
      });

      if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.create) {
        const profileContext = message.profileContext || 'Default Profile';
        const formattedBody = [
          `Profile: ${profileContext}`,
          message.eventTitle ? `Event: ${message.eventTitle}` : undefined,
          message.showing ? `Showing: ${message.showing}` : undefined,
          message.ticketName ? `Ticket: ${message.ticketName}` : undefined,
          message.quantity ? `Quantity: ${message.quantity}` : undefined,
          message.body,
        ]
          .filter(Boolean)
          .join('\n');

        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon48.png',
          title: message.title,
          message: formattedBody,
          priority: 2,
        });
      }
      break;
    }

    case 'USER_COMPLETED_INTERVENTION': {
      logger.info(
        'User completed intervention; transitioning to STATE_RECHECK for state revalidation'
      );
      stateMachine.transition({ type: 'USER_COMPLETED_CHALLENGE' });
      break;
    }

    case 'FETCH_SEATMAP_REQUEST': {
      try {
        const url = `https://api-v2.ticketbox.vn/event/api/v1/events/showings/${message.showingId}/seatmap`;
        logger.info('Fetching seatmap from background worker', {
          showingId: message.showingId,
          url,
        });
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const json = await res.json();
        await eventBus.publish({
          type: 'FETCH_SEATMAP_RESPONSE',
          timestamp: new Date().toISOString(),
          showingId: message.showingId,
          success: true,
          data: json,
        });
      } catch (err: unknown) {
        logger.error('Failed to fetch seatmap in background worker', err);
        await eventBus.publish({
          type: 'FETCH_SEATMAP_RESPONSE',
          timestamp: new Date().toISOString(),
          showingId: message.showingId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
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
