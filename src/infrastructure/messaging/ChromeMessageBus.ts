import { EventBus, MessageHandler } from '../../application/ports/EventBus';
import { ExtensionMessage } from '../../extension/shared/messages';
import { LoggerPort } from '../../application/ports/LoggerPort';

export class ChromeMessageBus implements EventBus {
  private inMemoryListeners: Set<MessageHandler> = new Set();
  private chromeListenerAttached = false;

  constructor(private readonly logger?: LoggerPort) {}

  private isChromeRuntimeAvailable(): boolean {
    return typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';
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
          handler(message as ExtensionMessage);
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
    return typeof msg['type'] === 'string' && typeof msg['timestamp'] === 'string';
  }
}
