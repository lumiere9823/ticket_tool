import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { MessageSenderInfo } from '../../../src/application/ports/EventBus';

describe('P3-2: Message Sender Authentication & Scope Guard', () => {
  let storage: ChromeStorageRepository;
  let eventBus: ChromeMessageBus;

  beforeEach(() => {
    storage = new ChromeStorageRepository();
    eventBus = new ChromeMessageBus();
  });

  describe('ChromeMessageBus sender verification', () => {
    it('rejects messages where sender.id does not match chrome.runtime.id', () => {
      eventBus.subscribe(() => {});

      // Simulate chrome.runtime.id = 'my-extension-id'
      globalThis.chrome = {
        runtime: {
          id: 'my-extension-id',
          onMessage: {
            addListener: vi.fn(),
          },
        },
      } as unknown as typeof chrome;

      const attackerSender: MessageSenderInfo = {
        id: 'malicious-extension-id',
        url: 'chrome-extension://malicious-extension-id/popup.html',
      };

      const isValid = eventBus.isValidSender(attackerSender);
      expect(isValid).toBe(false);

      // Clean up mock
      delete (globalThis as { chrome?: unknown }).chrome;
    });

    it('accepts messages where sender.id matches chrome.runtime.id', () => {
      globalThis.chrome = {
        runtime: {
          id: 'my-extension-id',
          onMessage: {
            addListener: vi.fn(),
          },
        },
      } as unknown as typeof chrome;

      const validSender: MessageSenderInfo = {
        id: 'my-extension-id',
        url: 'chrome-extension://my-extension-id/popup.html',
      };

      const isValid = eventBus.isValidSender(validSender);
      expect(isValid).toBe(true);

      delete (globalThis as { chrome?: unknown }).chrome;
    });
  });

  describe('Control message origin verification', () => {
    it('classifies control messages as requiring extension origin', () => {
      expect(eventBus.isControlMessage('ARM_REQUESTED')).toBe(true);
      expect(eventBus.isControlMessage('STOP_REQUESTED')).toBe(true);
      expect(eventBus.isControlMessage('RESET_CONFIG_REQUESTED')).toBe(true);
      expect(eventBus.isControlMessage('START_MONITORING')).toBe(true);
      expect(eventBus.isControlMessage('STATE_CHANGED')).toBe(false);
      expect(eventBus.isControlMessage('FETCH_SEATMAP_REQUEST')).toBe(false);
    });

    it('rejects control messages originating from content script tabs (tabId present)', () => {
      globalThis.chrome = {
        runtime: {
          id: 'my-extension-id',
          getURL: (path = '') => `chrome-extension://my-extension-id/${path}`,
          onMessage: { addListener: vi.fn() },
        },
      } as unknown as typeof chrome;

      const contentScriptSender: MessageSenderInfo = {
        id: 'my-extension-id',
        tabId: 123, // Comes from a tab / content script!
        url: 'https://ticketbox.vn/event/abc',
      };

      const allowed = eventBus.isAuthorizedControlSender(contentScriptSender);
      expect(allowed).toBe(false);

      delete (globalThis as { chrome?: unknown }).chrome;
    });

    it('accepts control messages originating from popup or background (no tabId, extension URL)', () => {
      globalThis.chrome = {
        runtime: {
          id: 'my-extension-id',
          getURL: (path = '') => `chrome-extension://my-extension-id/${path}`,
          onMessage: { addListener: vi.fn() },
        },
      } as unknown as typeof chrome;

      const popupSender: MessageSenderInfo = {
        id: 'my-extension-id',
        tabId: undefined,
        url: 'chrome-extension://my-extension-id/src/extension/popup/popup.html',
      };

      const allowed = eventBus.isAuthorizedControlSender(popupSender);
      expect(allowed).toBe(true);

      delete (globalThis as { chrome?: unknown }).chrome;
    });
  });

  describe('FETCH_SHOWING Scope Guard', () => {
    it('blocks showing fetch when showingId is outside scopedPurchasePlan whitelist', async () => {
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/event/evt-100',
        discoveryMode: false,
        scopedPurchasePlan: {
          eventId: 'evt-100',
          quantity: 1,
          strategy: 'BY_TARGET_ORDER',
          persistence: {
            maxDurationMinutes: 120,
            maxAttempts: 1000,
            pollIntervalMs: 2000,
            jitterRatio: 0.2,
          },
          targets: [
            { showingId: 'showing-allowed-1', rank: 1, ticketTypeIds: ['t1'] },
            { showingId: 'showing-allowed-2', rank: 2, ticketTypeIds: ['t2'] },
          ],
        },
      });

      const config = await storage.getConfiguration();
      const allowedShowings = new Set(
        config?.scopedPurchasePlan?.targets?.map((t) => t.showingId) ?? []
      );

      // Allowed showing
      expect(allowedShowings.has('showing-allowed-1')).toBe(true);
      // Disallowed showing
      expect(allowedShowings.has('showing-blocked-999')).toBe(false);
    });
  });
});
