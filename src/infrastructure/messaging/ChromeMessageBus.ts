import { EventBus, MessageHandler, MessageSenderInfo } from '../../application/ports/EventBus';
import { ExtensionMessage } from '../../extension/shared/messages';
import { LoggerPort } from '../../application/ports/LoggerPort';

const VALID_MESSAGE_TYPES = new Set<string>([
  'STATE_CHANGED',
  'ARM_REQUESTED',
  'START_MONITORING',
  'STOP_REQUESTED',
  'AVAILABILITY_DETECTED',
  'SELECTION_STARTED',
  'RESERVATION_STARTED',
  'RESERVATION_CONFIRMED',
  'RESERVATION_FAILED',
  'HUMAN_INTERVENTION_REQUIRED',
  'USER_COMPLETED_INTERVENTION',
  'NOTIFICATION_EVENT',
  'PAGE_DISCOVERY_SNAPSHOT',
  'SYNC_STATE_REQUEST',
  'SYNC_STATE_RESPONSE',
  'JOURNEY_UPDATE',
  'REQUEST_DISCOVERY_SCAN',
  'FETCH_SEATMAP_REQUEST',
  'FETCH_SEATMAP_RESPONSE',
  'FETCH_SHOWING_REQUEST',
  'FETCH_SHOWING_RESPONSE',
  'RESET_CONFIG_REQUESTED',
  'RESET_CONFIG_DONE',
  'SCHEDULED_ARM_CONFIRMED',
  'CANCEL_SCHEDULED_ARM',
  'HEARTBEAT_PING',
]);

export class ChromeMessageBus implements EventBus {
  private inMemoryListeners: Set<MessageHandler> = new Set();
  private chromeListenerAttached = false;

  constructor(private readonly logger?: LoggerPort) {}

