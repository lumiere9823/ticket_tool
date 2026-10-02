/**
 * Page Bridge Client
 *
 * Dispatches postMessage requests to the Main-World page bridge
 * and awaits authenticated nonce-verified responses.
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import {
  BridgeRequestMessage,
  generateBridgeNonce,
  generateBridgeRequestId,
  getSafeBridgeTargetOrigin,
  isValidBridgeResponse,
} from '../../../extension/shared/BridgeProtocol';

export class PageBridgeClient {
  private bridgeNonce: string = generateBridgeNonce();

  constructor(private readonly logger?: LoggerPort) {}

  public getBridgeNonce(): string {
    return this.bridgeNonce;
  }

  public setBridgeNonce(nonce: string): void {
    this.bridgeNonce = nonce;
  }

  public async sendPageBridgeRequest<T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 3500
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    if (typeof window === 'undefined') {
      return { success: false, error: 'NO_WINDOW' };
    }

    const targetOrigin = getSafeBridgeTargetOrigin();
    if (!targetOrigin) {
      this.logger?.warn('Bridge request rejected: origin is invalid or untrusted');
      return { success: false, error: 'INVALID_ORIGIN' };
    }

    const requestId = generateBridgeRequestId();

    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('message', onMessage);
        }
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ success: false, error: 'TIMEOUT' });
        }
      }, timeoutMs);

      const onMessage = (event: MessageEvent) => {
        if (
          event.source === window &&
          isValidBridgeResponse(event.data) &&
          event.data.requestId === requestId &&
          event.data.nonce === this.bridgeNonce
        ) {
          if (
            typeof window !== 'undefined' &&
            window.location?.origin &&
            window.location.origin !== 'null' &&
            event.origin &&
            event.origin !== window.location.origin
          ) {
            this.logger?.warn('Bridge response ignored due to origin mismatch', {
              expectedOrigin: window.location.origin,
              receivedOrigin: event.origin,
            });
            return;
          }

          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            cleanup();
            resolve(event.data as { success: boolean; data?: T; error?: string });
          }
        }
      };

      window.addEventListener('message', onMessage);

      const message: BridgeRequestMessage = {
        source: 'TICKETBOX_ASSISTANT_CONTENT',
        type: action,
        requestId,
        nonce: this.bridgeNonce,
        payload,
      };

      window.postMessage(message, targetOrigin);
    });
  }
}
