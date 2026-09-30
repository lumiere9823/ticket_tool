/// <reference types="chrome" />
import { ChromeMessageBus } from '../../infrastructure/messaging/ChromeMessageBus';
import { TicketboxJourneyAdapter } from '../../infrastructure/ticketbox/TicketboxJourneyAdapter';
import { SanitizedLogger } from '../../infrastructure/logging/SanitizedLogger';
import { ExtensionMessage } from '../shared/messages';
import { ExecuteBookingJourneyUseCase } from '../../application/use-cases/ExecuteBookingJourneyUseCase';
import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { PurchaseState, StateContext } from '../../domain/states/PurchaseState';
import { ChromeStorageRepository } from '../../infrastructure/storage/ChromeStorageRepository';
import { BookingPreferences } from '../../domain/entities/BookingJourneyModels';
import { LatencyTracker } from '../../application/services/LatencyTracker';
import {
  filterByScope,
  pickTarget,
  ScopedPurchasePlan,
} from '../../domain/entities/ScopedPurchasePlan';

const logger = new SanitizedLogger({ state: 'CONTENT_SCRIPT' });
const messageBus = new ChromeMessageBus(logger);
const adapter = new TicketboxJourneyAdapter(logger);
const storage = new ChromeStorageRepository();
const stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING);

function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime) && Boolean(chrome.runtime.id);
  } catch {
    return false;
  }
}

stateMachine.subscribe(async (context: StateContext) => {
  if (!isExtensionContextValid()) return;
  try {
    await storage.saveCurrentState(context);
    await messageBus.publish({
      type: 'STATE_CHANGED',
      timestamp: new Date().toISOString(),
      attemptId: stateMachine.attemptId,
      state: context.currentState,
      context,
    });
  } catch (err: unknown) {
    if (String(err).includes('Extension context invalidated')) return;
    logger.error('Error in stateMachine subscriber', err);
  }
});

const journeyUseCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, messageBus, logger);

let isMonitoringActive = false;
let userExplicitlyStopped = false;
let isExecutingJourney = false;
let activeJourneyPromise: Promise<void> | null = null;
let isDiscoveryScanning = false;
let monitoringTimeout: number | null = null;
let debounceTimer: number | null = null;
let awaitingNavigationFromUrl: string | null = null;
let awaitingNavigationTimestamp = 0;
let lastWaitingLogTimestamp = 0;
const triedCandidateKeysInCycle = new Set<string>();

let lastPollTimestamp = Date.now();
let scheduledArmTargetMs: number | null = null;
let scheduledArmTimer: number | null = null;
let watchdogInterval: number | null = null;

function resetStateMachineToMonitoring(reason = 'Re-arm reset'): void {
  try {
    const s = stateMachine.state;
    if (s === PurchaseState.MONITORING) return;
    if (
      s !== PurchaseState.STOPPED &&
      s !== PurchaseState.READY &&
      s !== PurchaseState.IDLE &&
      s !== PurchaseState.INIT
    ) {
      stateMachine.transition({ type: 'STOP_REQUESTED', reason });
    }
    if (
      stateMachine.state !== PurchaseState.READY &&
      stateMachine.state !== PurchaseState.IDLE &&
      stateMachine.state !== PurchaseState.INIT
    ) {
      stateMachine.transition({ type: 'RESET_REQUESTED' });
    }
    if (
      stateMachine.state === PurchaseState.READY ||
      stateMachine.state === PurchaseState.IDLE ||
      stateMachine.state === PurchaseState.INIT
    ) {
      stateMachine.transition({ type: 'ARM' });
      stateMachine.transition({ type: 'MONITORING_STARTED' });
    } else if (stateMachine.state === PurchaseState.ARMED) {
      stateMachine.transition({ type: 'MONITORING_STARTED' });
    }
  } catch (err) {
    logger.warn('State machine reset to MONITORING failed', {
      err: String(err),
      currentState: stateMachine.state,
    });
  }
}

async function triggerScheduledArmInContent(): Promise<void> {
  if (scheduledArmTimer) {
    window.clearTimeout(scheduledArmTimer);
    scheduledArmTimer = null;
  }
  scheduledArmTargetMs = null;
  if (isMonitoringActive || isExecutingJourney) return;

  logger.info('Scheduled ARM exact target time reached in content script; automatically activating monitoring');
  resetStateMachineToMonitoring('Scheduled ARM exact timer');

  isMonitoringActive = true;
  isExecutingJourney = false;
  awaitingNavigationFromUrl = null;
  triedCandidateKeysInCycle.clear();
  lastPollTimestamp = Date.now();

  storage
    .savePersistentState({
      startedAt: new Date().toISOString(),
      attemptsCount: 0,
      currentPhase: 'MONITORING',
      stopReason: undefined,
    })
    .catch(() => {});

  scheduleDiscoveryScan(50);
  scheduleNextPoll(200);
}

function ensurePageBridgeInjected(): void {
  if (typeof document === 'undefined') return;
  const isLoaded = (window as unknown as Record<string, unknown>).__TICKETBOX_PAGE_BRIDGE_LOADED__;
  if (!isLoaded && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content-main.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch {
      // ignore
    }
  }
}

ensurePageBridgeInjected();

logger.info('Ticketbox Content Script loaded on page', {
  url: window.location.href,
});

let lastSnapshotSignature = '';

/**
 * Stops monitoring and marks state as STOPPED_LIMIT_REACHED with a specific reason.
 */
