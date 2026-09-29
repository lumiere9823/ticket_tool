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

const failedSeatmapShowings = new Map<string, number>();

async function updateExtensionBadge(state?: string, scheduled?: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  try {
    if (scheduled) {
      await chrome.action.setBadgeText({ text: '⏰' });
      await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      return;
    }
    switch (state) {
      case PurchaseState.ARMED:
      case 'ARMED':
        await chrome.action.setBadgeText({ text: 'ARM' });
        await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        break;
      case PurchaseState.MONITORING:
      case 'MONITORING':
        await chrome.action.setBadgeText({ text: 'RUN' });
        await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        break;
      case PurchaseState.WAITING_FOR_STOCK:
      case 'WAITING_FOR_STOCK':
        await chrome.action.setBadgeText({ text: 'WAIT' });
        await chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
        break;
      case PurchaseState.SELECTING:
      case PurchaseState.RESERVING:
      case PurchaseState.CHECKOUT:
      case PurchaseState.PAYMENT_GATE:
        await chrome.action.setBadgeText({ text: 'BUY' });
        await chrome.action.setBadgeBackgroundColor({ color: '#ec4899' });
        break;
      case PurchaseState.HUMAN_INTERVENTION_REQUIRED:
        await chrome.action.setBadgeText({ text: 'CAPT' });
        await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
        break;
      case PurchaseState.CONFIRMED:
        await chrome.action.setBadgeText({ text: 'DONE' });
        await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        break;
      case PurchaseState.STOPPED:
      case PurchaseState.STOPPED_LIMIT_REACHED:
      case PurchaseState.STOPPED_NO_TARGET:
      case PurchaseState.FAILED:
      case PurchaseState.IDLE:
      case PurchaseState.INIT:
      default:
        await chrome.action.setBadgeText({ text: '' });
        break;
    }
  } catch (err) {
    logger.debug('Failed to update extension badge', { err: String(err) });
  }
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
        lastState.currentState === PurchaseState.WAITING_FOR_STOCK ||
        lastState.currentState === PurchaseState.RETRYING_TARGET ||
        lastState.currentState === PurchaseState.MONITORING ||
        lastState.currentState === PurchaseState.ARMED
      ) {
        // Rehydrate monitoring state without resetting attempts count
        const persistentState = await storage.getPersistentState();
        logger.info('Rehydrated persistent monitoring state without resetting attempts', {
          state: lastState.currentState,
          attemptsCount: persistentState?.attemptsCount ?? 0,
        });
        if (stateMachine.state === PurchaseState.INIT) {
          await advanceToReady();
          stateMachine.transition({ type: 'ARM' });
          stateMachine.transition({ type: 'MONITORING_STARTED' });
          if (lastState.currentState === PurchaseState.WAITING_FOR_STOCK) {
            stateMachine.transition({ type: 'WAITING_FOR_STOCK' });
          } else if (lastState.currentState === PurchaseState.RETRYING_TARGET) {
            stateMachine.transition({ type: 'RETRY_TARGET' });
          }
        }
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

    const persistentState = await storage.getPersistentState();
    const config = await storage.getConfiguration();
    const isScheduled = persistentState?.currentPhase === 'SCHEDULED' && !!config?.scheduledArmAt;
    await updateExtensionBadge(stateMachine.state, isScheduled);
  } catch (err) {
    logger.error('Error during service worker initialization', err);
  }

  setupHeartbeatAlarm();
}

/**
 * Periodically checks persistent limits (maxDurationMinutes, stopAt, maxAttempts)
 * across service worker lifecycles via chrome.alarms.
 */
function setupHeartbeatAlarm(): void {
  if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create('PERSISTENT_PURCHASE_HEARTBEAT', {
      periodInMinutes: 0.5,
    });
  }
}

