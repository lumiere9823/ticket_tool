import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { ExtensionMessage } from '../../../src/extension/shared/messages';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { extractEventIdFromUrl } from '../../../src/domain/entities/ScopedPurchasePlan';
import {
  handleServiceWorkerMessage,
  getMirroredJourneyContext,
  resetMirroredJourneyContext,
} from '../../../src/extension/background/service-worker';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { StartMonitoringUseCase } from '../../../src/application/use-cases/StartMonitoringUseCase';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { EventBus } from '../../../src/application/ports/EventBus';

describe('P1-6: Scoped Configuration to Tab & Event', () => {
  describe('extractEventIdFromUrl Authoritative Parser', () => {
    it('should extract event ID from trailing slug format', () => {
      expect(extractEventIdFromUrl('https://ticketbox.vn/events/nhac-hoi-mua-thu-12345')).toBe(
        '12345'
      );
      expect(
        extractEventIdFromUrl('https://ticketbox.vn/events/rock-concert-998877?ref=home')
      ).toBe('998877');
      expect(extractEventIdFromUrl('https://ticketbox.vn/event-54321/select-ticket')).toBe('54321');
    });

    it('should extract event ID from /events/:id or /event/:id route format', () => {
      expect(extractEventIdFromUrl('https://ticketbox.vn/events/conan-movie-premiere')).toBe(
        'conan-movie-premiere'
      );
      expect(extractEventIdFromUrl('https://ticketbox.vn/event/special-show-2026/booking')).toBe(
        '2026'
      );
      expect(extractEventIdFromUrl('https://ticketbox.vn/event/special-gala/booking')).toBe(
        'special-gala'
      );
    });

    it('should return null for non-event or stray URLs', () => {
      expect(extractEventIdFromUrl('')).toBeNull();
      expect(extractEventIdFromUrl('https://ticketbox.vn/')).toBeNull();
      expect(extractEventIdFromUrl('https://ticketbox.vn/home')).toBeNull();
      expect(extractEventIdFromUrl('https://ticketbox.vn/my-tickets')).toBeNull();
    });
  });

  describe('ChromeMessageBus targeted routing (no broadcast to all Ticketbox tabs)', () => {
    let sendMessageMock: ReturnType<typeof vi.fn>;
    let queryMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      sendMessageMock = vi.fn();
      queryMock = vi.fn();
      vi.stubGlobal('chrome', {
        runtime: {
          id: 'test-ext-id',
          sendMessage: vi.fn(),
          lastError: null,
        },
        tabs: {
          sendMessage: sendMessageMock,
          query: queryMock,
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should route message exclusively to targetTabId when targetTabId is specified', async () => {
      const bus = new ChromeMessageBus();
      const message: ExtensionMessage = {
        type: 'ARM_REQUESTED',
        timestamp: new Date().toISOString(),
        eventUrl: 'https://ticketbox.vn/event-101',
        categoryPriority: ['VIP'],
        quantity: 2,
        targetTabId: 101,
      };

      await bus.publish(message);

      // Verify that tabs.query was NOT called to fetch all Ticketbox tabs
      expect(queryMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ url: '*://*.ticketbox.vn/*' }),
        expect.anything()
      );

      // Verify tabs.sendMessage was called ONLY with targetTabId 101
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock).toHaveBeenCalledWith(101, message, expect.any(Function));
    });

    it('should send only to the active tab when targetTabId is not explicitly specified, never broadcasting to all Ticketbox tabs', async () => {
      queryMock.mockImplementation((filter, cb) => {
        if (filter.active && filter.currentWindow) {
          cb([{ id: 202 }]);
        }
      });

      const bus = new ChromeMessageBus();
      const message: ExtensionMessage = {
        type: 'START_MONITORING',
        timestamp: new Date().toISOString(),
        eventUrl: 'https://ticketbox.vn/event-202',
        attemptId: 'att-202',
      };

      await bus.publish(message);

      // Must never broadcast to all Ticketbox tabs
      expect(queryMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ url: '*://*.ticketbox.vn/*' }),
        expect.anything()
      );

      // Sent to the single active tab
      expect(sendMessageMock).toHaveBeenCalledWith(202, message, expect.any(Function));
    });
  });

  describe('Storage Scoped Attributes Persistence', () => {
    it('should persist and retrieve armedTabId and armedEventId in configuration', async () => {
      const storage = new ChromeStorageRepository();
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/events/music-concert-998877',
        discoveryMode: false,
        armedTabId: 555,
        armedEventId: '998877',
      });

      const config = await storage.getConfiguration();
      expect(config?.armedTabId).toBe(555);
      expect(config?.armedEventId).toBe('998877');
    });

    it('should persist and retrieve armedTabId and armedEventId in persistent execution state', async () => {
      const storage = new ChromeStorageRepository();
      await storage.savePersistentState({
        startedAt: new Date().toISOString(),
        attemptsCount: 3,
        currentPhase: 'ARMED',
        armedTabId: 777,
        armedEventId: 'event-777',
      });

      const pState = await storage.getPersistentState();
      expect(pState?.armedTabId).toBe(777);
      expect(pState?.armedEventId).toBe('event-777');
      expect(pState?.currentPhase).toBe('ARMED');
    });
  });

  describe('Service Worker Tab-Isolation Guard on STATE_CHANGED', () => {
    let setBadgeTextMock = vi.fn();
    let setBadgeBackgroundColorMock = vi.fn();
    let localStore: Record<string, unknown> = {};

    beforeEach(() => {
      localStore = {};
      setBadgeTextMock = vi.fn();
      setBadgeBackgroundColorMock = vi.fn();
      vi.stubGlobal('chrome', {
        runtime: { id: 'test-extension-id' },
        storage: {
          local: {
            get: vi.fn((keys: unknown, cb: (res: Record<string, unknown>) => void) => {
              if (typeof keys === 'string') {
                cb({ [keys]: localStore[keys] });
              } else if (Array.isArray(keys)) {
                const res: Record<string, unknown> = {};
                for (const k of keys) res[k] = localStore[k];
                cb(res);
              } else {
                cb({ ...localStore });
              }
            }),
            set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
              Object.assign(localStore, items);
              if (cb) cb();
            }),
            remove: vi.fn((keys: string | string[], cb?: () => void) => {
              const arr = Array.isArray(keys) ? keys : [keys];
              for (const k of arr) delete localStore[k];
              if (cb) cb();
            }),
          },
        },
        action: {
          setBadgeText: setBadgeTextMock,
          setBadgeBackgroundColor: setBadgeBackgroundColorMock,
        },
      });
      resetMirroredJourneyContext();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should reject STATE_CHANGED from an un-armed tab when armedTabId is configured', async () => {
      const storage = new ChromeStorageRepository();
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/events/concert-123',
        discoveryMode: false,
        armedTabId: 100, // Armed exclusively for tab 100
        armedEventId: '123',
      });

      // Message arrives from tab 200 (un-armed stray tab)
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.PAYMENT_GATE,
            attemptId: 'att-stray',
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'test-extension-id', frameId: 0, tabId: 200 }
      );

      // Badge should NOT be updated because sender tab is not the armed tab
      expect(setBadgeTextMock).not.toHaveBeenCalled();
      expect(getMirroredJourneyContext()).toBeNull();
    });

    it('should accept STATE_CHANGED from the armed tab', async () => {
      const storage = new ChromeStorageRepository();
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/events/concert-123',
        discoveryMode: false,
        armedTabId: 100, // Armed exclusively for tab 100
        armedEventId: '123',
      });

      // Message arrives from tab 100 (the authorized armed tab)
      await handleServiceWorkerMessage(
        {
          type: 'STATE_CHANGED',
          timestamp: new Date().toISOString(),
          context: {
            currentState: PurchaseState.PAYMENT_GATE,
            attemptId: 'att-authorized',
            updatedAt: new Date().toISOString(),
          },
        },
        { id: 'test-extension-id', frameId: 0, tabId: 100 }
      );

      // Badge SHOULD be updated
      expect(setBadgeTextMock).toHaveBeenCalledWith({ text: 'BUY' });
      expect(getMirroredJourneyContext()?.currentState).toBe(PurchaseState.PAYMENT_GATE);
    });
  });

  describe('StartMonitoringUseCase Scoped Tab & Event Propagation', () => {
    it('should propagate targetTabId and targetEventId when starting monitoring', async () => {
      const sm = new PurchaseStateMachine(PurchaseState.ARMED);
      const storage = new ChromeStorageRepository();
      const publishedMessages: ExtensionMessage[] = [];
      const bus: EventBus = {
        publish: async (msg: ExtensionMessage) => {
          publishedMessages.push(msg);
        },
        subscribe: vi.fn(),
      };

      const useCase = new StartMonitoringUseCase(sm, storage, bus);
      await useCase.execute('https://ticketbox.vn/events/concert-999', 888, 'concert-999');

      expect(publishedMessages.length).toBe(2);
      const startMsg = publishedMessages[0];
      expect(startMsg?.type).toBe('START_MONITORING');
      expect(startMsg?.targetTabId).toBe(888);
      expect(startMsg?.targetEventId).toBe('concert-999');

      const stateMsg = publishedMessages[1];
      expect(stateMsg?.type).toBe('STATE_CHANGED');
      expect(stateMsg?.targetTabId).toBe(888);
      expect(stateMsg?.targetEventId).toBe('concert-999');
    });
  });
});
