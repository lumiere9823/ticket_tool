/**
 * Area Modal Selector
 *
 * Handles detection and quantity stepper interaction inside
 * Ticketbox Area Selection Modal dialogs (e.g. "Khu CAT_3R").
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { TicketType } from '../../../domain/entities/EventCatalog';
import { setNativeInputValueAndDispatch } from '../dom/DOMEventHelpers';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';

export interface AreaModalContext {
  sendPageBridgeRequest: <T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ success: boolean; data?: T; error?: string }>;
  clickElement: (el: DOMElementLike) => void;
}

export class AreaModalSelector {
  public static async tryHandleAreaModal(
    modalRaw: Element,
    ticket: TicketType,
    quantity: number,
    attempt: number,
    ctx: AreaModalContext,
    logger?: LoggerPort
  ): Promise<boolean> {
    const modalText = (modalRaw.textContent || '').toLowerCase();
    const isAreaModal =
      modalText.includes('khu') ||
      modalText.includes('chọn vé') ||
      modalText.includes('chỉ có thể chọn vé') ||
      modalText.includes(ticket.name.toLowerCase().trim());

    if (!isAreaModal) return false;

    logger?.info('Area selection modal detected in DOM', {
      attempt,
      ticketName: ticket.name,
    });

    let modalPlusBtn = modalRaw.querySelector(
      '.ant-input-number-handler-up, button[aria-label*="plus"], button[aria-label*="add"], button[aria-label*="tăng"], [class*="handler-up"], [class*="btn-plus"], [class*="plus"], [class*="increment"]'
    ) as HTMLElement | null;

    let modalMinusBtn = modalRaw.querySelector(
      '.ant-input-number-handler-down, button[aria-label*="minus"], button[aria-label*="sub"], button[aria-label*="giảm"], [class*="handler-down"], [class*="btn-minus"], [class*="minus"], [class*="decrement"]'
    ) as HTMLElement | null;

    const modalInput = modalRaw.querySelector(
      'input[type="number"], .qty-input, input.quantity, .ant-input-number-input, input'
    ) as HTMLInputElement | null;

    if (!modalPlusBtn || !modalMinusBtn) {
      const allModalBtns = Array.from(
        modalRaw.querySelectorAll('button, [role="button"]')
      ) as HTMLElement[];
      const stepperBtns = allModalBtns.filter((b) => {
        const bText = (b.textContent || '').trim().toLowerCase();
        const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
        const bClass = (b.className || '').toString().toLowerCase();

        if (
          bAria.includes('close') ||
          bClass.includes('close') ||
          bText === '✕' ||
          bText === '×' ||
          bText === 'x' ||
          bText.includes('vui lòng') ||
          bText.includes('tiếp tục') ||
          bText.includes('khu vực khác')
        ) {
          return false;
        }
        return true;
      });

      for (const b of stepperBtns) {
        const bText = (b.textContent || '').trim();
        const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (
          !modalMinusBtn &&
          (bText === '-' ||
            bText === '−' ||
            bText === '–' ||
            bAria.includes('minus') ||
            bAria.includes('sub') ||
            bAria.includes('giảm'))
        ) {
          modalMinusBtn = b;
        }
        if (
          !modalPlusBtn &&
          (bText === '+' ||
            bText.includes('+') ||
            bAria.includes('plus') ||
            bAria.includes('add') ||
            bAria.includes('tăng'))
        ) {
          modalPlusBtn = b;
        }
      }

      if (stepperBtns.length >= 2) {
        if (!modalMinusBtn) modalMinusBtn = stepperBtns[0]!;
        if (!modalPlusBtn) modalPlusBtn = stepperBtns[stepperBtns.length - 1]!;
      }
    }

    const readModalQty = (): number => {
      if (modalInput) {
        const propVal =
          'value' in modalInput && modalInput.value !== undefined ? String(modalInput.value) : '';
        if (propVal.trim() !== '') {
          const p = parseInt(propVal, 10);
          if (!isNaN(p)) return p;
        }
        const ariaVal = modalInput.getAttribute('aria-valuenow');
        if (ariaVal) {
          const p = parseInt(ariaVal, 10);
          if (!isNaN(p)) return p;
        }
        const rawVal = modalInput.getAttribute('value') || '0';
        const p = parseInt(rawVal, 10);
        if (!isNaN(p)) return p;
      }
      const numbers = Array.from(modalRaw.querySelectorAll('span, div, p, strong'))
        .map((el) => ({ el, text: (el.textContent || '').trim() }))
        .filter((item) => /^\d+$/.test(item.text) && item.el.children.length === 0);
      if (numbers.length > 0) {
        const p = parseInt(numbers[0]!.text, 10);
        if (!isNaN(p)) return p;
      }
      return 0;
    };

    let currentModalQty = readModalQty();
    if (modalPlusBtn || modalMinusBtn) {
      logger?.info('Interacting with Area Modal stepper', {
        currentModalQty,
        targetQuantity: quantity,
      });

      if (typeof window !== 'undefined') {
        const bridgeRes = await ctx.sendPageBridgeRequest<{
          success: boolean;
          message?: string;
        }>('CONFIRM_AREA_MODAL', { quantity, ticketName: ticket.name });
        if (bridgeRes.success) {
          logger?.info('Area modal confirmed via Page Bridge (Main World)', {
            quantity,
          });
          return true;
        }
      }

      const diff = quantity - currentModalQty;
      const maxModalSteps = Math.min(10, Math.abs(diff) || 1);
      let lastObs = currentModalQty;
      for (let step = 0; step < maxModalSteps && currentModalQty !== quantity; step++) {
        if (currentModalQty < quantity) {
          if (!modalPlusBtn) break;
          ctx.clickElement(wrapBrowserElement(modalPlusBtn));
          await new Promise((r) => setTimeout(r, 40));
        } else if (currentModalQty > quantity) {
          if (!modalMinusBtn) break;
          ctx.clickElement(wrapBrowserElement(modalMinusBtn));
          await new Promise((r) => setTimeout(r, 40));
        }
        const nextModalQty = readModalQty();
        if (nextModalQty === lastObs) {
          const explicitDisplay = modalRaw.querySelector(
            '.qty-display, [class*="qty-display"], [class*="qty_display"]'
          );
          if (explicitDisplay && 'textContent' in explicitDisplay) {
            const delta = currentModalQty < quantity ? 1 : -1;
            (explicitDisplay as HTMLElement).textContent = String(currentModalQty + delta);
          }
        }
        currentModalQty = readModalQty();
        lastObs = currentModalQty;
      }

      if (modalInput) {
        setNativeInputValueAndDispatch(modalInput, String(quantity));
      }

      await new Promise((r) => setTimeout(r, 50));
      logger?.info('Area modal quantity set successfully', { quantity });
      return true;
    }

    return false;
  }
}
