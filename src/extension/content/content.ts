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
let isExecutingJourney = false;
let monitoringTimer: number | null = null;
let debounceTimer: number | null = null;
let awaitingNavigationFromUrl: string | null = null;
let awaitingNavigationTimestamp = 0;

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
 * Periodically or reactively observes page metadata and publishes snapshots and journey updates.
 * Passive discovery scan does not mutate page state (strictly Phase 8 / safe architecture compliant).
 */
async function performDiscoveryScan(force = false): Promise<void> {
  if (!isExtensionContextValid()) {
    if (monitoringTimer) {
      clearInterval(monitoringTimer);
      monitoringTimer = null;
    }
    return;
  }

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

    logger.info('Discovery scan completed', {
      eventTitle,
      ticketCount: allTickets.length,
      availableCount: availableTickets.length,
      monitoringActive: isMonitoringActive,
    });

    // Build full TicketCatalogSnapshot with rich TicketOption data
    const catalogSnapshot = {
      eventId: catalog.eventId,
      eventTitle,
      showings: catalog.showings.map((s) => ({
        id: s.id,
        name: s.name,
        date: s.date,
        venue: null as string | null,
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
      } else if (Date.now() - awaitingNavigationTimestamp < 10000) {
        logger.debug('Waiting for page navigation to complete...', { url: currentUrl });
        return;
      } else {
        logger.warn('Timed out waiting for page navigation. Clearing wait flag.');
        awaitingNavigationFromUrl = null;
      }
    }

    const isOnSpecialBookingPage =
      currentUrl.includes('/question-form') ||
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/payment');

    if (
      isMonitoringActive &&
      !isExecutingJourney &&
      (availableTickets.length > 0 || isOnSpecialBookingPage)
    ) {
      attemptBookingJourney();
    }
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('Extension context invalidated')) {
      if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
      }
      return;
    }
    logger.error('Error during discovery scan in content script', err);
  }
}

/**
 * Executes the state-machine-driven booking journey when armed.
 * Transitions strictly through canonical states up to PAYMENT_GATE.
 */
async function attemptBookingJourney(): Promise<void> {
  if (!isMonitoringActive || isExecutingJourney) return;
  isExecutingJourney = true;

  try {
    const config = await storage.getConfiguration();
    if (!config) return;

    const plan = config.purchasePlan;
    const priorities = plan
      ? plan.ticketRules.map((r) => r.ticketName || r.ticketId).filter(Boolean)
      : config.preferences?.categoryPriority || [];

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isOnQuestionForm = currentUrl.includes('/question-form');
    const isOnPayment = currentUrl.includes('/payment') || currentUrl.includes('/checkout');

    if (priorities.length === 0 && !isOnQuestionForm && !isOnPayment) {
      logger.info('No ticket priorities configured; waiting for user configuration');
      return;
    }

    const preferences: BookingPreferences = {
      categoryPriority: priorities,
      quantity: plan?.ticketRules[0]?.quantity ?? config.preferences?.quantity ?? 1,
      allowFallback: plan?.allowFallback ?? config.preferences?.allowFallback ?? true,
      seatPreference: 'ANY_AVAILABLE',
      nonAdjacentFallback: 'SELECT_NON_ADJACENT',
      userProfile: config.userProfile,
    };

    if (!isOnQuestionForm && !isOnPayment) {
      // Discover catalog
      const catalog = await adapter.discoverTicketCatalog();
      const allTickets = catalog.showings.flatMap((s) => s.ticketTypes);
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

    logger.info('Matching ticket detected! Starting booking journey execution...', {
      priorities,
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
        result.finalState === PurchaseState.STOPPED ||
        result.finalState === PurchaseState.FAILED) &&
      result.requiresUserAction
    ) {
      logger.info(`Journey reached target state ${result.finalState}. Halting monitoring loop.`);
      isMonitoringActive = false;
      if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
      }
    }
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('Extension context invalidated')) {
      if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
      }
      return;
    }
    logger.error('Error during booking journey execution in content script', err);
  } finally {
    isExecutingJourney = false;
  }
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
      setTimeout(attemptBookingJourney, 800);
      if (!monitoringTimer) {
        monitoringTimer = window.setInterval(() => {
          if (!isExtensionContextValid()) {
            if (monitoringTimer) {
              clearInterval(monitoringTimer);
              monitoringTimer = null;
            }
            return;
          }
          performDiscoveryScan();
        }, 2000);
      }
    }
  } catch (err: unknown) {
    if (String(err).includes('Extension context invalidated')) return;
    logger.warn('Failed to check rehydration in content script', { err: String(err) });
  }
}