async function stopMonitoringWithLimitReason(reason: string): Promise<void> {
  isMonitoringActive = false;
  isExecutingJourney = false;
  if (monitoringTimeout) {
    window.clearTimeout(monitoringTimeout);
    monitoringTimeout = null;
  }

  await storage.savePersistentState({
    stopReason: reason,
    currentPhase: 'STOPPED_LIMIT_REACHED',
  });

  try {
    stateMachine.transition({ type: 'LIMIT_REACHED' });
  } catch (err) {
    logger.warn('Failed state transition on LIMIT_REACHED', { err: String(err) });
  }

  await messageBus.publish({
    type: 'STATE_CHANGED',
    timestamp: new Date().toISOString(),
    attemptId: stateMachine.attemptId,
    state: PurchaseState.STOPPED_LIMIT_REACHED,
    context: {
      ...stateMachine.getContext(),
      currentState: PurchaseState.STOPPED_LIMIT_REACHED,
      failureMessage: reason,
    },
  });
}

/**
 * Pre-poll stop checks (B3):
 * 1. User stopped
 * 2. Duration ceiling reached (startedAt + maxDurationMinutes)
 * 3. StopAt schedule reached
 * 4. Max attempts limit reached
 */
async function checkLimitsAndStopIfNeeded(scopedPlan?: ScopedPurchasePlan): Promise<boolean> {
  if (!isMonitoringActive) return true;
  if (
    stateMachine.state === PurchaseState.STOPPED ||
    stateMachine.state === PurchaseState.STOPPED_LIMIT_REACHED ||
    stateMachine.state === PurchaseState.STOPPED_NO_TARGET
  ) {
    return true;
  }

  const pState = await storage.getPersistentState();
  const now = Date.now();

  // 1. Duration check
  if (pState?.startedAt && scopedPlan?.persistence?.maxDurationMinutes) {
    const startedAtMs =
      typeof pState.startedAt === 'number'
        ? pState.startedAt
        : new Date(pState.startedAt).getTime();
    const maxDurationMs = scopedPlan.persistence.maxDurationMinutes * 60 * 1000;
    if (now - startedAtMs >= maxDurationMs) {
      const reason = `Duration ceiling reached (${scopedPlan.persistence.maxDurationMinutes} minutes)`;
      logger.info(reason);
      await stopMonitoringWithLimitReason(reason);
      return true;
    }
  }

  // 2. StopAt check
  if (scopedPlan?.persistence?.stopAt) {
    const stopAtTime = new Date(scopedPlan.persistence.stopAt).getTime();
    if (!isNaN(stopAtTime) && now >= stopAtTime) {
      const reason = `StopAt schedule reached (${scopedPlan.persistence.stopAt})`;
      logger.info(reason);
      await stopMonitoringWithLimitReason(reason);
      return true;
    }
  }

  // 3. Max attempts check
  if (
    scopedPlan?.persistence?.maxAttempts &&
    (pState?.attemptsCount ?? 0) >= scopedPlan.persistence.maxAttempts
  ) {
    const reason = `Max attempts limit reached (${pState?.attemptsCount}/${scopedPlan.persistence.maxAttempts})`;
    logger.info(reason);
    await stopMonitoringWithLimitReason(reason);
    return true;
  }

  return false;
}

/**
 * Schedules the next polling execution using recursive setTimeout with jitter.
 * Strictly enforces floor of 1500ms (B3 requirement).
 */
function scheduleNextPoll(delayMs?: number): void {
  if (!isExtensionContextValid() || !isMonitoringActive) {
    if (monitoringTimeout) {
      window.clearTimeout(monitoringTimeout);
      monitoringTimeout = null;
    }
    return;
  }

  if (monitoringTimeout) {
    window.clearTimeout(monitoringTimeout);
    monitoringTimeout = null;
  }

  let finalDelay = delayMs ?? 2000;
  finalDelay = Math.max(1500, Math.round(finalDelay));

  monitoringTimeout = window.setTimeout(async () => {
    await runMonitoringCycle();
  }, finalDelay);
}

/**
 * Runs a single monitoring cycle, checks boundaries, discovers catalog,
 * and recursively schedules the next poll with jitter.
 */
async function runMonitoringCycle(): Promise<void> {
  if (!isExtensionContextValid() || !isMonitoringActive) return;

  lastPollTimestamp = Date.now();
  try {
    const config = await storage.getConfiguration();
    const scopedPlan = config?.scopedPurchasePlan;

    const stopped = await checkLimitsAndStopIfNeeded(scopedPlan);
    if (stopped) return;

    await performDiscoveryScan();

    if (isMonitoringActive) {
      const baseInterval = scopedPlan?.persistence?.pollIntervalMs ?? 2000;
      const jitterRatio = scopedPlan?.persistence?.jitterRatio ?? 0.2;
      const jitter = (Math.random() * 2 - 1) * jitterRatio * baseInterval;
      const nextDelay = Math.max(1500, Math.round(baseInterval + jitter));
      scheduleNextPoll(nextDelay);
    }
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('Extension context invalidated')) {
      if (monitoringTimeout) {
        window.clearTimeout(monitoringTimeout);
        monitoringTimeout = null;
      }
      return;
    }
    logger.error('Error in runMonitoringCycle', err);
    if (isMonitoringActive) {
      scheduleNextPoll(2000);
    }
  }
}

/**
 * Periodically or reactively observes page metadata and publishes snapshots and journey updates.
 * Passive discovery scan does not mutate page state (strictly Phase 8 / safe architecture compliant).
 */