  private isChromeRuntimeAvailable(): boolean {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.runtime !== 'undefined' &&
      Boolean(chrome.runtime.id)
    );
  }

  public async publish(message: ExtensionMessage): Promise<void> {
    this.validateMessage(message);

    // 1. Notify local in-memory subscribers
    for (const handler of this.inMemoryListeners) {
      try {
        handler(message);
      } catch (err) {
        this.logger?.error('Error in in-memory message handler', err);
      }
    }

    // 2. Broadcast across Chrome runtime and active tabs if available
    if (this.isChromeRuntimeAvailable()) {
      try {
        // Broadcast across Chrome runtime (service worker, popup)
        chrome.runtime.sendMessage(message, () => {
          if (chrome.runtime.lastError) {
            // expected when no popup or external listener is currently open
          }
        });

        // Route message to specific target tab or active tab (no broadcast to all Ticketbox tabs)
        if (chrome.tabs) {
          if (typeof message.targetTabId === 'number') {
            chrome.tabs.sendMessage(message.targetTabId, message, () => {
              if (chrome.runtime.lastError) {
                // expected if tab has no content script or is not ready
              }
            });
          } else if (chrome.tabs.query) {
            // Target only the single active tab in the current window (never query all Ticketbox tabs)
            chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
              const activeTab = activeTabs?.[0];
              if (activeTab?.id) {
                chrome.tabs.sendMessage(activeTab.id, message, () => {
                  if (chrome.runtime.lastError) {
                    // expected if tab has no content script or is not ready
                  }
                });
              }
            });
          }
        }
      } catch (err) {
        this.logger?.debug('Chrome runtime message broadcast skipped', { err });
      }
    }
  }

  public subscribe(handler: MessageHandler): () => void {
    this.inMemoryListeners.add(handler);

    // Attach Chrome runtime listener once
    if (this.isChromeRuntimeAvailable() && !this.chromeListenerAttached) {
      this.chromeListenerAttached = true;
      chrome.runtime.onMessage.addListener(
        (message: unknown, sender?: chrome.runtime.MessageSender) => {
          if (this.isValidMessage(message)) {
            const senderInfo: MessageSenderInfo | undefined = sender
              ? {
                  tabId: sender.tab?.id,
                  frameId: sender.frameId,
                  id: sender.id,
                  url: sender.url,
                  origin: sender.origin,
                }
              : undefined;
            for (const listener of this.inMemoryListeners) {
              try {
                listener(message as ExtensionMessage, senderInfo);
              } catch (err) {
                this.logger?.error('Error in chrome message listener', err);
              }
            }
          } else {
            const msgType = (message as Record<string, unknown>)?.type;
            if (typeof msgType === 'string' && VALID_MESSAGE_TYPES.has(msgType)) {
              this.logger?.warn('Ignored invalid message received via chrome.runtime', {
                type: msgType,
                message,
              });
            }
          }
        }
      );
    }

    return () => this.inMemoryListeners.delete(handler);
  }

  public validateMessage(message: unknown): asserts message is ExtensionMessage {
    if (!this.isValidMessage(message)) {
      throw new Error(`Invalid message format: missing required fields or unknown type`);
    }
  }

  public isValidMessage(message: unknown): message is ExtensionMessage {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const msg = message as Record<string, unknown>;
    if (typeof msg['type'] !== 'string' || typeof msg['timestamp'] !== 'string') {
      return false;
    }
    if (!VALID_MESSAGE_TYPES.has(msg['type'])) {
      return false;
    }

    switch (msg['type']) {
      case 'STATE_CHANGED':
      case 'SYNC_STATE_RESPONSE':
        return typeof msg['context'] === 'object' && msg['context'] !== null;
      case 'ARM_REQUESTED':
        return (
          typeof msg['eventUrl'] === 'string' &&
          Array.isArray(msg['categoryPriority']) &&
          typeof msg['quantity'] === 'number'
        );
      case 'START_MONITORING':
        return typeof msg['eventUrl'] === 'string' || typeof msg['targetEventUrl'] === 'string';
      case 'AVAILABILITY_DETECTED':
        return (
          Array.isArray(msg['candidates']) &&
          typeof msg['observedAt'] === 'string' &&
          typeof msg['isAuthoritativeT0'] === 'boolean'
        );
      case 'SELECTION_STARTED':
        return typeof msg['candidate'] === 'object' && msg['candidate'] !== null;
      case 'RESERVATION_STARTED':
        return (
          typeof msg['candidate'] === 'object' &&
          msg['candidate'] !== null &&
          typeof msg['quantity'] === 'number'
        );
      case 'RESERVATION_CONFIRMED':
        return (
          typeof msg['reservationId'] === 'string' &&
          (msg['reservationId'] as string).trim().length > 0
        );
      case 'RESERVATION_FAILED':
        return typeof msg['reason'] === 'string' && typeof msg['canRetry'] === 'boolean';
      case 'HUMAN_INTERVENTION_REQUIRED':
        return (
          typeof msg['challengeType'] === 'string' &&
          typeof msg['interventionId'] === 'string' &&
          typeof msg['instructions'] === 'string'
        );
      case 'USER_COMPLETED_INTERVENTION':
        return typeof msg['interventionId'] === 'string';
      case 'NOTIFICATION_EVENT':
        return (
          typeof msg['title'] === 'string' &&
          typeof msg['body'] === 'string' &&
          typeof msg['category'] === 'string'
        );
      case 'PAGE_DISCOVERY_SNAPSHOT':
        return (
          typeof msg['url'] === 'string' &&
          (msg['domSummary'] === undefined ||
            (typeof msg['domSummary'] === 'object' && msg['domSummary'] !== null)) &&
          typeof msg['timingMs'] === 'number'
        );
      case 'JOURNEY_UPDATE':
      case 'REQUEST_DISCOVERY_SCAN':
      case 'STOP_REQUESTED':
      case 'SYNC_STATE_REQUEST':
      case 'RESET_CONFIG_REQUESTED':
      case 'RESET_CONFIG_DONE':
      case 'CANCEL_SCHEDULED_ARM':
      case 'HEARTBEAT_PING':
        return true;
      case 'SCHEDULED_ARM_CONFIRMED':
        return typeof msg['scheduledAt'] === 'string';
      case 'FETCH_SEATMAP_REQUEST':
        return typeof msg['showingId'] === 'string';
      case 'FETCH_SEATMAP_RESPONSE':
        return typeof msg['showingId'] === 'string' && typeof msg['success'] === 'boolean';
      case 'FETCH_SHOWING_REQUEST':
        return typeof msg['showingId'] === 'string';
      case 'FETCH_SHOWING_RESPONSE':
        return typeof msg['showingId'] === 'string' && typeof msg['success'] === 'boolean';
      default:
        return false;
    }
  }
}