checkRehydration();

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
      scheduleDiscoveryScan(400);
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
      scheduleDiscoveryScan(150);
    }
  };

  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);
  window.setInterval(checkUrlChange, 250);
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
      if (
        stateMachine.state === PurchaseState.FAILED ||
        stateMachine.state === PurchaseState.STOPPED ||
        stateMachine.state === PurchaseState.CONFIRMED ||
        stateMachine.state === PurchaseState.PAYMENT_GATE ||
        stateMachine.state === PurchaseState.HELD ||
        stateMachine.state === PurchaseState.CONSENT_REQUIRED ||
        stateMachine.state === PurchaseState.SEATS_SELECTED ||
        stateMachine.state === PurchaseState.FORM_VALIDATED
      ) {
        try {
          stateMachine.transition({ type: 'RESET_REQUESTED' });
          stateMachine.transition({ type: 'ARM' });
          stateMachine.transition({ type: 'MONITORING_STARTED' });
        } catch {
          // ignore
        }
      }
      isMonitoringActive = true;
      performDiscoveryScan();
      setTimeout(attemptBookingJourney, 400);
      if (!monitoringTimer) {
        monitoringTimer = window.setInterval(() => {
          if (!isExtensionContextValid()) {
            if (monitoringTimer) {
              clearInterval(monitoringTimer);
              monitoringTimer = null;
            }
            return;
          }
          performDiscoveryScan();
        }, 2000);
      }
      break;
    }

    case 'START_MONITORING': {
      logger.info('Content script received START_MONITORING');
      if (
        stateMachine.state === PurchaseState.FAILED ||
        stateMachine.state === PurchaseState.STOPPED ||
        stateMachine.state === PurchaseState.CONFIRMED ||
        stateMachine.state === PurchaseState.PAYMENT_GATE ||
        stateMachine.state === PurchaseState.HELD ||
        stateMachine.state === PurchaseState.CONSENT_REQUIRED ||
        stateMachine.state === PurchaseState.SEATS_SELECTED ||
        stateMachine.state === PurchaseState.FORM_VALIDATED
      ) {
        try {
          stateMachine.transition({ type: 'RESET_REQUESTED' });
          stateMachine.transition({ type: 'ARM' });
          stateMachine.transition({ type: 'MONITORING_STARTED' });
        } catch {
          // ignore
        }
      }
      isMonitoringActive = true;
      performDiscoveryScan();
      setTimeout(attemptBookingJourney, 400);
      if (!monitoringTimer) {
        monitoringTimer = window.setInterval(() => {
          if (!isExtensionContextValid()) {
            if (monitoringTimer) {
              clearInterval(monitoringTimer);
              monitoringTimer = null;
            }
            return;
          }
          performDiscoveryScan();
        }, 2000);
      }
      break;
    }

    case 'STOP_REQUESTED': {
      logger.info('Content script received STOP_REQUESTED');
      isMonitoringActive = false;
      if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
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
      if (
        message &&
        typeof message === 'object' &&
        (message as { type?: string }).type === 'REQUEST_DISCOVERY_SCAN'
      ) {
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
      return undefined;
    }
  );
}