async function performDiscoveryScan(force = false): Promise<void> {
  if (!isExtensionContextValid()) {
    if (monitoringTimeout) {
      window.clearTimeout(monitoringTimeout);
      monitoringTimeout = null;
    }
    return;
  }

  if (isDiscoveryScanning && !force) {
    return;
  }
  isDiscoveryScanning = true;

  try {
    const eventState = await adapter.getEventState();
    const catalog = await adapter.discoverTicketCatalog();
    const allTickets = catalog.showings.flatMap((s) => s.ticketTypes);
    const availableTickets = allTickets.filter((t) => t.availability === 'AVAILABLE');
    const summary = await adapter.getBookingSummary();

    const activeShowing = catalog.showings[0];
    const showingInfo = activeShowing
      ? [activeShowing.name, activeShowing.date].filter(Boolean).join(' • ')
      : undefined;

    const eventTitle = catalog.eventTitle ?? eventState.event?.name ?? document.title;

    // Build full TicketCatalogSnapshot with rich TicketOption data
    const catalogSnapshot = {
      eventId: catalog.eventId,
      eventTitle,
      showings: catalog.showings.map((s) => ({
        id: s.id,
        name: s.name,
        date: s.date,
        venue: null as string | null,
        tickets: s.ticketTypes.map((t) => ({
          id: t.id ?? null,
          name: t.name,
          price: t.price.amount,
          currency: 'VND' as const,
          mode: (t.mode === 'ZONE' ? 'AREA_BASED' : t.mode) as
            'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN',
          availability: t.availability as
            'AVAILABLE' | 'SOLD_OUT' | 'OFFLINE_SALE' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN',
          selectable: t.selectable,
          minQuantity: t.minQuantity,
          maxQuantity: t.maxQuantity,
          source: 'EVENT_PAGE' as const,
          evidence: t.source.evidence,
        })),
      })),
      tickets: allTickets.map((t) => ({
        id: t.id ?? null,
        name: t.name,
        price: t.price.amount,
        currency: 'VND' as const,
        mode: (t.mode === 'ZONE' ? 'AREA_BASED' : t.mode) as
          'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN',
        availability: t.availability as
          'AVAILABLE' | 'SOLD_OUT' | 'OFFLINE_SALE' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN',
        selectable: t.selectable,
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        source: 'EVENT_PAGE' as const,
        evidence: t.source.evidence,
      })),
      loadState: (allTickets.length > 0 ? 'LOADED' : 'EMPTY') as
        'IDLE' | 'LOADING' | 'LOADED' | 'EMPTY' | 'ERROR' | 'INVALID_URL',
      loadMessage:
        allTickets.length > 0
          ? `${allTickets.length} ticket option${allTickets.length === 1 ? '' : 's'} discovered.`
          : 'No ticket options detected.',
      discoveredAt: new Date().toISOString(),
    };

    const journeyUpdate: ExtensionMessage = {
      type: 'JOURNEY_UPDATE',
      timestamp: new Date().toISOString(),
      eventTitle,
      showingInfo,
      showingId: activeShowing?.id ?? null,
      catalogSnapshot,
      // Legacy simple array kept for backward compat
      tickets: allTickets.map((t) => ({
        name: t.name,
        price: t.price.amount,
        mode: t.mode,
        availability: t.availability,
      })),
      summary: summary
        ? {
            subtotal: summary.subtotal,
            fees: summary.fees,
            total: summary.total,
          }
        : undefined,
    };

    // Cache in chrome.storage.local for instant popup display on re-open only if tickets were discovered
    if (isExtensionContextValid() && chrome.storage && chrome.storage.local) {
      if (allTickets.length > 0) {
        await chrome.storage.local.set({ latestJourneyUpdate: journeyUpdate });
      }
    }

    const currentSignature = `${eventTitle}_${allTickets.length}_${allTickets.map((t) => `${t.name}_${t.price.amount}_${t.availability}`).join('|')}_${summary?.total ?? 0}`;
    const hasChanged = currentSignature !== lastSnapshotSignature;
    if (hasChanged) {
      lastSnapshotSignature = currentSignature;
    }

    if (isExtensionContextValid() && (hasChanged || force)) {
      logger.info('Discovery scan completed', {
        eventTitle,
        ticketCount: allTickets.length,
        availableCount: availableTickets.length,
        monitoringActive: isMonitoringActive,
      });

      // Publish legacy PAGE_DISCOVERY_SNAPSHOT for backward compatibility
      await messageBus.publish({
        type: 'PAGE_DISCOVERY_SNAPSHOT',
        observationId: `obs_${Date.now()}`,
        timestamp: new Date().toISOString(),
        url: eventState.pageUrl,
        pageTitle: eventTitle,
        observedElements: {
          buttonCount: document.querySelectorAll('button').length,
          hasInteractiveElements: !!document.querySelector('button, [role="button"]'),
          hasMainContent: !!document.querySelector('main, article, [role="main"]'),
        },
        observedAvailability: availableTickets.length > 0,
        domSummary: {
          title: eventTitle,
          hasButtons: !!document.querySelector('button, [role="button"]'),
          ticketElementsCount: allTickets.length,
        },
        timingMs: Date.now(),
      });

      // Publish JOURNEY_UPDATE with full catalogSnapshot
      await messageBus.publish(journeyUpdate);
    }

    // If monitoring is active, check if we should trigger the booking journey
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

    // If awaiting page navigation from a completed step (e.g. from /select-ticket to /question-form)
    if (awaitingNavigationFromUrl) {
      if (currentUrl !== awaitingNavigationFromUrl) {
        logger.info('Page navigated to new step URL', {
          from: awaitingNavigationFromUrl,
          to: currentUrl,
        });
        awaitingNavigationFromUrl = null;
      } else {
        // Check if an error modal (e.g. -1242) has appeared while awaiting navigation
        if (adapter && typeof adapter.detectAndHandleErrorModal === 'function') {
          const modalCheck = await adapter.detectAndHandleErrorModal();
          if (modalCheck.hasError && modalCheck.isSeatUnavailable) {
            logger.warn(
              'Seat unavailable modal detected while awaiting page navigation. Aborting navigation wait and retrying journey.',
              {
                seatLabel: modalCheck.seatLabel,
              }
            );
            awaitingNavigationFromUrl = null;
            if (isMonitoringActive && !isExecutingJourney && !activeJourneyPromise) {
              attemptBookingJourney();
            }
            return;
          }
        }

        if (Date.now() - awaitingNavigationTimestamp < 10000) {
          logger.debug('Waiting for page navigation to complete...', { url: currentUrl });
          return;
        } else {
          logger.warn('Timed out waiting for page navigation. Clearing wait flag.');
          awaitingNavigationFromUrl = null;
        }
      }
    }

    const isOnSpecialBookingPage =
      currentUrl.includes('/question-form') ||
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/booking') ||
      currentUrl.includes('/payment');

    // Auto-resume monitoring if user is on select-ticket page (e.g. after clicking "Chọn ghế khác"),
    // but NEVER auto-resume if the user explicitly clicked Stop.
    if (
      !userExplicitlyStopped &&
      !isMonitoringActive &&
      (currentUrl.includes('/select-ticket') || currentUrl.includes('/booking'))
    ) {
      logger.info('User on select-ticket page; auto-reactivating monitoring to continue seat selection');
      isMonitoringActive = true;
      try {
        if (stateMachine.state === PurchaseState.FAILED || stateMachine.state === PurchaseState.STOPPED) {
          stateMachine.transition({ type: 'RESET_REQUESTED' });
          stateMachine.transition({ type: 'ARM' });
          stateMachine.transition({ type: 'MONITORING_STARTED' });
        }
      } catch {
        // ignore
      }
    }

    if (
      isMonitoringActive &&
      !isExecutingJourney &&
      !activeJourneyPromise &&
      (availableTickets.length > 0 || isOnSpecialBookingPage)
    ) {
      attemptBookingJourney();
    }
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('Extension context invalidated')) {
      if (monitoringTimeout) {
        window.clearTimeout(monitoringTimeout);
        monitoringTimeout = null;
      }
      return;
    }
    logger.error('Error during discovery scan in content script', err);
  } finally {
    isDiscoveryScanning = false;
  }
}

