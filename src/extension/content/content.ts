import { ChromeMessageBus } from '../../infrastructure/messaging/ChromeMessageBus';
import { TicketboxDiscoveryAdapter } from '../../infrastructure/ticketbox/TicketboxDiscoveryAdapter';
import { SanitizedLogger } from '../../infrastructure/logging/SanitizedLogger';
import { ExtensionMessage } from '../shared/messages';

const logger = new SanitizedLogger({ state: 'CONTENT_SCRIPT' });
const messageBus = new ChromeMessageBus(logger);
const adapter = new TicketboxDiscoveryAdapter(logger);

let isMonitoringActive = false;
let monitoringTimer: number | null = null;

logger.info('Ticketbox Content Script loaded on page', {
  url: window.location.href,
});

/**
 * Periodically observes page metadata in discovery mode without mutating DOM.
 */
async function performDiscoveryScan(): Promise<void> {
  if (!isMonitoringActive) return;

  const eventState = await adapter.getEventState();
  const inventoryState = await adapter.getInventoryState();

  await messageBus.publish({
    type: 'PAGE_DISCOVERY_SNAPSHOT',
    timestamp: new Date().toISOString(),
    url: eventState.pageUrl,
    domSummary: {
      title: eventState.event?.name ?? document.title,
      hasBuyButton: !!document.querySelector('button, .buy-ticket, .btn-buy'),
      ticketElementsCount: inventoryState.candidates.length,
    },
    timingMs: Date.now(),
  });
}

// Handle coordination messages from the Service Worker
messageBus.subscribe((message: ExtensionMessage) => {
  switch (message.type) {
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
