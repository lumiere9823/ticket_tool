import { ChromeMessageBus } from '../../infrastructure/messaging/ChromeMessageBus';
import { TicketboxJourneyAdapter } from '../../infrastructure/ticketbox/TicketboxJourneyAdapter';
import { SanitizedLogger } from '../../infrastructure/logging/SanitizedLogger';
import { ExtensionMessage } from '../shared/messages';

const logger = new SanitizedLogger({ state: 'CONTENT_SCRIPT' });
const messageBus = new ChromeMessageBus(logger);
const adapter = new TicketboxJourneyAdapter(logger);

let isMonitoringActive = false;
let monitoringTimer: number | null = null;
let debounceTimer: number | null = null;

logger.info('Ticketbox Content Script loaded on page', {
  url: window.location.href,
});

/**
 * Periodically or reactively observes page metadata and publishes snapshots and journey updates.
 * Passive discovery scan does not mutate page state (strictly Phase 8 / safe architecture compliant).
 */
async function performDiscoveryScan(): Promise<void> {
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
          | 'AVAILABLE'
          | 'SOLD_OUT'
          | 'OFFLINE_SALE'
          | 'NOT_STARTED'
          | 'CLOSED'
          | 'UNKNOWN',
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

    // Cache in chrome.storage.local for instant popup display on re-open
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ latestJourneyUpdate: journeyUpdate });
    }

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
  } catch (err) {
    logger.error('Error during discovery scan in content script', err);
  }
}

function scheduleDiscoveryScan(delayMs = 300): void {
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

// Set up MutationObserver to re-scan when client-side React mounts tickets
if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver((mutations) => {
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

// Handle coordination messages from the Service Worker and Popup
messageBus.subscribe((message: ExtensionMessage) => {
  switch (message.type) {
    case 'REQUEST_DISCOVERY_SCAN': {
      logger.info('Content script received REQUEST_DISCOVERY_SCAN');
      performDiscoveryScan();
      break;
    }

    case 'START_MONITORING': {
      logger.info('Content script received START_MONITORING');
      isMonitoringActive = true;
      performDiscoveryScan();
      if (!monitoringTimer) {
        monitoringTimer = window.setInterval(performDiscoveryScan, 3000);
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