/**
 * Executes the state-machine-driven booking journey when armed.
 * Transitions strictly through canonical states up to PAYMENT_GATE.
 */
async function attemptBookingJourney(): Promise<void> {
  if (!isMonitoringActive || isExecutingJourney || activeJourneyPromise) return;
  isExecutingJourney = true;

  const journeyPromise = (async () => {
    try {
      const config = await storage.getConfiguration();
    if (!config) return;

    const scopedPlan = config.scopedPurchasePlan;
    if (await checkLimitsAndStopIfNeeded(scopedPlan)) return;

    const plan = config.purchasePlan;
    const priorities =
      scopedPlan && scopedPlan.targets.length > 0
        ? scopedPlan.targets.flatMap((t) => t.ticketTypeIds)
        : plan
          ? plan.ticketRules.map((r) => r.ticketName || r.ticketId).filter(Boolean)
          : config.preferences?.categoryPriority || [];

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isOnQuestionForm = currentUrl.includes('/question-form');
    const isOnPayment = currentUrl.includes('/payment') || currentUrl.includes('/checkout');

    const isOnSelectTicket = currentUrl.includes('/select-ticket') || currentUrl.includes('/booking');

    if (priorities.length === 0 && !isOnQuestionForm && !isOnPayment) {
      if (isOnSelectTicket) {
        logger.info('No explicit ticket priorities configured on select-ticket; defaulting to ANY to select available seats');
        priorities.push('ANY');
      } else {
        logger.info('No ticket priorities configured; waiting for user configuration');
        return;
      }
    }

    const scopedShowingIds = scopedPlan?.targets.map((t) => t.showingId).filter(Boolean);

    const preferences: BookingPreferences = {
      categoryPriority: priorities,
      quantity:
        scopedPlan?.quantity ?? plan?.ticketRules[0]?.quantity ?? config.preferences?.quantity ?? 1,
      allowFallback: scopedPlan
        ? false
        : (plan?.allowFallback ?? config.preferences?.allowFallback ?? true),
      seatPreference: 'ANY_AVAILABLE',
      nonAdjacentFallback: 'SELECT_NON_ADJACENT',
      userProfile: config.userProfile,
      preferredShowingId:
        scopedShowingIds && scopedShowingIds.length > 0
          ? scopedShowingIds[0]
          : (plan?.showingId ?? null),
      scopedPurchasePlan: scopedPlan,
      allowPartialQuantity: scopedPlan?.allowPartialQuantity ?? false,
    };

    let activeTargetKey: string | null = null;

    if (!isOnQuestionForm && !isOnPayment) {
      // Discover catalog for the preferred showing (or allowed showings only)
      const catalog = await adapter.discoverTicketCatalog(
        preferences.preferredShowingId,
        scopedShowingIds && scopedShowingIds.length > 0 ? scopedShowingIds : null
      );

      // If scopedPlan is configured, use domain filterByScope and pickTarget
      if (scopedPlan && scopedPlan.targets.length > 0) {
        const scopeResult = filterByScope(catalog, scopedPlan);
        if (scopeResult.validCandidates.length === 0) {
          if (stateMachine.state === PurchaseState.MONITORING) {
            try {
              stateMachine.transition({ type: 'WAITING_FOR_STOCK' });
            } catch {
              // ignore
            }
          }
          const now = Date.now();
          if (now - lastWaitingLogTimestamp > 30000) {
            lastWaitingLogTimestamp = now;
            logger.info('No whitelisted tickets currently available. Continuing monitoring...', {
              inScopeCount: scopeResult.inScopeCandidates.length,
              rejectedReasons: scopeResult.rejectedCandidates.map(
                (r) => `${r.ticketName}: ${r.reason}`
              ),
            });
          }
          return;
        }

        // Target cycling (B3): Filter out candidates already tried in current cycle
        let candidatePool = scopeResult.validCandidates.filter(
          (c) => !triedCandidateKeysInCycle.has(`${c.showingId}_${c.ticketId}`)
        );

        if (candidatePool.length === 0) {
          // Full cycle exhausted for all valid candidates; reset cycle and wait for stock
          triedCandidateKeysInCycle.clear();
          candidatePool = scopeResult.validCandidates;
          if (stateMachine.state !== PurchaseState.WAITING_FOR_STOCK) {
            try {
              stateMachine.transition({ type: 'WAITING_FOR_STOCK' });
            } catch {
              // ignore
            }
          }
          return;
        }

        const chosenTarget = pickTarget(candidatePool, scopedPlan);
        if (!chosenTarget) {
          triedCandidateKeysInCycle.clear();
          return;
        }

        activeTargetKey = `${chosenTarget.showingId}_${chosenTarget.ticketId}`;

        // Attempt counting (B3): pure discovery does NOT increment attempts.
        // Increment attemptsCount only when starting booking journey execution.
        const pState = await storage.getPersistentState();
        const newAttempts = (pState?.attemptsCount ?? 0) + 1;
        await storage.savePersistentState({
          attemptsCount: newAttempts,
          lastTarget: {
            showingId: chosenTarget.showingId,
            ticketTypeId: chosenTarget.ticketId,
            ticketName: chosenTarget.ticketName,
          },
          currentPhase: 'SELECTING',
        });

        if (
          scopedPlan.persistence?.maxAttempts &&
          newAttempts > scopedPlan.persistence.maxAttempts
        ) {
          await stopMonitoringWithLimitReason(
            `Max attempts limit reached (${newAttempts}/${scopedPlan.persistence.maxAttempts})`
          );
          return;
        }

        preferences.preferredShowingId = chosenTarget.showingId;
        preferences.categoryPriority = [chosenTarget.ticketName, chosenTarget.ticketId];
      } else {
        const relevantShowings = preferences.preferredShowingId
          ? catalog.showings.filter((s) => s.id === preferences.preferredShowingId)
          : catalog.showings;
        const allTickets = (
          relevantShowings.length > 0 ? relevantShowings : catalog.showings
        ).flatMap((s) => s.ticketTypes);
        const availableTickets = allTickets.filter((t) => t.availability === 'AVAILABLE');

        if (availableTickets.length === 0) {
          logger.info('No tickets currently available. Continuing monitoring...');
          return;
        }

        // Check if any available ticket matches user priority or fallback
        const hasMatch =
          preferences.allowFallback ||
          availableTickets.some((t) =>
            priorities.some(
              (p) =>
                t.name.toLowerCase().includes(p.toLowerCase()) ||
                p.toLowerCase().includes(t.name.toLowerCase())
            )
          );

        if (!hasMatch) {
          logger.info('Available tickets do not match priority rules. Continuing monitoring...');
          return;
        }
      }
    }

    logger.info('Matching ticket detected! Starting booking journey execution...', {
      priorities: preferences.categoryPriority,
      quantity: preferences.quantity,
    });

    const tracker = new LatencyTracker(stateMachine.attemptId || `attempt_${Date.now()}`, logger);
    tracker.recordT0(Date.now(), true);

    // Remember where the step STARTED. Ticketbox is a SPA: the URL can already have changed by the
    // time execute() returns, and waiting for a change "from the new URL" would never end.
    const urlBeforeStep = typeof window !== 'undefined' ? window.location.href : '';

    const result = await journeyUseCase.execute(preferences, tracker);

    logger.info('Booking journey executed', {
      success: result.success,
      finalState: result.finalState,
      requiresUserAction: result.requiresUserAction,
    });

    if (!result.success) {
      if (activeTargetKey) {
        triedCandidateKeysInCycle.add(activeTargetKey);
        try {
          stateMachine.transition({ type: 'RETRY_TARGET' });
        } catch {
          // ignore
        }
        await storage.savePersistentState({
          currentPhase: 'RETRYING_TARGET',
        });
      }
    } else {
      triedCandidateKeysInCycle.clear();
      await storage.savePersistentState({
        currentPhase: result.finalState,
      });
    }

    // When tickets or seats are selected and navigation is pending, yield and await navigation
    if (
      result.success &&
      (result.finalState === PurchaseState.SEATS_SELECTED ||
        result.finalState === PurchaseState.TICKET_SELECTED) &&
      !result.requiresUserAction
    ) {
      const urlAfterStep = typeof window !== 'undefined' ? window.location.href : '';
      if (urlAfterStep !== urlBeforeStep) {
        logger.info('Page already navigated during the step; no navigation wait needed', {
          from: urlBeforeStep,
          to: urlAfterStep,
        });
      } else {
        awaitingNavigationFromUrl = urlAfterStep || null;
        awaitingNavigationTimestamp = Date.now();
        logger.info('Step executed and submitted. Waiting for page navigation to next step...', {
          finalState: result.finalState,
          currentUrl: awaitingNavigationFromUrl,
        });
      }
    }

    // When payment gate, consent, or terminal state is reached requiring user action: pause monitoring
    if (
      (result.finalState === PurchaseState.PAYMENT_GATE ||
        result.finalState === PurchaseState.CONSENT_REQUIRED ||
        result.finalState === PurchaseState.FILLING_ATTENDEE_FORM ||
        result.finalState === PurchaseState.HELD ||
        result.finalState === PurchaseState.CONFIRMED ||
        result.finalState === PurchaseState.STOPPED) &&
      result.requiresUserAction
    ) {
      logger.info(`Journey reached target state ${result.finalState}. Halting monitoring loop.`);
      isMonitoringActive = false;
      if (monitoringTimeout) {
        window.clearTimeout(monitoringTimeout);
        monitoringTimeout = null;
      }
    } else if (result.finalState === PurchaseState.FAILED) {
      const currentUrlNow = typeof window !== 'undefined' ? window.location.href : '';
      const isOnActiveBooking =
        currentUrlNow.includes('/select-ticket') ||
        currentUrlNow.includes('/booking') ||
        currentUrlNow.includes('/question-form');

      if (isOnActiveBooking) {
        logger.info(
          'Journey encountered failure on active booking page. Backing off 1.5s and maintaining monitoring to allow auto-recovery/reselection.',
          { url: currentUrlNow }
        );
        isMonitoringActive = true;
        try {
          if (stateMachine.state === PurchaseState.FAILED || stateMachine.state === PurchaseState.STOPPED) {
            stateMachine.transition({ type: 'RESET_REQUESTED' });
            stateMachine.transition({ type: 'ARM' });
            stateMachine.transition({ type: 'MONITORING_STARTED' });
          }
        } catch {
          // ignore
        }
        scheduleNextPoll(1500);
        scheduleDiscoveryScan(1500);
      } else {
        logger.info(
          'Journey execution failed after retries. Halting monitoring loop to prevent retry storm.'
        );
        isMonitoringActive = false;
        if (monitoringTimeout) {
          window.clearTimeout(monitoringTimeout);
          monitoringTimeout = null;
        }
      }
    }
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes('Extension context invalidated')) {
        if (monitoringTimeout) {
          window.clearTimeout(monitoringTimeout);
          monitoringTimeout = null;
        }
        return;
      }
      logger.error('Error during booking journey execution in content script', err);
    } finally {
      isExecutingJourney = false;
      activeJourneyPromise = null;
    }
  })();

  activeJourneyPromise = journeyPromise;
  await journeyPromise;
}

