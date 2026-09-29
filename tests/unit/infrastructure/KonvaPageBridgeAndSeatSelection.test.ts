import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { SeatmapApiResponse } from '../../../src/infrastructure/ticketbox/parsing/TicketboxSeatMapParser';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';

const MOCK_SEATMAP: SeatmapApiResponse = {
  status: 1,
  message: 'Success',
  data: {
    result: {
      id: 900,
      name: 'Test Seatmap',
      status: 0,
      sections: [
        {
          id: 13308,
          seatMapId: 900,
          name: 'VIP_ZONE',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091993,
            name: 'VIP Ticket',
            price: 2400000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
          rows: [
            {
              id: 49605,
              sectionId: 13308,
              name: 'L',
              seats: [
                { id: 696628, rowId: 49605, name: '28', status: 1, x: 250.0, y: 320.0 },
                { id: 696629, rowId: 49605, name: '29', status: 1, x: 260.0, y: 320.0 },
              ],
            },
          ],
        },
      ],
    },
  },
};

describe('Konva Page Bridge & Canvas Seat Selection', () => {
  let logger: SanitizedLogger;

  beforeEach(() => {
    logger = new SanitizedLogger({ state: 'TEST' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendPageBridgeRequest', () => {
    it('should return NO_WINDOW when global window is undefined', async () => {
      const adapter = new TicketboxJourneyAdapter(logger);
      // In node env without mocking window as any
      const origWindow = globalThis.window;
      // @ts-expect-error test simulation
      delete globalThis.window;

      const res = await adapter.sendPageBridgeRequest('TEST', {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('NO_WINDOW');

      globalThis.window = origWindow;
    });

    it('should communicate via window.postMessage and receive response', async () => {
      const listeners: Record<string, ((ev: unknown) => void)[]> = {};

      const fakeWindow = {
        addEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
        removeEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
        },
        postMessage: (data: Record<string, unknown>) => {
          if (data && data.source === 'TICKETBOX_ASSISTANT_CONTENT') {
            const requestId = data.requestId;
            const handlers = listeners['message'] || [];
            for (const h of handlers) {
              h({
                source: fakeWindow,
                data: {
                  source: 'TICKETBOX_ASSISTANT_PAGE',
                  type: `${data.type}_RESPONSE`,
                  requestId,
                  success: true,
                  data: { ok: true },
                },
              });
            }
          }
        },
        dispatchEvent: () => true,
      };

      const origWindow = globalThis.window;
      // @ts-expect-error test mock
      globalThis.window = fakeWindow;

      const adapter = new TicketboxJourneyAdapter(logger);
      const res = await adapter.sendPageBridgeRequest<{ ok: boolean }>('TEST_ACTION', {
        foo: 'bar',
      });

      expect(res.success).toBe(true);
      expect(res.data?.ok).toBe(true);

      globalThis.window = origWindow;
    });

    it('should timeout gracefully when no response is received', async () => {
      const fakeWindow = {
        addEventListener: () => {},
        removeEventListener: () => {},
        postMessage: () => {},
        dispatchEvent: () => true,
      };

      const origWindow = globalThis.window;
      // @ts-expect-error test mock
      globalThis.window = fakeWindow;

      const adapter = new TicketboxJourneyAdapter(logger);
      const res = await adapter.sendPageBridgeRequest('TIMEOUT_ACTION', {}, 100);

      expect(res.success).toBe(false);
      expect(res.error).toBe('TIMEOUT');

      globalThis.window = origWindow;
    });
  });

  describe('selectArea with Page Bridge & Konva', () => {
    it('should select area via Page Bridge when DOM element is missing (Canvas Seated Flow)', async () => {
      const listeners: Record<string, ((ev: unknown) => void)[]> = {};
      let bridgeCalledWithAreaId: string | null = null;

      const fakeWindow = {
        location: {
          href: 'https://ticketbox.vn/events/26578/bookings/81077997936830/select-ticket',
        },
        addEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
        removeEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
        },
        postMessage: (data: Record<string, unknown>) => {
          if (
            data &&
            data.source === 'TICKETBOX_ASSISTANT_CONTENT' &&
            data.type === 'SELECT_AREA'
          ) {
            const payload = data.payload as { areaId: string };
            bridgeCalledWithAreaId = payload.areaId;
            const handlers = listeners['message'] || [];
            for (const h of handlers) {
              h({
                source: fakeWindow,
                data: {
                  source: 'TICKETBOX_ASSISTANT_PAGE',
                  type: 'SELECT_AREA_RESPONSE',
                  requestId: data.requestId,
                  success: true,
                  data: { transitioned: true },
                },
              });
            }
          }
        },
        dispatchEvent: () => true,
      };

      const origWindow = globalThis.window;
      // @ts-expect-error test mock
      globalThis.window = fakeWindow;

      const html = `<div id="booking-container"><div class="konvajs-content"><canvas></canvas></div></div>`;
      const root = parseHtmlToDOMElementLike(html);

      const adapter = new TicketboxJourneyAdapter(logger, root);
      const success = await adapter.selectArea('13308');

      expect(success).toBe(true);
      expect(bridgeCalledWithAreaId).toBe('13308');

      globalThis.window = origWindow;
    });

    it('should fallback cleanly to DOM area button when present', async () => {
      const html = `
        <div id="booking-container">
          <button data-zone-id="zone-vip" class="area-item">VIP ZONE</button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      const success = await adapter.selectArea('zone-vip');
      expect(success).toBe(true);

      const btn = root.querySelector('[data-zone-id="zone-vip"]');
      expect(btn?.getAttribute('data-status')).toBe('selected');
    });
  });

  describe('selectSpecificSeats with Page Bridge & Konva', () => {
    it('should select seats via Page Bridge and update cached seat status', async () => {
      const listeners: Record<string, ((ev: unknown) => void)[]> = {};
      let bridgeSelectedSeats: unknown[] = [];

      const fakeWindow = {
        location: {
          href: 'https://ticketbox.vn/events/26578/bookings/81077997936830/select-ticket',
        },
        addEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
        removeEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
        },
        postMessage: (data: Record<string, unknown>) => {
          if (
            data &&
            data.source === 'TICKETBOX_ASSISTANT_CONTENT' &&
            data.type === 'SELECT_SEATS'
          ) {
            const payload = data.payload as { seats: unknown[] };
            bridgeSelectedSeats = payload.seats;
            const handlers = listeners['message'] || [];
            for (const h of handlers) {
              h({
                source: fakeWindow,
                data: {
                  source: 'TICKETBOX_ASSISTANT_PAGE',
                  type: 'SELECT_SEATS_RESPONSE',
                  requestId: data.requestId,
                  success: true,
                  data: { selectedCount: payload.seats.length },
                },
              });
            }
          }
        },
        dispatchEvent: () => true,
      };

      const origWindow = globalThis.window;
      // @ts-expect-error test mock
      globalThis.window = fakeWindow;

      const html = `<div id="booking-container"><div class="konvajs-content"><canvas></canvas></div></div>`;
      const root = parseHtmlToDOMElementLike(html);

      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setSeatmapData(MOCK_SEATMAP);
      await adapter.discoverSeats('13308');

      const success = await adapter.selectSpecificSeats(['696628']);
      expect(success).toBe(true);
      expect(bridgeSelectedSeats.length).toBe(1);

      const seats = await adapter.discoverSeats('13308');
      const selected = seats.find((s) => s.id === '696628');
      expect(selected?.status).toBe('SELECTED');

      globalThis.window = origWindow;
    });
  });

  describe('proceedToNextStep button selection', () => {
    it('should click enabled "Tiếp tục >>" button and avoid disabled prompt button', async () => {
      const html = `
        <div id="booking-container">
          <div class="bottom-bar">
            <button class="btn ant-btn disabled" disabled>Vui lòng chọn vé &gt;&gt;</button>
            <button id="btn-continue" class="btn ant-btn-primary">Tiếp tục &gt;&gt;</button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      let clicked = false;
      const targetBtn = root.querySelector('#btn-continue');
      if (targetBtn) {
        (targetBtn as unknown as { click: () => void }).click = () => {
          clicked = true;
        };
      }

      const success = await adapter.proceedToNextStep();
      expect(success).toBe(true);
      expect(clicked).toBe(true);
    });
  });

  describe('Complete Journey Execution on Seated /select-ticket', () => {
    it('should transition smoothly through seated flow to next step', async () => {
      const listeners: Record<string, ((ev: unknown) => void)[]> = {};

      const fakeWindow = {
        location: {
          href: 'https://ticketbox.vn/events/26578/bookings/81077997936830/select-ticket',
        },
        addEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
        removeEventListener: (event: string, handler: (ev: unknown) => void) => {
          listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
        },
        postMessage: (data: Record<string, unknown>) => {
          if (data && data.source === 'TICKETBOX_ASSISTANT_CONTENT') {
            const handlers = listeners['message'] || [];
            let resData = {};
            if (data.type === 'SELECT_AREA') {
              resData = { transitioned: true };
            } else if (data.type === 'SELECT_SEATS') {
              resData = { selectedCount: 1 };
            }
            for (const h of handlers) {
              h({
                source: fakeWindow,
                data: {
                  source: 'TICKETBOX_ASSISTANT_PAGE',
                  type: `${data.type}_RESPONSE`,
                  requestId: data.requestId,
                  success: true,
                  data: resData,
                },
              });
            }
          }
        },
        dispatchEvent: () => true,
      };

      const origWindow = globalThis.window;
      // @ts-expect-error test mock
      globalThis.window = fakeWindow;

      const html = `
        <div id="booking-container">
          <h1 class="event-title">Concert Anh Trai Vượt Ngàn Chông Gai</h1>
          <div class="showing-name">Đêm diễn 1</div>
          <div class="ticket-row" data-ticket-id="1091993">
            <span class="ticket-name">VIP Ticket</span>
            <span class="ticket-price">2.400.000 đ</span>
          </div>
          <div class="konvajs-content"><canvas></canvas></div>
          <div class="bottom-bar">
            <button id="btn-continue" class="btn ant-btn-primary">Tiếp tục &gt;&gt;</button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setSeatmapData(MOCK_SEATMAP);

      const stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING);
      const messageBus = new ChromeMessageBus(logger);
      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, messageBus, logger);

      const result = await useCase.execute({
        categoryPriority: ['VIP Ticket'],
        quantity: 1,
        allowFallback: false,
        seatPreference: 'ANY_AVAILABLE',
        nonAdjacentFallback: 'SELECT_NON_ADJACENT',
      });

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.SEATS_SELECTED);
      expect(result.selection?.seats).toContain('L28');

      globalThis.window = origWindow;
    });
  });
});
