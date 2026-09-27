import { EventBus, MessageHandler } from '../../application/ports/EventBus';
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
        chrome.runtime.sendMessage(message, () => {
          // Ignore errors from missing listeners (e.g. popup closed)
          if (chrome.runtime.lastError) {
            // expected when no popup or external listener is currently open
          }
        });

        // Also broadcast to active tabs where content script might be listening
        if (chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            for (const tab of tabs) {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, message, () => {
                  if (chrome.runtime.lastError) {
                    // expected if tab has no content script
                  }
                });
              }
            }
          });
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
      chrome.runtime.onMessage.addListener((message: unknown) => {
        if (this.isValidMessage(message)) {
          for (const listener of this.inMemoryListeners) {
            try {
              listener(message as ExtensionMessage);
            } catch (err) {
              this.logger?.error('Error in chrome message listener', err);
            }
          }
        } else {
          this.logger?.warn('Ignored invalid message received via chrome.runtime', { message });
        }
      });
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
        return typeof msg['eventUrl'] === 'string' && typeof msg['attemptId'] === 'string';
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
          typeof msg['domSummary'] === 'object' &&
          typeof msg['timingMs'] === 'number'
        );
      case 'JOURNEY_UPDATE':
      case 'REQUEST_DISCOVERY_SCAN':
      case 'STOP_REQUESTED':
      case 'SYNC_STATE_REQUEST':
        return true;
      default:
        return false;
    }
  }
}