function scheduleDiscoveryScan(delayMs = 300): void {
  if (!isExtensionContextValid()) return;
  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    performDiscoveryScan();
  }, delayMs);
}

// Initial passive scans (immediate + delayed for Next.js client-side React hydration)
scheduleDiscoveryScan(100);
window.setTimeout(() => scheduleDiscoveryScan(0), 1200);
window.setTimeout(() => scheduleDiscoveryScan(0), 2500);

// Auto-rehydrate monitoring/booking state across page navigation if already armed
async function checkRehydration(): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    const config = await storage.getConfiguration();
    if (config?.scheduledArmAt) {
      const schedMs = new Date(config.scheduledArmAt).getTime();
      if (schedMs > Date.now()) {
        logger.info('Scheduled ARM pending in future; arming content script timer', {
          scheduledArmAt: config.scheduledArmAt,
          remainingSeconds: Math.round((schedMs - Date.now()) / 1000),
        });
        scheduledArmTargetMs = schedMs;
        if (scheduledArmTimer) window.clearTimeout(scheduledArmTimer);
        scheduledArmTimer = window.setTimeout(async () => {
          await triggerScheduledArmInContent();
        }, Math.max(0, schedMs - Date.now()));
        return;
      } else {
        logger.info('Scheduled ARM time has already passed; activating immediately', {
          scheduledArmAt: config.scheduledArmAt,
        });
        await triggerScheduledArmInContent();
        return;
      }
    }

    const pState = await storage.getPersistentState();
    const stoppedPhases = new Set(['STOPPED', 'STOPPED_LIMIT_REACHED', 'STOPPED_NO_TARGET']);
    if (pState?.currentPhase && stoppedPhases.has(pState.currentPhase)) {
      userExplicitlyStopped = true;
      return;
    }

    const lastState = await storage.getLastState();
    if (
      lastState &&
      (lastState.currentState === PurchaseState.ARMED ||
        lastState.currentState === PurchaseState.MONITORING ||
        lastState.currentState === PurchaseState.SELECTING ||
        lastState.currentState === PurchaseState.RESERVING ||
        lastState.currentState === PurchaseState.TICKET_SELECTED ||
        lastState.currentState === PurchaseState.SEATS_SELECTED ||
        lastState.currentState === PurchaseState.QUESTION_FORM_DETECTED ||
        lastState.currentState === PurchaseState.FILLING_ATTENDEE_FORM ||
        lastState.currentState === PurchaseState.FORM_VALIDATED)
    ) {
      logger.info('Rehydrating active monitoring state in content script', {
        state: lastState.currentState,
      });
      isMonitoringActive = true;
      scheduleDiscoveryScan(200);
      scheduleNextPoll(1500);
    }
  } catch (err: unknown) {
    if (String(err).includes('Extension context invalidated')) return;
    logger.warn('Failed to check rehydration in content script', { err: String(err) });
  }
}

