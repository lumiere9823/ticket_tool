import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';

const CANCEL_ORDER_MODAL_HTML = `
  <div id="app">
    <div class="ant-modal-root">
      <div class="ant-modal-wrap" role="dialog">
        <div class="ant-modal ant-modal-confirm ant-modal-confirm-confirm">
          <div class="ant-modal-content">
            <div class="ant-modal-body">
              <span class="ant-modal-confirm-title">Hủy đơn hàng?</span>
              <div class="ant-modal-confirm-content">
                Bạn có chắc chắn muốn hủy đơn hàng hiện tại để chọn lại vé?
              </div>
            </div>
            <div class="ant-modal-confirm-btns">
              <button type="button" class="ant-btn btn-cancel-order"><span>Hủy đơn</span></button>
              <button type="button" class="ant-btn ant-btn-primary btn-stay"><span>Ở lại</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

describe('P1-1: Cancel Order Modal Safety Guard', () => {
  let logger: SanitizedLogger;

  beforeEach(() => {
    logger = new SanitizedLogger({ state: 'TEST' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detectCancelOrderModal should detect modal presence without clicking anything', () => {
    const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
    const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
    let clicked = false;
    cancelBtn.click = () => {
      clicked = true;
    };

    const adapter = new TicketboxJourneyAdapter(logger, root);
    const detected = adapter.detectCancelOrderModal();

    expect(detected).toBe(true);
    expect(clicked).toBe(false);
  });

  it('confirmCancelOrderForReselect should block click when URL is on /payment or /checkout', async () => {
    const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
    const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
    let clicked = false;
    cancelBtn.click = () => {
      clicked = true;
    };

    const adapter = new TicketboxJourneyAdapter(logger, root);
    adapter.setCustomUrl('https://ticketbox.vn/events/123/bookings/456/payment');
    adapter.markRecoveryInitiated();

    const res = await adapter.confirmCancelOrderForReselect();
    expect(res.status).toBe('blocked');
    expect(clicked).toBe(false);
  });

  it('confirmCancelOrderForReselect should block click when user initiated reselect (assistant recovery not flagged)', async () => {
    const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
    const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
    let clicked = false;
    cancelBtn.click = () => {
      clicked = true;
    };

    const adapter = new TicketboxJourneyAdapter(logger, root);
    adapter.setCustomUrl('https://ticketbox.vn/events/123/bookings/456/select-ticket');
    // recoveryInitiatedAt is NOT set

    const res = await adapter.confirmCancelOrderForReselect();
    expect(res.status).toBe('blocked');
    expect(clicked).toBe(false);
  });

  it('confirmCancelOrderForReselect should block click when recovery was initiated > 5 seconds ago', async () => {
    vi.useFakeTimers();
    try {
      const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
      const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
      let clicked = false;
      cancelBtn.click = () => {
        clicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setCustomUrl('https://ticketbox.vn/events/123/bookings/456/select-ticket');
      adapter.markRecoveryInitiated();

      // Fast forward 5100ms
      vi.advanceTimersByTime(5100);

      const res = await adapter.confirmCancelOrderForReselect();
      expect(res.status).toBe('blocked');
      expect(clicked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('confirmCancelOrderForReselect should block click when state is in forbidden states (e.g. PAYMENT_GATE, CONFIRMED, HELD)', async () => {
    const forbiddenStates = [
      PurchaseState.PAYMENT_GATE,
      PurchaseState.PAYMENT,
      PurchaseState.CONFIRMATION_PENDING,
      PurchaseState.CONFIRMED,
      PurchaseState.HELD,
      PurchaseState.CHECKOUT,
    ];

    for (const st of forbiddenStates) {
      const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
      const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
      let clicked = false;
      cancelBtn.click = () => {
        clicked = true;
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setCustomUrl('https://ticketbox.vn/events/123/bookings/456/select-ticket');
      adapter.setCurrentStateProvider(() => st);
      adapter.markRecoveryInitiated();

      const res = await adapter.confirmCancelOrderForReselect();
      expect(res.status).toBe('blocked');
      expect(clicked).toBe(false);
    }
  });

  it('proceedToNextStep should NEVER call or click cancel order modal', async () => {
    const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
    const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
    let cancelClicked = false;
    cancelBtn.click = () => {
      cancelClicked = true;
    };

    const adapter = new TicketboxJourneyAdapter(logger, root);
    adapter.setCustomUrl('https://ticketbox.vn/events/123/bookings/456/select-ticket');

    // Running proceedToNextStep on a page that only has cancel modal
    await adapter.proceedToNextStep();

    expect(cancelClicked).toBe(false);
  });

  it('valid -1242 recovery flow allows confirming cancel order modal when all 4 conditions match', async () => {
    const root = parseHtmlToDOMElementLike(CANCEL_ORDER_MODAL_HTML);
    const cancelBtn = root.querySelector('.btn-cancel-order') as unknown as { click: () => void };
    let cancelClicked = false;
    cancelBtn.click = () => {
      cancelClicked = true;
    };

    const adapter = new TicketboxJourneyAdapter(logger, root);
    adapter.setCustomUrl('https://ticketbox.vn/events/123/bookings/456/select-ticket');
    adapter.setCurrentStateProvider(() => PurchaseState.SELECTING_SEATS);
    adapter.markRecoveryInitiated();

    const res = await adapter.confirmCancelOrderForReselect();
    expect(res.status).toBe('confirmed');
    expect(cancelClicked).toBe(true);
  });
});