async function checkHeartbeatLimits(): Promise<void> {
  try {
    // Only check heartbeat limits when assistant is actively armed, monitoring, or waiting
    const activeStates = new Set<PurchaseState>([
      PurchaseState.ARMED,
      PurchaseState.MONITORING,
      PurchaseState.WAITING,
      PurchaseState.WAITING_FOR_STOCK,
      PurchaseState.RETRYING_TARGET,
      PurchaseState.EVALUATING_TICKETS,
      PurchaseState.SELECTING,
      PurchaseState.RESERVING,
    ]);
    if (!activeStates.has(stateMachine.state)) {
      return;
    }

    const config = await storage.getConfiguration();
    const persistentState = await storage.getPersistentState();
    if (!config?.scopedPurchasePlan || !persistentState || !persistentState.startedAt) {
      return;
    }

    const plan = config.scopedPurchasePlan;
    const policy = plan.persistence;
    if (!policy) return;

    const startedAtMs = new Date(persistentState.startedAt).getTime();
    const elapsedMinutes = (Date.now() - startedAtMs) / 60000;

    // Check duration ceiling (0 or undefined = unlimited / no limit)
    if (policy.maxDurationMinutes && policy.maxDurationMinutes > 0 && elapsedMinutes >= policy.maxDurationMinutes) {
      const reason = `PERSISTENCE_LIMIT_EXCEEDED: Maximum duration reached (${policy.maxDurationMinutes}m)`;
      logger.warn(reason);
      if (stateMachine.state !== PurchaseState.STOPPED_LIMIT_REACHED) {
        stateMachine.transition({ type: 'LIMIT_REACHED', reason });
      }
      await storage.savePersistentState({
        ...persistentState,
        currentPhase: 'STOPPED_LIMIT_REACHED',
        stopReason: reason,
      });
      return;
    }

    // Check stopAt ISO timestamp
    if (policy.stopAt && Date.now() >= new Date(policy.stopAt).getTime()) {
      const reason = `PERSISTENCE_STOP_AT_REACHED: Configured stop time reached (${policy.stopAt})`;
      logger.warn(reason);
      if (stateMachine.state !== PurchaseState.STOPPED_LIMIT_REACHED) {
        stateMachine.transition({ type: 'LIMIT_REACHED', reason });
      }
      await storage.savePersistentState({
        ...persistentState,
        currentPhase: 'STOPPED_LIMIT_REACHED',
        stopReason: reason,
      });
      return;
    }

    // Check max attempts limit (0 or undefined = unlimited / no limit)
    if (policy.maxAttempts && policy.maxAttempts > 0 && persistentState.attemptsCount >= policy.maxAttempts) {
      const reason = `PERSISTENCE_MAX_ATTEMPTS_REACHED: Maximum attempts reached (${policy.maxAttempts})`;
      logger.warn(reason);
      if (stateMachine.state !== PurchaseState.STOPPED_LIMIT_REACHED) {
        stateMachine.transition({ type: 'LIMIT_REACHED', reason });
      }
      await storage.savePersistentState({
        ...persistentState,
        currentPhase: 'STOPPED_LIMIT_REACHED',
        stopReason: reason,
      });
      return;
    }
  } catch (err) {
    logger.error('Error during heartbeat limit check', err);
  }
}


let isScheduledArmExecuting = false;