checkRehydration();

// Page Visibility API tracking (B4 requirement)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (!isExtensionContextValid()) return;
    try {
      const isHidden = document.hidden;
      await storage.savePersistentState({
        tabHiddenWarning: isHidden,
      });
      if (isHidden) {
        logger.warn(
          'Tab hidden: Browser background timer throttling may affect polling interval. Keep tab active in foreground for best results.'
        );
      } else {
        logger.info('Tab returned to foreground — immediately resuming and catching up polling.');
        if (scheduledArmTargetMs && Date.now() >= scheduledArmTargetMs) {
          await triggerScheduledArmInContent();
        } else if (isMonitoringActive && !isExecutingJourney) {
          scheduleDiscoveryScan(50);
          scheduleNextPoll(100);
        }
      }
    } catch {
      // ignore
    }
  });
}

// Set up MutationObserver to re-scan when client-side React mounts tickets
if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver((mutations) => {
    if (!isExtensionContextValid()) {
      observer.disconnect();
      return;
    }
    let hasAddedElements = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        hasAddedElements = true;
        break;
      }
    }
    if (hasAddedElements) {
      scheduleDiscoveryScan(100);
    }
  });

  const target = document.body || document.documentElement;
  if (target) {
    observer.observe(target, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      const node = document.body || document.documentElement;
      if (node) observer.observe(node, { childList: true, subtree: true });
    });
  }
}

