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
import {
  Seat,
  SeatArea,
  JourneyTicketType,
} from '../../../src/domain/entities/BookingJourneyModels';

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

    it('should successfully click "Tiếp theo >>" button in bottomBar on select-ticket page', async () => {
      const html = `
        <div id="booking-container">
          <div class="bottomBar">
            <button class="ant-btn ant-btn-primary" data-testid="next-step-btn">
              <span>Tiếp theo &gt;&gt;</span>
            </button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      let clicked = false;
      const btn = root.querySelector('button');
      if (btn) {
        btn.click = () => {
          clicked = true;
        };
      }

      const success = await adapter.proceedToNextStep();
      expect(success).toBe(true);
      expect(clicked).toBe(true);
    });

    it('should NOT dismiss cancel order modal and proceed with continue button click', async () => {
      const html = `
        <div id="booking-container">
          <!-- Cancel order modal blocking the page -->
          <div class="ant-modal" role="dialog">
            <div class="ant-modal-title">Hủy đơn hàng?</div>
            <div class="ant-modal-body">Bạn có chắc chắn muốn tiếp tục? Bạn sẽ mất vị trí mình đã lựa chọn.</div>
            <div class="ant-modal-footer">
              <button class="btn-cancel-order">Hủy đơn</button>
              <button class="btn-stay">Ở lại</button>
            </div>
          </div>
          <!-- Bottom bar continue button -->
          <div class="bottom-bar">
            <button id="btn-continue" class="ant-btn ant-btn-primary">Tiếp tục</button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      let cancelDismissed = false;
      let continueClicked = false;

      const cancelBtn = root.querySelector('.btn-cancel-order');
      if (cancelBtn) {
        cancelBtn.click = () => {
          cancelDismissed = true;
        };
      }

      const continueBtn = root.querySelector('#btn-continue');
      if (continueBtn) {
        continueBtn.click = () => {
          continueClicked = true;
        };
      }

      const success = await adapter.proceedToNextStep();
      expect(success).toBe(true);
      expect(cancelDismissed).toBe(false);
      expect(continueClicked).toBe(true);
    });

    it('should legally transition through STOP_REQUESTED, RESET_REQUESTED, ARM, MONITORING_STARTED when starting from SEATS_SELECTED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.SEATS_SELECTED);
      expect(sm.state).toBe(PurchaseState.SEATS_SELECTED);

      // Transition using the hardened re-arm sequence
      if (
        sm.state !== PurchaseState.STOPPED &&
        sm.state !== PurchaseState.READY &&
        sm.state !== PurchaseState.IDLE &&
        sm.state !== PurchaseState.INIT
      ) {
        sm.transition({ type: 'STOP_REQUESTED', reason: 'Re-arm reset' });
      }
      expect(sm.state).toBe(PurchaseState.STOPPED);

      sm.transition({ type: 'RESET_REQUESTED' });
      expect(sm.state).toBe(PurchaseState.READY);

      sm.transition({ type: 'ARM' });
      expect(sm.state).toBe(PurchaseState.ARMED);

      sm.transition({ type: 'MONITORING_STARTED' });
      expect(sm.state).toBe(PurchaseState.MONITORING);
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

    it('should deselect seat tag in DOM bottom bar when -1242 error occurs', async () => {
      let changeSeatClicked = false;
      let tagCloseClicked = false;

      const html = `
        <div id="booking-container">
          <div class="bottom-bar">
            <span class="ant-tag">
              <span>A2-7</span>
              <span class="ant-tag-close-icon">✕</span>
            </span>
            <button class="btn-proceed">Tiếp tục - 2.200.000 đ >></button>
          </div>
          <div class="ant-modal-content" role="dialog">
            <div class="ant-modal-header">
              <div class="ant-modal-title">Uiii, Xin lỗi! (-1242)</div>
            </div>
            <div class="ant-modal-body">
              <p>Ghế bạn chọn A2-7 đã được đặt trước</p>
            </div>
            <div class="ant-modal-footer">
              <button class="ant-btn ant-btn-primary"><span>Chọn ghế khác</span></button>
            </div>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const actionBtn = root.querySelector('.ant-btn-primary') as unknown as { click: () => void };
      actionBtn.click = () => {
        changeSeatClicked = true;
      };

      const tagCloseIcon = root.querySelector('.ant-tag-close-icon') as unknown as {
        click: () => void;
      };
      tagCloseIcon.click = () => {
        tagCloseClicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);
      const errorResult = await adapter.detectAndHandleErrorModal();

      expect(errorResult.hasError).toBe(true);
      expect(errorResult.isSeatUnavailable).toBe(true);
      expect(errorResult.seatLabel).toBe('A2-7');
      expect(changeSeatClicked).toBe(true);
      expect(tagCloseClicked).toBe(true);
      expect(adapter.isSeatBlacklisted('A2-7')).toBe(true);
      expect(adapter.isSeatBlacklisted('A27')).toBe(true);
    });

    it('should detect -1242 error modal in Ticketbox custom HTML structure, ignore body class, and click button with text "Chọn ghế khác"', async () => {
      let changeSeatClicked = false;
      const html = `
        <div id="app">
          <div class="header">
            <button class="menu-btn">Menu</button>
          </div>
          <div class="tbox-modal" role="dialog">
            <div class="tbox-modal__dialog">
              <div class="tbox-modal__header">
                <h3>Uii, Xin lỗi (-1242)</h3>
              </div>
              <div class="tbox-modal__body">
                <p>Ghế bạn chọn VIP_A-21 đã được đặt trước</p>
              </div>
              <div class="tbox-modal__footer">
                <button class="tbox-btn tbox-btn--green">Chọn ghế khác</button>
              </div>
            </div>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const actionBtn = root.querySelector('.tbox-btn--green') as unknown as {
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
      expect(adapter.isSeatBlacklisted('VIPA21')).toBe(true);
    });

    it('should detect and click "Hủy đơn" button when "Hủy đơn hàng?" confirmation modal appears, and not click "Ở lại"', async () => {
      let cancelOrderClicked = false;
      let stayClicked = false;

      const html = `
        <div id="app">
          <div class="ant-modal-content" role="dialog">
            <div class="ant-modal-body">
              <div class="ant-modal-confirm-body">
                <span class="ant-modal-confirm-title">Hủy đơn hàng?</span>
                <div class="ant-modal-confirm-content">
                  <p>Bạn có chắc chắn muốn tiếp tục?</p>
                  <ul>
                    <li>Bạn sẽ mất vị trí mình đã lựa chọn.</li>
                    <li>Đơn hàng đang trong quá trình thanh toán hoặc đã thanh toán thành công cũng có thể bị huỷ.</li>
                  </ul>
                </div>
              </div>
              <div class="ant-modal-confirm-btns">
                <button type="button" class="ant-btn btn-cancel-order"><span>Hủy đơn</span></button>
                <button type="button" class="ant-btn ant-btn-primary btn-stay"><span>Ở lại</span></button>
              </div>
            </div>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
      const stayBtn = root.querySelector('.btn-stay') as unknown as { click: () => void };

      cancelBtn.click = () => {
        cancelOrderClicked = true;
      };
      stayBtn.click = () => {
        stayClicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setCustomUrl(
        'https://ticketbox.vn/events/26578/bookings/81077997936830/select-ticket'
      );
      adapter.markRecoveryInitiated();
      const res = await adapter.confirmCancelOrderForReselect();

      expect(res.status).toBe('confirmed');
      expect(cancelOrderClicked).toBe(true);
      expect(stayClicked).toBe(false);
    });

    it('should handle "Hủy đơn hàng?" modal on /select-ticket with question form and blacklist sidebar seat', async () => {
      let cancelOrderClicked = false;

      const html = `
        <div id="booking-container">
          <div class="sidebar">
            <div class="booking-info">
              <div class="ticket-type">1st Row (L&R)</div>
              <div class="seat-tag">VIP_A-21</div>
            </div>
          </div>
          <!-- Hủy đơn hàng dialog -->
          <div class="tbox-modal" role="dialog">
            <div class="tbox-modal__dialog">
              <div class="tbox-modal__header">
                <h3>Hủy đơn hàng?</h3>
              </div>
              <div class="tbox-modal__body">
                <p>Bạn có chắc chắn muốn tiếp tục?</p>
              </div>
              <div class="tbox-modal__footer">
                <button class="tbox-btn tbox-btn--cancel">Hủy đơn</button>
                <button class="tbox-btn tbox-btn--green">Ở lại</button>
              </div>
            </div>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const cancelBtn = root.querySelector('.tbox-btn--cancel') as unknown as { click: () => void };
      cancelBtn.click = () => {
        cancelOrderClicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setCustomUrl(
        'https://ticketbox.vn/events/26578/bookings/81077997936830/select-ticket'
      );
      adapter.markRecoveryInitiated();
      const result = await adapter.detectAndHandleErrorModal();

      expect(result.hasError).toBe(true);
      expect(result.isSeatUnavailable).toBe(true);
      expect(result.seatLabel).toBe('VIP_A-21');
      expect(cancelOrderClicked).toBe(true);
      expect(adapter.isSeatBlacklisted('VIP_A-21')).toBe(true);
    });

    it('should switch to alternative area of same ticket tier when current area has seat collision or runs out of seats', async () => {
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const eventBus = new ChromeMessageBus();

      // Mock adapter with 2 areas matching "1st Row (L&R)": 1st_ROW_L and 1st_ROW_R
      const areas: SeatArea[] = [
        {
          id: 'area-1',
          name: '1st_ROW_L',
          price: 2400000,
          ticketTypeId: 't-1',
          ticketTypeName: '1st Row (L&R)',
          mode: 'SEATED',
          availability: 'AVAILABLE',
          selectable: true,
        },
        {
          id: 'area-2',
          name: '1st_ROW_R',
          price: 2400000,
          ticketTypeId: 't-1',
          ticketTypeName: '1st Row (L&R)',
          mode: 'SEATED',
          availability: 'AVAILABLE',
          selectable: true,
        },
      ];

      const tickets: JourneyTicketType[] = [
        {
          id: 't-1',
          showingId: 'show-1',
          name: '1st Row (L&R)',
          price: 2400000,
          currency: 'VND',
          mode: 'SEATED',
          availability: 'AVAILABLE',
          minQuantity: 1,
          maxQuantity: 4,
          selectable: true,
          evidence: [],
        },
      ];

      const selectedAreas: string[] = [];
      const selectedSeats: string[][] = [];

      let attempt = 0;
      const customAdapter = {
        getEventState: async () => ({
          event: { id: 'evt-1', name: 'Show' },
          showing: null,
          ticketTypes: [],
        }),
        discoverShowings: async () => [
          { id: 'show-1', name: 'Show', date: '2026-11-01', ticketTypes: [] },
        ],
        discoverJourneyTickets: async () => tickets,
        discoverAreas: async () => areas,
        detectSeatMap: async () => ({ hasSeatMap: true }),
        selectTicket: async () => true,
        selectArea: async (areaId: string) => {
          selectedAreas.push(areaId);
          return true;
        },
        discoverSeats: async (targetArea: string) => {
          if (targetArea === 'area-1' || targetArea === '1st_ROW_L') {
            // First area has only 1 seat that is taken, or becomes empty after blacklisting
            return [
              {
                id: 'VIP_A-21',
                label: 'VIP_A-21',
                row: 'A',
                number: 21,
                status: 'AVAILABLE',
                selectable: true,
                price: 2400000,
                area: '1st_ROW_L',
                areaId: 'area-1',
              } as Seat,
            ];
          }
          // Second area has available seat VIP_A-30
          return [
            {
              id: 'VIP_A-30',
              label: 'VIP_A-30',
              row: 'A',
              number: 30,
              status: 'AVAILABLE',
              selectable: true,
              price: 2400000,
              area: '1st_ROW_R',
              areaId: 'area-2',
            } as Seat,
          ];
        },
        selectSpecificSeats: async (seatIds: string[]) => {
          selectedSeats.push(seatIds);
          return true;
        },
        proceedToNextStep: async () => true,
        getBookingSummary: async () => null,
        detectAndHandleErrorModal: async () => {
          attempt++;
          if (attempt === 1) {
            // Attempt 1 encounters seat collision on VIP_A-21
            customAdapter.blacklistSeat('VIP_A-21');
            return { hasError: true, isSeatUnavailable: true, seatLabel: 'VIP_A-21' };
          }
          return { hasError: false, isSeatUnavailable: false };
        },
        blacklistedSeats: new Set<string>(),
        blacklistSeat(seat: string) {
          this.blacklistedSeats.add(seat.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        },
        isSeatBlacklisted(seat?: string | null) {
          if (!seat) return false;
          return this.blacklistedSeats.has(seat.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        },
        getBlacklistedSeats() {
          return this.blacklistedSeats;
        },
      };

      const useCase = new ExecuteBookingJourneyUseCase(
        stateMachine,
        customAdapter as unknown as TicketboxJourneyAdapter,
        eventBus,
        logger
      );

      const result = await useCase.execute({
        categoryPriority: ['1st Row (L&R)'],
        quantity: 1,
        allowFallback: false,
      });

      expect(result.success).toBe(true);
      // Verify that it tried area-1 first, then switched to area-2!
      expect(selectedAreas).toContain('area-1');
      expect(selectedAreas).toContain('area-2');
      // Verify that VIP_A-30 in area-2 was selected
      expect(selectedSeats).toContainEqual(['VIP_A-30']);
      expect(result.selection?.areaId).toBe('area-2');
      expect(result.selection?.seats).toEqual(['VIP_A-30']);
    });

    it('should handle post-proceed -1242 seat collision on /select-ticket, deselect seat, and automatically reselect alternative seat', async () => {
      const origWindow = globalThis.window;
      globalThis.window = {
        location: {
          href: 'https://ticketbox.vn/events/26635/bookings/9920780779135/select-ticket',
        },
      } as unknown as Window & typeof globalThis;

      const tickets: JourneyTicketType[] = [
        {
          id: 't-vip',
          showingId: 'show-1',
          name: 'VIP ZONE',
          price: 2200000,
          currency: 'VND',
          mode: 'SEATED',
          availability: 'AVAILABLE',
          minQuantity: 1,
          maxQuantity: 4,
          selectable: true,
          evidence: [],
        },
      ];

      const areas: SeatArea[] = [
        {
          id: 'area-vip',
          name: 'VIP_AREA',
          price: 2200000,
          ticketTypeId: 't-vip',
          ticketTypeName: 'VIP ZONE',
          mode: 'SEATED',
          availability: 'AVAILABLE',
          selectable: true,
        },
      ];

      // Two seats in VIP_AREA: A2-7 (will collide on proceed) and A2-8 (available)
      const seat1: Seat = {
        id: 'A2-7',
        label: 'A2-7',
        row: 'A',
        number: 7,
        status: 'AVAILABLE',
        selectable: true,
        price: 2200000,
        area: 'VIP_AREA',
        areaId: 'area-vip',
      };
      const seat2: Seat = {
        id: 'A2-8',
        label: 'A2-8',
        row: 'A',
        number: 8,
        status: 'AVAILABLE',
        selectable: true,
        price: 2200000,
        area: 'VIP_AREA',
        areaId: 'area-vip',
      };

      const selectedSeatRuns: string[][] = [];
      const deselectedSeats: string[] = [];
      let proceedCalls = 0;
      let collisionDetected = false;

      const mockAdapter = {
        getEventState: async () => ({
          event: { id: 'evt-1', name: 'Concert' },
          showing: null,
          ticketTypes: [],
        }),
        discoverShowings: async () => [
          { id: 'show-1', name: 'Concert', date: '2026-11-01', ticketTypes: [] },
        ],
        discoverJourneyTickets: async () => tickets,
        discoverAreas: async () => areas,
        detectSeatMap: async () => ({ hasSeatMap: true }),
        selectTicket: async () => true,
        selectArea: async () => true,
        discoverSeats: async () => [seat1, seat2],
        selectSpecificSeats: async (seatIds: string[]) => {
          selectedSeatRuns.push([...seatIds]);
          return true;
        },
        deselectSeat: async (label?: string) => {
          if (label) deselectedSeats.push(label);
          return true;
        },
        proceedToNextStep: async () => {
          proceedCalls++;
          if (proceedCalls === 1) {
            // First time proceed is clicked with A2-7, server rejects with -1242 modal!
            collisionDetected = true;
          }
          return true;
        },
        getBookingSummary: async () => null,
        detectAndHandleErrorModal: async () => {
          if (collisionDetected) {
            collisionDetected = false; // resolved by handling
            mockAdapter.blacklistSeat('A2-7');
            await mockAdapter.deselectSeat('A2-7');
            return { hasError: true, isSeatUnavailable: true, seatLabel: 'A2-7' };
          }
          return { hasError: false, isSeatUnavailable: false };
        },
        blacklistedSeats: new Set<string>(),
        blacklistSeat(seat: string) {
          this.blacklistedSeats.add(seat.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        },
        isSeatBlacklisted(seat?: string | null) {
          if (!seat) return false;
          return this.blacklistedSeats.has(seat.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        },
        getBlacklistedSeats() {
          return this.blacklistedSeats;
        },
      };

      const testStateMachine = new PurchaseStateMachine(PurchaseState.MONITORING);
      const eventBus = new ChromeMessageBus(logger);
      const useCase = new ExecuteBookingJourneyUseCase(
        testStateMachine,
        mockAdapter as unknown as TicketboxJourneyAdapter,
        eventBus,
        logger
      );

      const result = await useCase.execute({
        categoryPriority: ['VIP ZONE'],
        quantity: 1,
        allowFallback: false,
      });

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.SEATS_SELECTED);
      // First attempt selected A2-7
      expect(selectedSeatRuns[0]).toEqual(['A2-7']);
      // A2-7 was deselected
      expect(deselectedSeats).toContain('A2-7');
      // Second attempt automatically selected A2-8!
      expect(selectedSeatRuns[1]).toEqual(['A2-8']);
      expect(result.selection?.seats).toEqual(['A2-8']);

      globalThis.window = origWindow;
    });
  });

  describe('Standing Flow on /select-ticket (seatMapId: 0)', () => {
    const MOCK_SHOWING_STANDING = {
      status: 1,
      message: 'Thành công',
      data: {
        result: {
          id: 48573955765118,
          status: 'book_now',
          seatMapId: 0,
          isSalable: true,
          showingTime: '17:00 - 22:00, 24 Tháng 10, 2026',
          event: {
            id: 26473,
            title: 'HOÀNG TÔN-14CASPER-BON NGHIÊM "LỜI CHƯA KỊP NÓI"',
            venue: 'Nhà Hát Âu Cơ',
          },
          ticketTypes: [
            {
              id: 101,
              name: 'Hạng Sky',
              price: 2100000,
              status: 'sold_out',
              minQtyPerOrder: 1,
              maxQtyPerOrder: 4,
            },
            {
              id: 102,
              name: 'Hạng Melody',
              price: 1900000,
              status: 'book_now',
              minQtyPerOrder: 1,
              maxQtyPerOrder: 4,
            },
            {
              id: 103,
              name: 'Hạng Soul',
              price: 1750000,
              status: 'book_now',
              minQtyPerOrder: 1,
              maxQtyPerOrder: 4,
            },
          ],
        },
      },
    };

    const STANDING_HTML = `
      <div id="booking-app">
        <header>
          <button class="back-btn">Trở về</button>
          <h2>Chọn vé</h2>
        </header>

        <!-- Main Ticket List -->
        <main class="ticket-list-container">
          <!-- Sold out tier -->
          <div class="ticket-card" data-ticket-id="101">
            <div class="header">
              <span class="title">Hạng Sky</span>
              <span class="price">2.100.000 đ</span>
            </div>
            <span class="badge badge-soldout">Hết vé</span>
          </div>

          <!-- Target available tier with stepper -->
          <div class="ticket-card" data-ticket-id="102">
            <div class="header">
              <span class="title">Hạng Melody</span>
              <span class="price">1.900.000 đ</span>
            </div>
            <div class="stepper-group flex items-center">
              <button type="button" class="btn-minus">-</button>
              <span class="qty-display">0</span>
              <button type="button" class="btn-plus">+</button>
            </div>
            <div class="benefit-box">Quyền lợi: Đồ uống</div>
          </div>

          <!-- Other available tier -->
          <div class="ticket-card" data-ticket-id="103">
            <div class="header">
              <span class="title">Hạng Soul</span>
              <span class="price">1.750.000 đ</span>
            </div>
            <div class="stepper-group flex items-center">
              <button type="button" class="btn-minus">-</button>
              <span class="qty-display">0</span>
              <button type="button" class="btn-plus">+</button>
            </div>
          </div>
        </main>

        <!-- Sidebar Summary -->
        <aside class="sidebar">
          <h3>Giá vé</h3>
          <div class="sidebar-item"><span>Hạng Sky</span> <span>2.100.000 đ</span></div>
          <div class="sidebar-item"><span>Hạng Melody</span> <span>1.900.000 đ</span></div>
          <div class="sidebar-item"><span>Hạng Soul</span> <span>1.750.000 đ</span></div>
          <button id="checkout-btn" disabled class="btn-disabled">Vui lòng chọn vé &gt;&gt;</button>
        </aside>
      </div>
    `;

    it('should correctly discover standing tickets from Showing API and detect seatMapId: 0', async () => {
      const root = parseHtmlToDOMElementLike(STANDING_HTML);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setShowingData(MOCK_SHOWING_STANDING as never);

      const catalog = await adapter.discoverTicketCatalog('48573955765118');
      expect(catalog.showings).toHaveLength(1);
      const tickets = catalog.showings[0]?.ticketTypes || [];
      expect(tickets).toHaveLength(3);

      const sky = tickets.find((t) => t.name === 'Hạng Sky');
      expect(sky?.availability).toBe('SOLD_OUT');
      expect(sky?.selectable).toBe(false);

      const melody = tickets.find((t) => t.name === 'Hạng Melody');
      expect(melody?.availability).toBe('AVAILABLE');
      expect(melody?.selectable).toBe(true);
      expect(melody?.mode).toBe('STANDING');

      const seatMap = await adapter.detectSeatMap();
      expect(seatMap.hasSeatMap).toBe(false);
    });

    it('should locate target ticket row, ignore sidebar, click plus button to increment quantity, and proceed', async () => {
      const root = parseHtmlToDOMElementLike(STANDING_HTML);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setShowingData(MOCK_SHOWING_STANDING as never);

      let plusClicks = 0;
      const melodyCard = root.querySelector('[data-ticket-id="102"]');
      const plusBtn = melodyCard?.querySelector('.btn-plus') as { click?: () => void };
      if (plusBtn) {
        plusBtn.click = () => {
          plusClicks++;
          // Simulate DOM update on click
          const qtyDisp = melodyCard?.querySelector('.qty-display');
          if (qtyDisp) {
            qtyDisp.textContent = String(plusClicks);
          }
          // Enable continue button
          const continueBtn = root.querySelector('#checkout-btn');
          if (continueBtn) {
            continueBtn.textContent = `Tiếp tục - ${(1900000 * plusClicks).toLocaleString('vi-VN')} đ >>`;
            continueBtn.removeAttribute?.('disabled');
            continueBtn.setAttribute?.('class', 'btn-active');
            if ('className' in continueBtn) {
              (continueBtn as unknown as { className: string }).className = 'btn-active';
            }
          }
        };
      }

      const melodyTicket = {
        id: '102',
        name: 'Hạng Melody',
        price: { amount: 1900000, currency: 'VND' as const },
        mode: 'STANDING' as const,
        availability: 'AVAILABLE' as const,
        minQuantity: 1,
        maxQuantity: 4,
        selectedQuantity: 0,
        selectable: true,
        source: { page: 'BOOKING' as const, evidence: [] },
      };

      const selectSuccess = await adapter.selectQuantity(melodyTicket, 2);
      expect(selectSuccess).toBe(true);
      expect(plusClicks).toBe(2);

      // Verify that proceedToNextStep detects the newly enabled continue button
      let proceedClicked = false;
      const continueBtn = root.querySelector('#checkout-btn') as { click?: () => void };
      if (continueBtn) {
        continueBtn.click = () => {
          proceedClicked = true;
        };
      }

      const proceedSuccess = await adapter.proceedToNextStep();
      expect(proceedSuccess).toBe(true);
      expect(proceedClicked).toBe(true);
    });

    it('should complete full ExecuteBookingJourneyUseCase on standing /select-ticket page without entering SEATED mode', async () => {
      const origWindow = globalThis.window;
      globalThis.window = {
        location: {
          href: 'https://ticketbox.vn/events/26473/bookings/48573955765118/select-ticket',
        },
      } as unknown as Window & typeof globalThis;

      try {
        const root = parseHtmlToDOMElementLike(STANDING_HTML);
        const adapter = new TicketboxJourneyAdapter(logger, root);
        adapter.setShowingData(MOCK_SHOWING_STANDING as never);

        let plusClicks = 0;
        const melodyCard = root.querySelector('[data-ticket-id="102"]');
        const plusBtn = melodyCard?.querySelector('.btn-plus') as { click?: () => void };
        if (plusBtn) {
          plusBtn.click = () => {
            plusClicks++;
            const qtyDisp = melodyCard?.querySelector('.qty-display');
            if (qtyDisp) {
              qtyDisp.textContent = String(plusClicks);
            }
            const continueBtn = root.querySelector('#checkout-btn');
            if (continueBtn) {
              continueBtn.textContent = 'Tiếp tục - 1.900.000 đ >>';
              continueBtn.removeAttribute?.('disabled');
              continueBtn.setAttribute?.('class', 'btn-active');
              if ('className' in continueBtn) {
                (continueBtn as unknown as { className: string }).className = 'btn-active';
              }
            }
          };
        }

        const stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING);
        const eventBus = new ChromeMessageBus(logger);

        const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

        const result = await useCase.execute({
          categoryPriority: ['Hạng Melody'],
          quantity: 1,
          allowFallback: false,
        });

        expect(result.success).toBe(true);
        expect(result.selection?.mode).toBe('STANDING');
        expect(result.selection?.name).toBe('Hạng Melody');
        expect(plusClicks).toBe(1);
      } finally {
        globalThis.window = origWindow;
      }
    });

    it('should click plus button only once when stepper already had 1 ticket preselected and user requested 2', async () => {
      const root = parseHtmlToDOMElementLike(STANDING_HTML);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setShowingData(MOCK_SHOWING_STANDING as never);

      const melodyCard = root.querySelector('[data-ticket-id="102"]');
      const qtyDisp = melodyCard?.querySelector('.qty-display');
      if (qtyDisp) {
        qtyDisp.textContent = '1'; // Simulate 1 ticket pre-existing in stepper
      }

      let plusClicks = 0;
      let minusClicks = 0;
      const plusBtn = melodyCard?.querySelector('.btn-plus') as { click?: () => void };
      if (plusBtn) {
        plusBtn.click = () => {
          plusClicks++;
          if (qtyDisp) {
            qtyDisp.textContent = String(1 + plusClicks);
          }
        };
      }
      const minusBtn = melodyCard?.querySelector('.btn-minus') as { click?: () => void };
      if (minusBtn) {
        minusBtn.click = () => {
          minusClicks++;
        };
      }

      const melodyTicket = {
        id: '102',
        name: 'Hạng Melody',
        price: { amount: 1900000, currency: 'VND' as const },
        mode: 'STANDING' as const,
        availability: 'AVAILABLE' as const,
        minQuantity: 1,
        maxQuantity: 4,
        selectedQuantity: 0,
        selectable: true,
        source: { page: 'BOOKING' as const, evidence: [] },
      };

      const selectSuccess = await adapter.selectQuantity(melodyTicket, 2);
      expect(selectSuccess).toBe(true);
      expect(plusClicks).toBe(1); // Exactly 1 click needed from 1 to 2
      expect(minusClicks).toBe(0);
      expect(qtyDisp?.textContent).toBe('2');
    });

    it('should click minus button to decrement when stepper had 3 tickets selected and user requested 2', async () => {
      const root = parseHtmlToDOMElementLike(STANDING_HTML);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setShowingData(MOCK_SHOWING_STANDING as never);

      const melodyCard = root.querySelector('[data-ticket-id="102"]');
      const qtyDisp = melodyCard?.querySelector('.qty-display');
      if (qtyDisp) {
        qtyDisp.textContent = '3'; // Simulate 3 tickets currently selected
      }

      let plusClicks = 0;
      let minusClicks = 0;
      const plusBtn = melodyCard?.querySelector('.btn-plus') as { click?: () => void };
      if (plusBtn) {
        plusBtn.click = () => {
          plusClicks++;
        };
      }
      const minusBtn = melodyCard?.querySelector('.btn-minus') as { click?: () => void };
      if (minusBtn) {
        minusBtn.click = () => {
          minusClicks++;
          if (qtyDisp) {
            qtyDisp.textContent = String(3 - minusClicks);
          }
        };
      }

      const melodyTicket = {
        id: '102',
        name: 'Hạng Melody',
        price: { amount: 1900000, currency: 'VND' as const },
        mode: 'STANDING' as const,
        availability: 'AVAILABLE' as const,
        minQuantity: 1,
        maxQuantity: 4,
        selectedQuantity: 0,
        selectable: true,
        source: { page: 'BOOKING' as const, evidence: [] },
      };

      const selectSuccess = await adapter.selectQuantity(melodyTicket, 2);
      expect(selectSuccess).toBe(true);
      expect(minusClicks).toBe(1); // Exactly 1 decrement click needed from 3 to 2
      expect(plusClicks).toBe(0);
      expect(qtyDisp?.textContent).toBe('2');
    });

    it('should reject concurrent ExecuteBookingJourneyUseCase executions when already executing', async () => {
      const root = parseHtmlToDOMElementLike(STANDING_HTML);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setShowingData(MOCK_SHOWING_STANDING as never);

      const stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING);
      const eventBus = new ChromeMessageBus(logger);
      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

      // Artificially simulate an in-flight execution
      (useCase as unknown as { isExecuting: boolean }).isExecuting = true;

      const result = await useCase.execute({
        categoryPriority: ['Hạng Melody'],
        quantity: 2,
        allowFallback: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Concurrent journey execution rejected');
    });
  });
});