async function executeScheduledArm(): Promise<void> {
  if (isScheduledArmExecuting) {
    logger.debug('executeScheduledArm already running; skipping duplicate execution');
    return;
  }
  isScheduledArmExecuting = true;

  try {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('SCHEDULED_ARM');
      chrome.alarms.clear('SCHEDULED_ARM_PREWAKE');
    }

    const config = await storage.getConfiguration();
    if (!config) {
      logger.warn('SCHEDULED_ARM fired but no config found; skipping');
      return;
    }

    logger.info('SCHEDULED_ARM executing — arming assistant automatically', {
      eventUrl: config.targetEventUrl,
      scheduledAt: config.scheduledArmAt,
    });

    // Clear scheduledArmAt so it does not remain pending
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scheduledArmAt: _clearedSchedule, ...activeConfig } = config;
    await storage.saveConfiguration(activeConfig as typeof config);

    // Advance state machine to READY if needed
    await advanceToReady();

    if (
      stateMachine.state === PurchaseState.READY ||
      stateMachine.state === PurchaseState.IDLE
    ) {
      await armUseCase.execute({
        eventUrl: config.targetEventUrl,
        categoryPriority: config.preferences?.categoryPriority ?? [],
        quantity: config.preferences?.quantity ?? 1,
        allowFallback: config.preferences?.allowFallback ?? true,
        userProfile: config.userProfile,
        scopedPurchasePlan: config.scopedPurchasePlan,
      });

      await storage.savePersistentState({
        startedAt: new Date().toISOString(),
        attemptsCount: 0,
        currentPhase: 'ARMED',
      });

      await startMonitoringUseCase.execute(config.targetEventUrl);
    } else {
      logger.warn('SCHEDULED_ARM fired but state machine not in READY/IDLE; skipping', {
        state: stateMachine.state,
      });
    }

    // Bring Ticketbox tab to foreground to avoid browser background timer throttling
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ url: '*://*.ticketbox.vn/*' }, (tabs) => {
        const targetTab = tabs?.[0];
        if (targetTab && targetTab.id) {
          chrome.tabs.update(targetTab.id, { active: true });
          if (targetTab.windowId) {
            chrome.windows.update(targetTab.windowId, { focused: true });
          }
          chrome.tabs.sendMessage(targetTab.id, {
            type: 'START_MONITORING',
            timestamp: new Date().toISOString(),
            targetEventUrl: config.targetEventUrl,
          }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
          chrome.tabs.sendMessage(targetTab.id, {
            type: 'REQUEST_DISCOVERY_SCAN',
            timestamp: new Date().toISOString(),
          }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        } else if (config.targetEventUrl) {
          chrome.tabs.create({ url: config.targetEventUrl, active: true });
        }
      });
    }

    // Push desktop notification
    if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: '🔔 Ticketbox Assistant — ĐÃ ĐẾN GIỜ MỞ BÁN!',
        message: `Đã tự động ARM và bắt đầu săn vé cho sự kiện:\n${config.targetEventUrl}`,
        priority: 2,
      });
    }
  } catch (err) {
    logger.error('Error during scheduled ARM execution', err);
  } finally {
    isScheduledArmExecuting = false;
  }
}