// Detect SPA client-side routing transitions (Next.js / HTML5 History API)
if (typeof window !== 'undefined') {
  let prevUrl = window.location.href;
  const checkUrlChange = () => {
    if (!isExtensionContextValid()) return;
    const nowUrl = window.location.href;
    if (nowUrl !== prevUrl) {
      const oldUrl = prevUrl;
      prevUrl = nowUrl;
      logger.info('Detected SPA URL transition', { from: oldUrl, to: nowUrl });
      if (awaitingNavigationFromUrl && nowUrl !== awaitingNavigationFromUrl) {
        awaitingNavigationFromUrl = null;
      }
      if (nowUrl.includes('/select-ticket') || nowUrl.includes('/booking')) {
        if (!userExplicitlyStopped && !isMonitoringActive) {
          logger.info('Detected navigation to select-ticket page; ensuring monitoring is active');
          isMonitoringActive = true;
          try {
            if (stateMachine.state === PurchaseState.FAILED || stateMachine.state === PurchaseState.STOPPED) {
              stateMachine.transition({ type: 'RESET_REQUESTED' });
              stateMachine.transition({ type: 'ARM' });
              stateMachine.transition({ type: 'MONITORING_STARTED' });
            }
          } catch {
            // ignore
          }
          scheduleNextPoll(100);
        }
      }
      scheduleDiscoveryScan(50);
    }
  };

  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);
  const scheduleUrlCheck = () => {
    if (!isExtensionContextValid()) return;
    window.setTimeout(() => {
      checkUrlChange();
      scheduleUrlCheck();
    }, 100);
  };
  scheduleUrlCheck();
}

