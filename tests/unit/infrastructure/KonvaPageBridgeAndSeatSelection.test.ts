import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { SeatmapApiResponse } from '../../../src/infrastructure/ticketbox/parsing/TicketboxSeatMapParser';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { AdjacentSeatStrategy } from '../../../src/domain/policies/AdjacentSeatStrategy';
import { Seat } from '../../../src/domain/entities/BookingJourneyModels';

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

    it('should never click breadcrumbs, step headings or elements with "chọn vé" and should click enabled continue button', async () => {
      const html = `
        <div id="root">
          <header class="header">
            <div class="step-nav">
              <div role="button" class="step-item active">1. Chọn vé</div>
              <div role="button" class="step-item">2. Thanh toán</div>
            </div>
            <h1>Chọn khu vực</h1>
            <p>Bấm vào khu vực để chọn vé</p>
          </header>
          <div class="seatmap-container">
            <div class="legend"><div>Chọn vé</div></div>
          </div>
          <div class="bottom-bar">
            <button id="btn-continue" class="btn ant-btn-primary">Tiếp tục thanh toán &gt;&gt;</button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      let clickedBtn = false;
      let clickedStepNav = false;

      const continueBtn = root.querySelector('#btn-continue');
      if (continueBtn) {
        (continueBtn as unknown as { click: () => void }).click = () => {
          clickedBtn = true;
        };
      }
      const stepItem = root.querySelector('.step-item');
      if (stepItem) {
        (stepItem as unknown as { click: () => void }).click = () => {
          clickedStepNav = true;
        };
      }

      const success = await adapter.proceedToNextStep();
      expect(success).toBe(true);
      expect(clickedBtn).toBe(true);
      expect(clickedStepNav).toBe(false);
    });

    it('should return false when only non-action elements or disabled buttons exist', async () => {
      const html = `
        <div id="root">
          <div class="breadcrumb"><span>Trang chủ / Chọn vé</span></div>
          <h2>Bấm vào khu vực để chọn vé</h2>
          <button disabled class="btn ant-btn-primary">Tiếp tục</button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      const success = await adapter.proceedToNextStep();
      expect(success).toBe(false);
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

    it('should handle Area Selection Modal stepper and proceed button for area-based seating', async () => {
      let plusClickCount = 0;
      let modalContinueClicked = false;
      let bottomBarContinueClicked = false;

      const html = `
        <div id="booking-container">
          <div class="konvajs-content"><canvas></canvas></div>
          <!-- Ant Design Modal Dialog for Area Selection (e.g. CAT 3 - R) -->
          <div class="ant-modal-content" role="dialog">
            <button aria-label="Close" class="ant-modal-close"><span class="ant-modal-close-x">✕</span></button>
            <div class="ant-modal-header">
              <div class="ant-modal-title">Khu CAT_3R</div>
            </div>
            <div class="ant-modal-body">
              <p>Lưu ý: Bạn chỉ có thể chọn vé trong 1 khu vực</p>
              <div class="ticket-stepper-row">
                <span>CAT 3 - R</span>
                <div class="stepper-controls">
                  <button class="btn-minus" disabled>-</button>
                  <span class="qty-display">0</span>
                  <button class="btn-plus" aria-label="plus">+</button>
                </div>
              </div>
              <div class="info-note">Numbered Seating</div>
              <a href="#" class="link-change-area">Chọn khu vực khác</a>
              <button class="btn-modal-continue" disabled>Vui lòng chọn vé &gt;&gt;</button>
            </div>
          </div>
          <div class="bottom-bar">
            <button id="btn-continue" class="btn ant-btn-primary" disabled>Vui lòng chọn vé &gt;&gt;</button>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);

      // Attach mock click handlers
      const plusBtn = root.querySelector('.btn-plus') as unknown as { click: () => void };
      const modalContinueBtn = root.querySelector('.btn-modal-continue') as unknown as {
        click: () => void;
        textContent: string;
        removeAttribute: (attr: string) => void;
      };
      const bottomBarBtn = root.querySelector('#btn-continue') as unknown as {
        click: () => void;
        textContent: string;
        removeAttribute: (attr: string) => void;
      };
      const qtyDisplay = root.querySelector('.qty-display') as unknown as { textContent: string };

      plusBtn.click = () => {
        plusClickCount++;
        qtyDisplay.textContent = String(plusClickCount);
        modalContinueBtn.textContent = `Tiếp tục - ${plusClickCount * 820000} đ >>`;
        modalContinueBtn.removeAttribute('disabled');
        bottomBarBtn.textContent = `Tiếp tục - ${plusClickCount * 820000} đ >>`;
        bottomBarBtn.removeAttribute('disabled');
      };

      modalContinueBtn.click = () => {
        modalContinueClicked = true;
      };

      bottomBarBtn.click = () => {
        bottomBarContinueClicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);

      const qtySuccess = await adapter.selectQuantity(
        {
          id: '1086284',
          name: 'CAT 3 - R',
          price: { amount: 820000, currency: 'VND' },
          mode: 'SEATED',
          availability: 'AVAILABLE',
          minQuantity: 1,
          maxQuantity: 4,
          selectedQuantity: 0,
          selectable: true,
          source: { page: 'BOOKING', evidence: [] },
        },
        2
      );

      expect(qtySuccess).toBe(true);
      expect(plusClickCount).toBe(2);
      expect(qtyDisplay.textContent).toBe('2');

      const proceedSuccess = await adapter.proceedToNextStep();
      expect(proceedSuccess).toBe(true);
      expect(modalContinueClicked || bottomBarContinueClicked).toBe(true);
    });

    it('should detect -1242 seat unavailable error modal, blacklist seat, and click Chọn ghế khác', async () => {
      let changeSeatClicked = false;
      const html = `
        <div id="booking-container">
          <div class="ant-modal-content" role="dialog">
            <div class="ant-modal-header">
              <div class="ant-modal-title">Uiii, Xin lỗi!</div>
            </div>
            <div class="ant-modal-body">
              <p>(-1242) Ghế bạn chọn VIP_A-21 đã được đặt trước</p>
            </div>
            <div class="ant-modal-footer">
              <button class="ant-btn ant-btn-primary"><span>Chọn ghế khác</span></button>
            </div>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const actionBtn = root.querySelector('.ant-btn-primary') as unknown as {
        click: () => void;
      };
      actionBtn.click = () => {
        changeSeatClicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);
      const errorResult = await adapter.detectAndHandleErrorModal();

      expect(errorResult.hasError).toBe(true);
      expect(errorResult.isSeatUnavailable).toBe(true);
      expect(errorResult.seatLabel).toBe('VIP_A-21');
      expect(changeSeatClicked).toBe(true);
      expect(adapter.isSeatBlacklisted('VIP_A-21')).toBe(true);
      expect(adapter.isSeatBlacklisted('VIP_A21')).toBe(true);
    });

    it('should ensure AdjacentSeatStrategy ignores blacklisted seats and selects alternate available seat', () => {
      const seats: Seat[] = [
        {
          id: 'seat-1',
          label: 'VIP_A-21',
          row: 'A',
          number: 21,
          status: 'AVAILABLE',
          selectable: true,
          price: 2400000,
          area: 'area-vip',
          areaId: 'area-vip',
        },
        {
          id: 'seat-2',
          label: 'VIP_A-22',
          row: 'A',
          number: 22,
          status: 'AVAILABLE',
          selectable: true,
          price: 2400000,
          area: 'area-vip',
          areaId: 'area-vip',
        },
      ];

      const blacklisted = new Set<string>(['VIPA21']);
      const decision = AdjacentSeatStrategy.selectSeats(
        seats,
        1,
        'area-vip',
        'ANY_AVAILABLE',
        'SELECT_NON_ADJACENT',
        blacklisted
      );

      expect(decision.status).toBe('SUCCESS');
      expect(decision.selectedSeats.length).toBe(1);
      expect(decision.selectedSeats[0]!.id).toBe('seat-2');
      expect(decision.selectedSeats[0]!.label).toBe('VIP_A-22');
    });
  });
});