if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'PERSISTENT_PURCHASE_HEARTBEAT') {
      checkHeartbeatLimits();
    }

    if (alarm.name === 'SCHEDULED_ARM_PREWAKE') {
      logger.info('SCHEDULED_ARM_PREWAKE alarm fired, preparing exact timer');
      const config = await storage.getConfiguration();
      const startAt = config?.scheduledArmAt || config?.scopedPurchasePlan?.persistence?.startAt;
      if (startAt) {
        const targetMs = new Date(startAt).getTime();
        const remainingMs = Math.max(0, targetMs - Date.now());
        logger.info(`Pre-wake timer activated. Exact setTimeout armed for remaining ${remainingMs}ms`);
        setTimeout(async () => {
          logger.info('Pre-wake exact timer fired at target timestamp');
          await executeScheduledArm();
        }, remainingMs);
      }
    }

    if (alarm.name === 'SCHEDULED_ARM') {
      await executeScheduledArm();
    }
  });
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
      if (
        stateMachine.state === PurchaseState.STOPPED ||
        stateMachine.state === PurchaseState.STOPPED_LIMIT_REACHED ||
        stateMachine.state === PurchaseState.STOPPED_NO_TARGET
      ) {
        break;
      }
      const pState = await storage.getPersistentState();
      if (pState) {
        await storage.savePersistentState({
          ...pState,
          currentPhase: 'STOPPED',
          stopReason: message.reason || 'User requested stop',
        });
      }
      await stopUseCase.execute(message.reason);
      break;
    }

    case 'ARM_REQUESTED': {
      try {
        // ── Scheduled ARM: if startAt is in the future, defer via chrome.alarm ──
        const startAt = message.scopedPurchasePlan?.persistence?.startAt;
        if (startAt) {
          const startMs = new Date(startAt).getTime();
          const nowMs = Date.now();
          if (startMs > nowMs) {
            logger.info('ARM deferred — scheduling alarm for future startAt', { startAt, delayMs: startMs - nowMs });

            // Save full config so alarm handler can read it later
            const existingConfig = await storage.getConfiguration();
            await storage.saveConfiguration({
              targetEventUrl: message.eventUrl,
              discoveryMode: false,
              preferences: {
                categoryPriority: message.categoryPriority,
                quantity: message.quantity,
                allowFallback: message.allowFallback ?? true,
              },
              ...(existingConfig?.purchasePlan ? { purchasePlan: existingConfig.purchasePlan } : {}),
              ...(message.scopedPurchasePlan
                ? { scopedPurchasePlan: message.scopedPurchasePlan }
                : existingConfig?.scopedPurchasePlan
                  ? { scopedPurchasePlan: existingConfig.scopedPurchasePlan }
                  : {}),
              ...(message.userProfile
                ? { userProfile: message.userProfile }
                : existingConfig?.userProfile
                  ? { userProfile: existingConfig.userProfile }
                  : {}),
              ...(existingConfig?.ticketCatalogSnapshot
                ? { ticketCatalogSnapshot: existingConfig.ticketCatalogSnapshot }
                : {}),
              scheduledArmAt: startAt,
            });

            const delayMs = startMs - nowMs;
            if (typeof chrome !== 'undefined' && chrome.alarms) {
              chrome.alarms.clear('SCHEDULED_ARM');
              chrome.alarms.clear('SCHEDULED_ARM_PREWAKE');
              chrome.alarms.create('SCHEDULED_ARM', { when: startMs });
              // If delay is more than 30 seconds, create a pre-wake alarm 25 seconds before start
              if (delayMs > 30_000) {
                chrome.alarms.create('SCHEDULED_ARM_PREWAKE', { when: startMs - 25_000 });
              }
            }

            // Fallback timer for delays up to 5 minutes (300,000 ms) where active setTimeout provides sub-second accuracy
            if (delayMs <= 300_000) {
              setTimeout(async () => {
                logger.info('Short-delay scheduled ARM timer fired');
                await executeScheduledArm();
              }, delayMs);
            }

            await storage.savePersistentState({
              currentPhase: 'SCHEDULED',
              attemptsCount: 0,
              stopReason: undefined,
            });

            await eventBus.publish({
              type: 'SCHEDULED_ARM_CONFIRMED',
              timestamp: new Date().toISOString(),
              scheduledAt: startAt,
            });

            await updateExtensionBadge(undefined, true);
            logger.info('Scheduled ARM alarm set', { startAt, startMs });
            break; // Do NOT arm immediately
          }
        }

        // ── Immediate ARM (startAt absent or already past) ────────────────────
        if (
          stateMachine.state !== PurchaseState.READY &&
          stateMachine.state !== PurchaseState.IDLE &&
          stateMachine.state !== PurchaseState.INIT
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
            userProfile: message.userProfile,
            scopedPurchasePlan: message.scopedPurchasePlan,
          });

          await storage.savePersistentState({
            startedAt: new Date().toISOString(),
            attemptsCount: 0,
            currentPhase: 'ARMED',
            stopReason: undefined,
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
        const config = await storage.getConfiguration();
        if (config?.scopedPurchasePlan?.targets && config.scopedPurchasePlan.targets.length > 0) {
          const allowedShowings = new Set(
            config.scopedPurchasePlan.targets.map((t) => t.showingId)
          );
          if (!allowedShowings.has(message.showingId)) {
            logger.info('FETCH_SEATMAP_REQUEST blocked by Scope Guard (outside whitelist)', {
              showingId: message.showingId,
            });
            await eventBus.publish({
              type: 'FETCH_SEATMAP_RESPONSE',
              timestamp: new Date().toISOString(),
              showingId: message.showingId,
              success: false,
              error: `Showing ${message.showingId} outside scoped whitelist`,
            });
            break;
          }
        }

        const lastFailed = failedSeatmapShowings.get(message.showingId);
        if (lastFailed && Date.now() - lastFailed < 300_000) {
          await eventBus.publish({
            type: 'FETCH_SEATMAP_RESPONSE',
            timestamp: new Date().toISOString(),
            showingId: message.showingId,
            success: false,
            error: 'Seatmap not available (cached failure)',
          });
          break;
        }

        const url = `https://api-v2.ticketbox.vn/event/api/v1/events/showings/${message.showingId}/seatmap`;
        logger.info('Fetching seatmap from background worker', {
          showingId: message.showingId,
          url,
        });
        const res = await fetch(url);
        if (!res.ok) {
          failedSeatmapShowings.set(message.showingId, Date.now());
          logger.debug('Seatmap API returned non-OK status', {
            showingId: message.showingId,
            status: res.status,
          });
          await eventBus.publish({
            type: 'FETCH_SEATMAP_RESPONSE',
            timestamp: new Date().toISOString(),
            showingId: message.showingId,
            success: false,
            error: `HTTP ${res.status}: ${res.statusText}`,
          });
          break;
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
        failedSeatmapShowings.set(message.showingId, Date.now());
        logger.debug('Failed to fetch seatmap in background worker', {
          showingId: message.showingId,
          err: String(err),
        });
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

    case 'RESET_CONFIG_REQUESTED': {
      logger.info('Reset config requested by user');
      // Stop any active monitoring first
      await stopUseCase.execute('Config reset by user');
      // Cancel any pending scheduled ARM alarm
      if (typeof chrome !== 'undefined' && chrome.alarms) {
        chrome.alarms.clear('SCHEDULED_ARM');
        chrome.alarms.clear('SCHEDULED_ARM_PREWAKE');
      }
      // Clear config, last state, and persistent state (profiles preserved)
      await storage.clearConfiguration();
      await updateExtensionBadge('', false);
      await eventBus.publish({
        type: 'RESET_CONFIG_DONE',
        timestamp: new Date().toISOString(),
      });
      logger.info('Config cleared successfully');
      break;
    }

    case 'CANCEL_SCHEDULED_ARM': {
      logger.info('Cancelling scheduled ARM alarm');
      if (typeof chrome !== 'undefined' && chrome.alarms) {
        chrome.alarms.clear('SCHEDULED_ARM');
        chrome.alarms.clear('SCHEDULED_ARM_PREWAKE');
      }
      // Remove scheduledArmAt from config by omitting the key entirely
      const configForCancel = await storage.getConfiguration();
      if (configForCancel) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { scheduledArmAt: _omitScheduledArmAt, ...configWithoutScheduledArm } = configForCancel;
        if (configWithoutScheduledArm.scopedPurchasePlan?.persistence) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { startAt: _omitStartAt, ...persistenceWithoutStartAt } =
            configWithoutScheduledArm.scopedPurchasePlan.persistence;
          configWithoutScheduledArm.scopedPurchasePlan = {
            ...configWithoutScheduledArm.scopedPurchasePlan,
            persistence: persistenceWithoutStartAt,
          };
        }
        await storage.saveConfiguration(configWithoutScheduledArm as typeof configForCancel);
      }
      await updateExtensionBadge(PurchaseState.IDLE, false);
      logger.info('Scheduled ARM cancelled');
      break;
    }

    default:
      break;
  }
});

// Sync state machine transitions back to storage and update extension badge
stateMachine.subscribe(async (context: StateContext) => {
  await storage.saveCurrentState(context);
  const persistent = await storage.getPersistentState();
  const isScheduled = persistent?.currentPhase === 'SCHEDULED';
  await updateExtensionBadge(context.currentState, isScheduled);
});

// Run initialization
initializeWorker();

export { stateMachine, storage, eventBus, armUseCase, stopUseCase };