// Handle coordination messages from the Service Worker and Popup
messageBus.subscribe((message: ExtensionMessage) => {
  switch (message.type) {
    case 'REQUEST_DISCOVERY_SCAN': {
      logger.info('Content script received REQUEST_DISCOVERY_SCAN');
      performDiscoveryScan(true);
      break;
    }

    case 'ARM_REQUESTED': {
      logger.info('Content script received ARM_REQUESTED');
      // If ARM is scheduled for a future time, arm local timer and wait
      const startAt = message.scopedPurchasePlan?.persistence?.startAt;
      if (startAt) {
        const startMs = new Date(startAt).getTime();
        if (startMs > Date.now()) {
          const delaySeconds = Math.round((startMs - Date.now()) / 1000);
          logger.info('ARM is scheduled for future time; armed local timer in content script', {
            startAt,
            delaySeconds,
          });
          scheduledArmTargetMs = startMs;
          isMonitoringActive = false;
          if (monitoringTimeout) {
            window.clearTimeout(monitoringTimeout);
            monitoringTimeout = null;
          }
          if (scheduledArmTimer) {
            window.clearTimeout(scheduledArmTimer);
          }
          const delayMs = Math.max(0, startMs - Date.now());
          scheduledArmTimer = window.setTimeout(async () => {
            logger.info('Scheduled ARM timer fired at target timestamp in content script');
            await triggerScheduledArmInContent();
          }, delayMs);
          break;
        }
      }

      if (scheduledArmTimer) {
        window.clearTimeout(scheduledArmTimer);
        scheduledArmTimer = null;
      }
      scheduledArmTargetMs = null;

      resetStateMachineToMonitoring('User ARM requested');
      userExplicitlyStopped = false;
      isMonitoringActive = true;
      isExecutingJourney = false;
      awaitingNavigationFromUrl = null;
      triedCandidateKeysInCycle.clear();
      storage
        .savePersistentState({
          startedAt: new Date().toISOString(),
          attemptsCount: 0,
          currentPhase: 'ARMED',
          stopReason: undefined,
        })
        .catch(() => {});
      scheduleDiscoveryScan(50);
      scheduleNextPoll(400);
      break;
    }

    case 'START_MONITORING': {
      logger.info('Content script received START_MONITORING');
      resetStateMachineToMonitoring('User START_MONITORING');
      userExplicitlyStopped = false;
      isMonitoringActive = true;
      isExecutingJourney = false;
      awaitingNavigationFromUrl = null;
      triedCandidateKeysInCycle.clear();
      storage
        .savePersistentState({
          startedAt: new Date().toISOString(),
          attemptsCount: 0,
          currentPhase: 'MONITORING',
          stopReason: undefined,
        })
        .catch(() => {});
      scheduleDiscoveryScan(50);
      scheduleNextPoll(400);
      break;
    }

    case 'STOP_REQUESTED': {
      userExplicitlyStopped = true;
      if (scheduledArmTimer) {
        window.clearTimeout(scheduledArmTimer);
        scheduledArmTimer = null;
      }
      scheduledArmTargetMs = null;
      if (!isMonitoringActive && stateMachine.state === PurchaseState.STOPPED) {
        break;
      }
      logger.info('Content script received STOP_REQUESTED');
      isMonitoringActive = false;
      isExecutingJourney = false;
      awaitingNavigationFromUrl = null;
      if (monitoringTimeout) {
        window.clearTimeout(monitoringTimeout);
        monitoringTimeout = null;
      }
      try {
        if (stateMachine.state !== PurchaseState.STOPPED) {
          stateMachine.transition({
            type: 'STOP_REQUESTED',
            reason: message.reason || 'User requested stop',
          });
        }
      } catch (err) {
        logger.warn('Failed to transition to STOPPED in content script', { err: String(err) });
      }
      break;
    }

    case 'STATE_CHANGED': {
      if (
        message.state === PurchaseState.STOPPED ||
        message.state === PurchaseState.STOPPED_LIMIT_REACHED ||
        message.state === PurchaseState.STOPPED_NO_TARGET
      ) {
        const stopReason =
          message.type === 'STATE_CHANGED'
            ? message.context?.failureMessage
            : undefined;
        if (
          stopReason === 'Re-arm reset' ||
          stopReason === 'Start monitoring reset' ||
          stopReason === 'Journey initial clean reset' ||
          stopReason?.includes('clean reset')
        ) {
          break;
        }
        userExplicitlyStopped = true;
        if (scheduledArmTimer) {
          window.clearTimeout(scheduledArmTimer);
          scheduledArmTimer = null;
        }
        scheduledArmTargetMs = null;
        isMonitoringActive = false;
        if (!activeJourneyPromise) {
          isExecutingJourney = false;
        }
        awaitingNavigationFromUrl = null;
        if (monitoringTimeout) {
          window.clearTimeout(monitoringTimeout);
          monitoringTimeout = null;
        }
      } else if (
        message.state === PurchaseState.ARMED ||
        message.state === PurchaseState.MONITORING ||
        message.state === PurchaseState.WAITING_FOR_STOCK
      ) {
        userExplicitlyStopped = false;
        if (!isMonitoringActive) {
          logger.info('STATE_CHANGED to active monitoring state; activating content script polling', {
            state: message.state,
          });
          isMonitoringActive = true;
          scheduleNextPoll(1000);
        }
      }
      break;
    }

    case 'CANCEL_SCHEDULED_ARM': {
      logger.info('Content script received CANCEL_SCHEDULED_ARM');
      if (scheduledArmTimer) {
        window.clearTimeout(scheduledArmTimer);
        scheduledArmTimer = null;
      }
      scheduledArmTargetMs = null;
      isMonitoringActive = false;
      isExecutingJourney = false;
      awaitingNavigationFromUrl = null;
      if (monitoringTimeout) {
        window.clearTimeout(monitoringTimeout);
        monitoringTimeout = null;
      }
      break;
    }

    case 'HEARTBEAT_PING': {
      if (scheduledArmTargetMs && Date.now() >= scheduledArmTargetMs) {
        logger.info('Heartbeat ping detected scheduled ARM time reached; activating monitoring');
        triggerScheduledArmInContent();
        break;
      }
      if (isMonitoringActive && !isExecutingJourney) {
        const elapsed = Date.now() - lastPollTimestamp;
        if (elapsed >= 3000) {
          logger.debug('Heartbeat ping detected idle poll interval; triggering cycle', { elapsed });
          scheduleNextPoll(50);
        }
      }
      break;
    }

    default:
      break;
  }
});

// Direct runtime listener fallback for tab messages
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender: unknown, sendResponse: (res?: unknown) => void) => {
      if (!isExtensionContextValid()) return undefined;
      const msg = message as { type?: string } | undefined;
      if (msg?.type === 'REQUEST_DISCOVERY_SCAN') {
        logger.info('Content script processing REQUEST_DISCOVERY_SCAN');
        performDiscoveryScan()
          .then(() => {
            sendResponse({ success: true, timestamp: new Date().toISOString() });
          })
          .catch((err) => {
            sendResponse({ success: false, error: String(err) });
          });
        return true; // Keep message channel open for async sendResponse
      }
      if (msg?.type === 'HEARTBEAT_PING') {
        if (scheduledArmTargetMs && Date.now() >= scheduledArmTargetMs) {
          triggerScheduledArmInContent();
        } else if (isMonitoringActive && !isExecutingJourney) {
          const elapsed = Date.now() - lastPollTimestamp;
          if (elapsed >= 3000) {
            scheduleNextPoll(50);
          }
        }
        sendResponse({ success: true, timestamp: new Date().toISOString() });
        return true;
      }
      return undefined;
    }
  );
}

// Periodic watchdog (every 1s) to defend against aggressive background tab throttling
if (typeof window !== 'undefined') {
  watchdogInterval = window.setInterval(() => {
    if (!isExtensionContextValid()) {
      if (watchdogInterval) clearInterval(watchdogInterval);
      return;
    }
    const now = Date.now();
    if (scheduledArmTargetMs && now >= scheduledArmTargetMs) {
      logger.info('Watchdog timer detected scheduled ARM target reached; activating');
      triggerScheduledArmInContent();
    }
    if (isMonitoringActive && !isExecutingJourney) {
      const elapsed = now - lastPollTimestamp;
      if (elapsed > 4000) {
        logger.debug('Watchdog timer detected overdue poll cycle; kicking off poll', { elapsed });
        lastPollTimestamp = now;
        runMonitoringCycle();
      }
    }
  }, 1000);
}

