/**
 * Ticketbox Modal Handler
 *
 * Handles detection and safe recovery actions for:
 * - "Hủy đơn hàng?" confirmation dialogs (under strict safety invariant verification)
 * - -1242 seat unavailable error modals ("Ghế bạn chọn đã được đặt trước")
 * - Generic Ticketbox error modals ("Uiii, xin lỗi", "Vé đã hết", etc.)
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { PurchaseState } from '../../../domain/states/PurchaseState';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';
import { CancelOrderConfirmationResult, MutableDOMElement } from '../types/TicketboxApiTypes';

export interface ModalHandlerContext {
  getRoot: () => DOMElementLike | null;
  getPageUrl: () => string;
  getCurrentState?: () => PurchaseState | undefined;
  getRecoveryInitiatedAt: () => number | null;
  markRecoveryInitiated: () => void;
  clearRecoveryInitiated: () => void;
  blacklistSeat: (seatIdOrLabel: string) => void;
  deselectSeat: (seatLabel?: string) => Promise<boolean>;
  invalidateSeatmapCache: () => void;
  getSelectedSeatIds: () => Set<string>;
  clickElement: (el: DOMElementLike) => void;
}

export class TicketboxModalHandler {
  constructor(
    private readonly ctx: ModalHandlerContext,
    private readonly logger?: LoggerPort
  ) {}

  /**
   * Passive detection of "Hủy đơn hàng?" confirmation dialog.
   * Strictly reads DOM signals; NEVER clicks any button or mutates page state.
   */
  public detectCancelOrderModal(): boolean {
    const root = this.ctx.getRoot();
    const doc = typeof document !== 'undefined' ? document : null;

    const isExcludedNode = (node: DOMElementLike | Element | null | undefined): boolean => {
      if (!node) return true;
      const tag = (node.tagName || '').toUpperCase();
      return tag === 'BODY' || tag === 'HTML';
    };

    const modalSelector =
      '.ant-modal-content, [role="dialog"], .ant-modal, [class*="modal-content"], [class*="modal-body"], [class*="modal-dialog"], [class*="tbox-modal"], [class*="popup"], [class*="alert"]';

    const modalCandidates: DOMElementLike[] = [];
    if (root && !isExcludedNode(root)) {
      const inRoot = root.querySelectorAll(modalSelector);
      modalCandidates.push(...inRoot.filter((el) => !isExcludedNode(el)));
    }
    if (doc) {
      const inDoc = Array.from(doc.querySelectorAll(modalSelector))
        .filter((el) => !isExcludedNode(el))
        .map((el) => wrapBrowserElement(el));
      modalCandidates.push(...inDoc);
    }

    for (const modal of modalCandidates) {
      const text = (modal.textContent || '').toLowerCase();
      if (!text) continue;

      const isCancelOrderModal =
        text.includes('hủy đơn hàng') ||
        text.includes('huỷ đơn hàng') ||
        (text.includes('bạn có chắc chắn muốn tiếp tục') &&
          (text.includes('mất vị trí') || text.includes('hủy đơn') || text.includes('huỷ đơn')));

      if (isCancelOrderModal) {
        return true;
      }
    }

    return false;
  }

  /**
   * Searches for and clicks the "Hủy đơn" button within the modal.
   * Internal helper; only called after all 4 safety preconditions in confirmCancelOrderForReselect pass.
   */
  private async performCancelOrderButtonClick(): Promise<boolean> {
    const root = this.ctx.getRoot();
    const doc = typeof document !== 'undefined' ? document : null;

    const isExcludedNode = (node: DOMElementLike | Element | null | undefined): boolean => {
      if (!node) return true;
      const tag = (node.tagName || '').toUpperCase();
      return tag === 'BODY' || tag === 'HTML';
    };

    const modalSelector =
      '.ant-modal-content, [role="dialog"], .ant-modal, [class*="modal-content"], [class*="modal-body"], [class*="modal-dialog"], [class*="tbox-modal"], [class*="popup"], [class*="alert"]';

    const modalCandidates: DOMElementLike[] = [];
    if (root && !isExcludedNode(root)) {
      const inRoot = root.querySelectorAll(modalSelector);
      modalCandidates.push(...inRoot.filter((el) => !isExcludedNode(el)));
    }
    if (doc) {
      const inDoc = Array.from(doc.querySelectorAll(modalSelector))
        .filter((el) => !isExcludedNode(el))
        .map((el) => wrapBrowserElement(el));
      modalCandidates.push(...inDoc);
    }

    for (const modal of modalCandidates) {
      const text = (modal.textContent || '').toLowerCase();
      if (!text) continue;

      const isCancelOrderModal =
        text.includes('hủy đơn hàng') ||
        text.includes('huỷ đơn hàng') ||
        (text.includes('bạn có chắc chắn muốn tiếp tục') &&
          (text.includes('mất vị trí') || text.includes('hủy đơn') || text.includes('huỷ đơn')));

      if (!isCancelOrderModal) continue;

      this.logger?.info(
        'Detected "Hủy đơn hàng?" confirmation modal, searching for "Hủy đơn" button'
      );
      const modalRaw = (modal.rawElement || modal) as HTMLElement;
      let cancelBtn: DOMElementLike | HTMLElement | null = null;

      const getClosestButton = (el: DOMElementLike | HTMLElement): DOMElementLike | HTMLElement => {
        let curr: DOMElementLike | HTMLElement | null = el;
        while (curr) {
          const tag = (curr.tagName || '').toUpperCase();
          const role =
            typeof curr.getAttribute === 'function' ? curr.getAttribute('role') : undefined;
          if (tag === 'BUTTON' || tag === 'A' || role === 'button') {
            return curr;
          }
          if ('closest' in curr && typeof (curr as HTMLElement).closest === 'function') {
            const found = (curr as HTMLElement).closest('button, a, [role="button"]');
            if (found instanceof HTMLElement) return found;
          }
          curr = (curr.parentElement as DOMElementLike | HTMLElement | null) ?? null;
        }
        return el;
      };

      if (modalRaw && typeof modalRaw.querySelectorAll === 'function') {
        const clickables = Array.from(
          modalRaw.querySelectorAll('button, a, [role="button"], span, div')
        ) as (DOMElementLike | HTMLElement)[];

        // 1. Direct match: element text is strictly "Hủy đơn" or "Huỷ đơn"
        const directMatch = clickables.find((el) => {
          const t = (el.textContent || '').trim().toLowerCase();
          return (
            (t === 'hủy đơn' || t === 'huỷ đơn' || t === 'hủy đơn hàng' || t === 'huỷ đơn hàng') &&
            !t.includes('ở lại') &&
            !t.includes('?')
          );
        });

        if (directMatch) {
          cancelBtn = getClosestButton(directMatch);
        }

        // 2. Button element whose text contains "hủy đơn" / "huỷ đơn"
        if (!cancelBtn) {
          const btnEl = clickables.find((el) => {
            const tag = (el.tagName || '').toUpperCase();
            const isBtn =
              tag === 'BUTTON' ||
              tag === 'A' ||
              (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'button');
            if (!isBtn) return false;
            const t = (el.textContent || '').trim().toLowerCase();
            return (
              (t.includes('hủy đơn') || t.includes('huỷ đơn')) &&
              !t.includes('ở lại') &&
              !t.includes('?') &&
              !t.includes('chắc chắn')
            );
          });
          if (btnEl) {
            cancelBtn = btnEl;
          }
        }

        // 3. Any element in modal whose text includes "hủy đơn" / "huỷ đơn"
        if (!cancelBtn) {
          const anyEl = clickables.find((el) => {
            const t = (el.textContent || '').trim().toLowerCase();
            return (
              (t.includes('hủy đơn') || t.includes('huỷ đơn')) &&
              !t.includes('ở lại') &&
              !t.includes('?') &&
              !t.includes('chắc chắn') &&
              !t.includes('tiếp tục')
            );
          });
          if (anyEl) {
            cancelBtn = getClosestButton(anyEl);
          }
        }
      }

      // Global fallback if not found within modal container
      if (!cancelBtn && doc) {
        const allGlobal = Array.from(
          doc.querySelectorAll('button, a, [role="button"]')
        ) as HTMLElement[];
        const globalMatch = allGlobal.find((el) => {
          const t = (el.textContent || '').trim().toLowerCase();
          return (
            (t === 'hủy đơn' || t === 'huỷ đơn' || t === 'hủy đơn hàng' || t === 'huỷ đơn hàng') &&
            !t.includes('ở lại') &&
            !t.includes('?')
          );
        });
        if (globalMatch) {
          cancelBtn = globalMatch;
        }
      }

      const toDOMElementLike = (el: unknown): DOMElementLike => {
        if (el && typeof el === 'object' && 'tagName' in el && 'querySelector' in el) {
          return el as DOMElementLike;
        }
        return wrapBrowserElement(el as HTMLElement);
      };

      if (cancelBtn && typeof (cancelBtn as MutableDOMElement).click === 'function') {
        this.logger?.info('Clicking "Hủy đơn" button to cancel order and return to seat selection');
        this.ctx.clickElement(toDOMElementLike(cancelBtn));
        await new Promise((r) => setTimeout(r, 600));
        return true;
      }
    }

    return false;
  }

  /**
   * Confirms order cancellation ONLY when all 4 strict safety invariants are satisfied:
   * (a) URL is /select-ticket or /question-form
   * (b) URL does NOT contain /payment or /checkout
   * (c) State machine is not in PAYMENT_GATE, PAYMENT, CONFIRMATION_PENDING, CONFIRMED, HELD, CHECKOUT
   * (d) Assistant explicitly initiated recovery ("Chọn ghế khác" / "Chọn lại vé") within <= 5000ms
   */
  public async confirmCancelOrderForReselect(): Promise<CancelOrderConfirmationResult> {
    const rawUrl = this.ctx.getPageUrl();
    const url = rawUrl.toLowerCase();

    // Condition (a): URL must be /select-ticket or /question-form
    const isAllowedPath = url.includes('/select-ticket') || url.includes('/question-form');
    if (!isAllowedPath) {
      this.logger?.warn(
        'Cancel order confirmation blocked: URL is not /select-ticket or /question-form',
        {
          url: rawUrl,
        }
      );
      return { status: 'blocked', reason: 'URL must be /select-ticket or /question-form' };
    }

    // Condition (b): URL must NOT contain /payment or /checkout
    const isPaymentPath = url.includes('/payment') || url.includes('/checkout');
    if (isPaymentPath) {
      this.logger?.warn('Cancel order confirmation blocked: URL contains /payment or /checkout', {
        url: rawUrl,
      });
      return { status: 'blocked', reason: 'URL cannot contain /payment or /checkout' };
    }

    // Condition (c): state machine state is NOT in forbidden states
    const FORBIDDEN_STATES: PurchaseState[] = [
      PurchaseState.PAYMENT_GATE,
      PurchaseState.PAYMENT,
      PurchaseState.CONFIRMATION_PENDING,
      PurchaseState.CONFIRMED,
      PurchaseState.HELD,
      PurchaseState.CHECKOUT,
    ];
    const currentState = this.ctx.getCurrentState ? this.ctx.getCurrentState() : undefined;
    if (currentState && FORBIDDEN_STATES.includes(currentState)) {
      this.logger?.warn(
        'Cancel order confirmation blocked: current state forbids canceling order',
        {
          currentState,
        }
      );
      return { status: 'blocked', reason: `State ${currentState} forbids canceling order` };
    }

    // Condition (d): assistant initiated recovery within last 5000ms
    const now = Date.now();
    const recoveryInitiatedAt = this.ctx.getRecoveryInitiatedAt();
    if (!recoveryInitiatedAt || now - recoveryInitiatedAt > 5000) {
      this.logger?.warn(
        'Cancel order confirmation blocked: recovery was not initiated by assistant within 5s',
        {
          recoveryInitiatedAt,
          elapsedMs: recoveryInitiatedAt ? now - recoveryInitiatedAt : null,
        }
      );
      return {
        status: 'blocked',
        reason: 'Assistant recovery was not initiated within last 5 seconds',
      };
    }

    if (!this.detectCancelOrderModal()) {
      return { status: 'not_found' };
    }

    const clicked = await this.performCancelOrderButtonClick();
    if (clicked) {
      this.ctx.clearRecoveryInitiated();
      return { status: 'confirmed' };
    }

    return { status: 'not_found' };
  }

  /**
   * Deprecated backward-compatible wrapper. Calls confirmCancelOrderForReselect and returns boolean.
   */
  public async dismissCancelOrderModal(): Promise<boolean> {
    const res = await this.confirmCancelOrderForReselect();
    return res.status === 'confirmed';
  }

  /**
   * Detects Ticketbox error modals (e.g. -1242: "Ghế bạn chọn VIP_A-21 đã được đặt trước").
   * Extracts the unavailable seat, blacklists it, and clicks the action button ("Chọn ghế khác")
   * to automatically recover and return to seat selection.
   */
  public async detectAndHandleErrorModal(): Promise<{
    hasError: boolean;
    isSeatUnavailable: boolean;
    seatLabel?: string | undefined;
  }> {
    const root = this.ctx.getRoot();
    const doc = typeof document !== 'undefined' ? document : null;

    // 0. Check if "Hủy đơn hàng?" confirmation dialog is already open on screen
    const cancelModalDismissed =
      (await this.confirmCancelOrderForReselect()).status === 'confirmed';
    if (cancelModalDismissed) {
      let seatLabel: string | undefined;
      const containers: DOMElementLike[] = [];
      if (root) containers.push(root);
      if (doc) containers.push(wrapBrowserElement(doc));

      for (const container of containers) {
        const textNodes = container.querySelectorAll(
          '.sidebar, [class*="sidebar"], [class*="booking"], [class*="ticket"], [class*="order"], [class*="summary"], [class*="tag"], [class*="pill"]'
        );
        for (const node of textNodes) {
          const match = (node.textContent || '').match(/\b([A-Za-z0-9_]+[-_]\d+)\b/);
          if (match && match[1]) {
            seatLabel = match[1];
            break;
          }
        }
        if (seatLabel) break;
      }
      if (!seatLabel) {
        const lastSeat = Array.from(this.ctx.getSelectedSeatIds()).pop();
        if (lastSeat) seatLabel = lastSeat;
      }
      if (seatLabel) {
        this.ctx.blacklistSeat(seatLabel);
        await this.ctx.deselectSeat(seatLabel);
      } else {
        await this.ctx.deselectSeat();
      }
      this.ctx.invalidateSeatmapCache();
      this.logger?.warn('"Hủy đơn hàng?" modal was detected and dismissed ("Hủy đơn" clicked)', {
        seatLabel,
      });
      return { hasError: true, isSeatUnavailable: true, seatLabel };
    }

    const isExcludedNode = (node: DOMElementLike | Element | null | undefined): boolean => {
      if (!node) return true;
      const tag = (node.tagName || '').toUpperCase();
      return tag === 'BODY' || tag === 'HTML';
    };

    const modalSelector =
      '.ant-modal-content, [role="dialog"], .ant-modal, [class*="modal-content"], [class*="modal-body"], [class*="modal-dialog"], [class*="tbox-modal"], [class*="popup"], [class*="alert"]';

    const modalCandidates: DOMElementLike[] = [];
    if (root && !isExcludedNode(root)) {
      const inRoot = root.querySelectorAll(modalSelector);
      modalCandidates.push(...inRoot.filter((el) => !isExcludedNode(el)));
    }
    if (doc) {
      const inDoc = Array.from(doc.querySelectorAll(modalSelector))
        .filter((el) => !isExcludedNode(el))
        .map((el) => wrapBrowserElement(el));
      modalCandidates.push(...inDoc);
    }

    for (const modal of modalCandidates) {
      const text = (modal.textContent || '').toLowerCase();
      if (!text) continue;

      const isUnavailable =
        text.includes('-1242') ||
        text.includes('đã được đặt trước') ||
        text.includes('đã có người đặt') ||
        text.includes('đã có người chọn') ||
        text.includes('không còn trống') ||
        text.includes('chọn ghế khác') ||
        (text.includes('xin lỗi') && text.includes('ghế'));

      if (isUnavailable) {
        let seatLabel: string | undefined;
        const match = modal.textContent.match(
          /(?:ghế|seat)\s*(?:bạn\s*chọn)?\s*([A-Za-z0-9_-]+)\s*(?:đã\s*(?:được\s*)?đặt\s*trước|đã\s*có\s*người|không\s*còn|đã)/i
        );
        if (match && match[1]) {
          seatLabel = match[1].trim();
        } else {
          const tokenMatch = modal.textContent.match(/\b([A-Za-z0-9_]+[-_]\d+)\b/);
          if (tokenMatch && tokenMatch[1]) {
            seatLabel = tokenMatch[1].trim();
          } else {
            const lastSeat = Array.from(this.ctx.getSelectedSeatIds()).pop();
            if (lastSeat) seatLabel = lastSeat;
          }
        }

        if (seatLabel) {
          this.ctx.blacklistSeat(seatLabel);
        }

        this.logger?.warn('Seat unavailable error modal detected (-1242)', {
          seatLabel,
          modalText: text.slice(0, 100),
        });

        const modalRaw = (modal.rawElement || modal) as HTMLElement;
        let actionBtn: DOMElementLike | null = null;

        if (modalRaw && typeof modalRaw.querySelectorAll === 'function') {
          const clickables = Array.from(
            modalRaw.querySelectorAll('button, a, [role="button"], div, span')
          ) as HTMLElement[];

          const changeSeatEl = clickables.find((el) => {
            const t = (el.textContent || '').trim().toLowerCase();
            return t.includes('chọn ghế khác') || t.includes('đổi ghế') || t === 'chọn ghế khác';
          });

          const reselectEl =
            changeSeatEl ||
            clickables.find((el) => {
              const t = (el.textContent || '').trim().toLowerCase();
              return t.includes('chọn lại vé') || t.includes('chọn lại') || t.includes('quay lại');
            });

          const primaryEl =
            reselectEl ||
            (modalRaw.querySelector(
              'button.ant-btn-primary, button.ant-btn, [class*="btn-primary"], [class*="tbox-btn--primary"], button'
            ) as HTMLElement | null);

          if (primaryEl) {
            actionBtn = wrapBrowserElement(primaryEl);
          }
        }

        if (!actionBtn && doc) {
          const allGlobal = Array.from(
            doc.querySelectorAll('button, a, [role="button"]')
          ) as HTMLElement[];
          const globalMatch = allGlobal.find((el) => {
            const t = (el.textContent || '').trim().toLowerCase();
            return t.includes('chọn ghế khác') || t.includes('đổi ghế');
          });
          if (globalMatch) {
            actionBtn = wrapBrowserElement(globalMatch);
          }
        }

        if (actionBtn && typeof (actionBtn as MutableDOMElement).click === 'function') {
          this.logger?.info('Clicking "Chọn ghế khác" button in error modal to recover');
          this.ctx.markRecoveryInitiated();
          this.ctx.clickElement(actionBtn);
          await new Promise((r) => setTimeout(r, 400));

          for (let i = 0; i < 3; i++) {
            const res = await this.confirmCancelOrderForReselect();
            if (res.status === 'confirmed' || res.status === 'blocked') break;
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        if (typeof window !== 'undefined' && window.location.href.includes('/question-form')) {
          this.logger?.info(
            'Seat unavailable modal detected on question-form; recovering to seat selection page'
          );
          await new Promise((r) => setTimeout(r, 400));
          if (window.location.href.includes('/question-form')) {
            const docEl = doc || (typeof document !== 'undefined' ? document : null);
            if (docEl) {
              const changeTicketLink = Array.from(
                docEl.querySelectorAll('a, button, [role="button"], span, div')
              ).find((el) => {
                const t = (el.textContent || '').trim().toLowerCase();
                return t.includes('chọn lại vé') || t === 'chọn lại vé';
              });
              if (changeTicketLink) {
                this.logger?.info('Clicking "Chọn lại vé" in sidebar to return to seat map');
                this.ctx.markRecoveryInitiated();
                this.ctx.clickElement(wrapBrowserElement(changeTicketLink as HTMLElement));
                await new Promise((r) => setTimeout(r, 500));

                for (let i = 0; i < 3; i++) {
                  const res = await this.confirmCancelOrderForReselect();
                  if (res.status === 'confirmed' || res.status === 'blocked') break;
                  await new Promise((r) => setTimeout(r, 300));
                }
              }
            }
          }
          if (window.location.href.includes('/question-form')) {
            this.logger?.info(
              'Navigating back to select-ticket page via history.back() / router fallback'
            );
            if (window.history && typeof window.history.back === 'function') {
              window.history.back();
            } else {
              window.location.href = window.location.href.replace(
                /\/question-form(\?.*)?$/,
                '/select-ticket$1'
              );
            }
            await new Promise((r) => setTimeout(r, 800));
          }
        }

        await this.ctx.deselectSeat(seatLabel);
        this.ctx.invalidateSeatmapCache();

        return { hasError: true, isSeatUnavailable: true, seatLabel };
      }

      const isGenericError =
        text.includes('uiii, xin lỗi') ||
        text.includes('thông báo lỗi') ||
        text.includes('vé đã hết') ||
        text.includes('số lượng vé không đủ');

      if (isGenericError) {
        this.logger?.warn('Generic error modal detected', { text: text.slice(0, 100) });
        const modalRaw = (modal.rawElement || modal) as HTMLElement;
        let actionBtn: HTMLElement | null = null;
        if (modalRaw && typeof modalRaw.querySelectorAll === 'function') {
          const clickables = Array.from(
            modalRaw.querySelectorAll('button, a, [role="button"]')
          ) as HTMLElement[];
          actionBtn =
            clickables.find((el) => {
              const t = (el.textContent || '').trim().toLowerCase();
              return (
                t.includes('đóng') ||
                t.includes('ok') ||
                t.includes('xác nhận') ||
                t.includes('thử lại')
              );
            }) ||
            (modalRaw.querySelector(
              'button.ant-btn-primary, [class*="btn-primary"], button'
            ) as HTMLElement | null);
        }
        if (actionBtn && typeof actionBtn.click === 'function') {
          this.ctx.clickElement(wrapBrowserElement(actionBtn));
          await new Promise((r) => setTimeout(r, 400));
        }
        return { hasError: true, isSeatUnavailable: false };
      }
    }

    return { hasError: false, isSeatUnavailable: false };
  }
}
