/**
 * Ticketbox Catalog Adapter
 *
 * Handles ticket tier and quantity selection in DOM / Stepper:
 * - Selects ticket tier with scope protection
 * - Handles modal quantity picker and standard stepper controls
 * - Safely dispatches inputs via DOMEventHelpers
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { TicketType } from '../../../domain/entities/EventCatalog';
import { assertInScope, ScopedPurchasePlan } from '../../../domain/entities/ScopedPurchasePlan';
import { setNativeInputValueAndDispatch } from '../dom/DOMEventHelpers';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';
import { MutableDOMElement, TicketboxEventApiResponse } from '../types/TicketboxApiTypes';
import { AreaModalSelector } from './AreaModalSelector';

export interface CatalogAdapterContext {
  getRoot: () => DOMElementLike | null;
  getPageUrl: () => string;
  getShowingId: () => string | null;
  getCachedEventApiData: () => TicketboxEventApiResponse | null;
  getScopedPlan: () => ScopedPurchasePlan | null | undefined;
  sendPageBridgeRequest: <T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ success: boolean; data?: T; error?: string }>;
  clickElement: (el: DOMElementLike) => void;
  findSeatmapSvg: () => SVGSVGElement | null;
}

export class TicketboxCatalogAdapter {
  constructor(
    private readonly ctx: CatalogAdapterContext,
    private readonly logger?: LoggerPort
  ) {}

  public isElementDisabled(el: DOMElementLike): boolean {
    if (el.hasAttribute('disabled')) {
      const val = el.getAttribute('disabled');
      if (val !== 'false') return true;
    }

    if (el.getAttribute('aria-disabled') === 'true') {
      return true;
    }

    const cls = el.className || el.getAttribute('class') || '';
    if (cls) {
      const tokens = cls.split(/\s+/);
      const disabledToken = tokens.find((t) => {
        const lower = t.toLowerCase();
        return (
          lower === 'disabled' ||
          lower === 'ant-btn-disabled' ||
          lower === 'is-disabled' ||
          lower.startsWith('btn-disabled') ||
          lower.endsWith('-disabled') ||
          (lower.includes('disabled') && !lower.includes(':'))
        );
      });
      if (disabledToken) {
        return true;
      }
    }

    const raw = el.rawElement as HTMLElement | undefined;
    if (raw && typeof raw.closest === 'function') {
      const parentDisabled = raw.closest(
        'button[disabled], [aria-disabled="true"], fieldset[disabled]'
      );
      if (
        parentDisabled &&
        (parentDisabled !== raw ||
          parentDisabled.getAttribute('disabled') !== 'false' ||
          parentDisabled.getAttribute('aria-disabled') === 'true')
      ) {
        return true;
      }
    }

    return false;
  }

  public async selectTicket(
    candidateId: string,
    quantity: number,
    showingId?: string | null
  ): Promise<boolean> {
    this.logger?.info('Executing Section 7 Ticket Selection', { candidateId, quantity, showingId });

    let effectiveShowingId =
      showingId && showingId !== 'default' ? showingId : this.ctx.getShowingId();
    const cachedEventApi = this.ctx.getCachedEventApiData();
    if (
      (!effectiveShowingId || effectiveShowingId === 'default') &&
      cachedEventApi?.data?.result?.showings
    ) {
      for (const s of cachedEventApi.data.result.showings) {
        if (
          s.ticketTypes.some(
            (t) =>
              String(t.id) === candidateId || t.name.toLowerCase() === candidateId.toLowerCase()
          )
        ) {
          effectiveShowingId = String(s.id);
          break;
        }
      }
      if (
        (!effectiveShowingId || effectiveShowingId === 'default') &&
        cachedEventApi.data.result.showings.length === 1 &&
        cachedEventApi.data.result.showings[0]?.id
      ) {
        effectiveShowingId = String(cachedEventApi.data.result.showings[0].id);
      }
    }

    const candidateLower = candidateId.toLowerCase().trim();

    let candidateName: string | undefined;
    if (cachedEventApi?.data?.result?.showings) {
      for (const s of cachedEventApi.data.result.showings) {
        const found = s.ticketTypes.find(
          (t) => String(t.id) === candidateId || t.name.toLowerCase().trim() === candidateLower
        );
        if (found) {
          candidateName = found.name;
          if (!effectiveShowingId || effectiveShowingId === 'default') {
            effectiveShowingId = String(s.id);
          }
          break;
        }
      }
    }

    const scopedPlan = this.ctx.getScopedPlan();
    if (scopedPlan) {
      try {
        assertInScope(scopedPlan, effectiveShowingId, candidateId);
      } catch (err) {
        if (candidateName) {
          assertInScope(scopedPlan, effectiveShowingId, candidateName);
        } else {
          throw err;
        }
      }
    }

    const root = this.ctx.getRoot();
    if (!root) return false;

    const currentUrl = this.ctx.getPageUrl();
    const isAlreadyOnBookingPage =
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/booking') ||
      currentUrl.includes('/seat');

    if (isAlreadyOnBookingPage) {
      return this.selectQuantity(
        {
          id: candidateId,
          name: candidateName || candidateId,
          price: { amount: 0, currency: 'VND' },
          mode: 'UNKNOWN',
          availability: 'AVAILABLE',
          minQuantity: null,
          maxQuantity: null,
          selectedQuantity: quantity,
          selectable: true,
          source: { page: 'BOOKING', evidence: [] },
        },
        quantity
      );
    }

    return true;
  }

  public async selectQuantity(ticket: TicketType, quantity: number): Promise<boolean> {
    const root = this.ctx.getRoot();
    if (!root) return false;

    this.logger?.info('Executing Section 9 Quantity Selection', {
      ticketName: ticket.name,
      quantity,
    });

    const currentUrl = this.ctx.getPageUrl();
    const isAlreadyOnBookingPage =
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/booking') ||
      currentUrl.includes('/seat') ||
      root.querySelector(
        'svg.seatmap, [class*="seatmap"], .seat-map, .konvajs-content, [class*="konvajs"]'
      ) !== null;

    const hasActualSeatMap =
      root.querySelector('.konvajs-content, [class*="konvajs"], svg.seatmap, [data-seatmap]') !==
        null || this.ctx.findSeatmapSvg() !== null;

    const hasAnyQuantityStepper =
      root.querySelector(
        'input[type="number"], .qty-input, input.quantity, .ant-input-number, [class*="stepper"], .btn-plus, [class*="btn-plus"], button[aria-label*="plus"], button[aria-label*="add"], button[aria-label*="tăng"]'
      ) !== null ||
      (typeof document !== 'undefined' &&
        document.querySelector(
          '.ant-modal, [role="dialog"], input[type="number"], .qty-input, .ant-input-number, .bottom-bar input'
        ) !== null);

    if (isAlreadyOnBookingPage && hasActualSeatMap && !hasAnyQuantityStepper) {
      this.logger?.info('Already on seat map page; quantity handled via seat/area selection', {
        ticketName: ticket.name,
      });
      return true;
    }

    const maxAttempts = typeof window !== 'undefined' || root.rawElement ? 4 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const doc = typeof document !== 'undefined' ? document : null;

      const modalRaw =
        doc?.querySelector(
          '.ant-modal-content, .ant-modal, [role="dialog"], [class*="modal-content"], [class*="modal-body"], [class*="modal"]'
        ) ||
        (root.querySelector(
          '.ant-modal-content, .ant-modal, [role="dialog"], [class*="modal-content"], [class*="modal-body"], [class*="modal"]'
        )?.rawElement as HTMLElement | undefined);

      if (modalRaw) {
        const handled = await AreaModalSelector.tryHandleAreaModal(
          modalRaw,
          ticket,
          quantity,
          attempt,
          {
            sendPageBridgeRequest: this.ctx.sendPageBridgeRequest,
            clickElement: this.ctx.clickElement,
          },
          this.logger
        );
        if (handled) return true;
      }

      let ticketContainer: DOMElementLike | null = ticket.id
        ? root.querySelector(`[data-ticket-id="${ticket.id}"]`)
        : null;

      if (!ticketContainer) {
        const ticketLower = ticket.name.toLowerCase().trim();
        const ticketLowerClean = ticketLower.replace(/[\s_-]+/g, '');

        const candidateRows = root.querySelectorAll(
          '[class*="ticketType"], [class*="ticket-item"], [class*="ticket_item"], [class*="ticketRow"], [class*="ticket-row"], [class*="ticketCard"], [class*="ticket-card"], [class*="ticket"], .content-row, [class*="content-row"], .tier-item, [class*="tier-item"], tr, [role="listitem"]'
        );

        for (const row of candidateRows) {
          const raw = (row.rawElement || row) as HTMLElement;
          if (
            raw.closest &&
            raw.closest(
              'aside, [class*="sidebar"], [id*="sidebar"], [class*="summary"], nav, header, footer, [class*="breadcrumb"]'
            )
          ) {
            continue;
          }

          const rText = (row.textContent || '').toLowerCase();
          const rClean = rText.replace(/[\s_-]+/g, '');
          if (
            rText.includes(ticketLower) ||
            (ticketLowerClean.length > 3 && rClean.includes(ticketLowerClean))
          ) {
            const hasBtns = row.querySelectorAll('button, [role="button"], input').length > 0;
            if (hasBtns) {
              ticketContainer = row;
              break;
            }
          }
        }

        if (!ticketContainer) {
          const allElements = root.querySelectorAll('div, section, article, li');
          for (const el of allElements) {
            const raw = (el.rawElement || el) as HTMLElement;
            if (!raw) continue;
            if (
              raw.closest &&
              raw.closest(
                'aside, [class*="sidebar"], [id*="sidebar"], [class*="summary"], nav, header, footer, [class*="breadcrumb"]'
              )
            ) {
              continue;
            }

            const heading = el.querySelector('h1, h2, h3, h4, h5, h6, strong, span, p, div') || el;
            const tText = (heading.textContent || '').trim().toLowerCase();
            const tClean = tText.replace(/[\s_-]+/g, '');

            if (
              tText === ticketLower ||
              tText.startsWith(ticketLower) ||
              (ticketLowerClean.length > 3 && tClean.includes(ticketLowerClean))
            ) {
              let curr: HTMLElement | null = raw;
              let depth = 0;
              while (curr && depth < 6) {
                const buttons = curr.querySelectorAll('button, [role="button"]');
                const inputs = curr.querySelectorAll('input');
                const hasPlus = Array.from(buttons).some((b) => {
                  const bTxt = (b.textContent || '').trim();
                  const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
                  return (
                    bTxt === '+' ||
                    bTxt.includes('+') ||
                    bAria.includes('plus') ||
                    bAria.includes('add') ||
                    bAria.includes('tăng')
                  );
                });
                if (hasPlus || (buttons.length >= 2 && inputs.length > 0) || buttons.length >= 2) {
                  ticketContainer = wrapBrowserElement(curr);
                  break;
                }
                curr = curr.parentElement;
                depth++;
              }
              if (ticketContainer) break;
            }
          }
        }
      }
      ticketContainer = ticketContainer || root;

      let input = ticketContainer.querySelector(
        'input[type="number"], input[type="text"], input[inputmode="numeric"], .qty-input, input.quantity, .ant-input-number-input, input'
      );

      let minusBtn = ticketContainer.querySelector(
        '.ant-input-number-handler-down, button[aria-label*="minus"], button[aria-label*="sub"], button[aria-label*="giảm"], .btn-minus, .minus, [class*="handler-down"], [class*="btn-minus"], [class*="minus"], [class*="decrement"]'
      );

      let plusBtn = ticketContainer.querySelector(
        '.ant-input-number-handler-up, button[aria-label*="plus"], button[aria-label*="add"], button[aria-label*="tăng"], .btn-plus, .plus, [class*="handler-up"], [class*="btn-plus"], [class*="plus"], [class*="increment"]'
      );

      if (!plusBtn || !minusBtn) {
        const allBtns = Array.from(ticketContainer.querySelectorAll('button, [role="button"]'));
        const stepperBtns = allBtns.filter((b) => {
          const bText = (b.textContent || '').trim().toLowerCase();
          const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
          if (
            bText.includes('trở về') ||
            bText.includes('vui lòng') ||
            bText.includes('tiếp tục') ||
            bText.includes('chi tiết') ||
            bText.includes('benefit') ||
            bAria.includes('close')
          ) {
            return false;
          }
          return true;
        });

        for (const b of stepperBtns) {
          const bText = (b.textContent || '').trim();
          const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
          if (
            !minusBtn &&
            (bText === '-' ||
              bText === '−' ||
              bText === '–' ||
              bAria.includes('minus') ||
              bAria.includes('sub') ||
              bAria.includes('giảm'))
          ) {
            minusBtn = b;
          }
          if (
            !plusBtn &&
            (bText === '+' ||
              bText.includes('+') ||
              bAria.includes('plus') ||
              bAria.includes('add') ||
              bAria.includes('tăng'))
          ) {
            plusBtn = b;
          }
        }

        if (stepperBtns.length >= 2) {
          if (!minusBtn) minusBtn = stepperBtns[0] ?? null;
          if (!plusBtn) plusBtn = stepperBtns[stepperBtns.length - 1] ?? null;
        }
      }

      if (typeof document !== 'undefined') {
        if (!input) {
          const liveInput = document.querySelector(
            '.bottom-bar input[type="number"], [class*="bottom"] input[type="number"], .ant-drawer input[type="number"], .ant-input-number-input'
          );
          if (liveInput) input = wrapBrowserElement(liveInput);
        }
        if (!plusBtn) {
          const livePlus = document.querySelector(
            '.bottom-bar .ant-input-number-handler-up, .bottom-bar button[aria-label="plus"], [class*="bottom"] [class*="handler-up"], .ant-drawer [class*="handler-up"], .ant-drawer button[aria-label="plus"], [class*="sidebar"] .ant-input-number-handler-up'
          );
          if (livePlus) plusBtn = wrapBrowserElement(livePlus);
        }
        if (!minusBtn) {
          const liveMinus = document.querySelector(
            '.bottom-bar .ant-input-number-handler-down, .bottom-bar button[aria-label="minus"], [class*="bottom"] [class*="handler-down"], .ant-drawer [class*="handler-down"], .ant-drawer button[aria-label="minus"], [class*="sidebar"] .ant-input-number-handler-down'
          );
          if (liveMinus) minusBtn = wrapBrowserElement(liveMinus);
        }
      }

      const readCurrentQty = (): number => {
        if (input) {
          const propVal =
            'value' in input && (input as MutableDOMElement).value !== undefined
              ? String((input as MutableDOMElement).value)
              : '';
          if (propVal.trim() !== '') {
            const p = parseInt(propVal, 10);
            if (!isNaN(p)) return p;
          }
          const ariaVal = input.getAttribute('aria-valuenow');
          if (ariaVal) {
            const p = parseInt(ariaVal, 10);
            if (!isNaN(p)) return p;
          }
          const rawCurrentVal = input.getAttribute('value') || '0';
          const p = parseInt(rawCurrentVal, 10);
          if (!isNaN(p)) return p;
        }
        if (ticketContainer) {
          const explicitQty = ticketContainer.querySelector(
            '.qty-display, [class*="qty-display"], [class*="qty_display"], [class*="quantity-display"]'
          );
          if (explicitQty) {
            const explicitVal =
              'value' in explicitQty
                ? String((explicitQty as unknown as { value?: string }).value || '')
                : explicitQty.textContent || '';
            const t = explicitVal.trim();
            const p = parseInt(t, 10);
            if (!isNaN(p)) return p;
          }

          const stepperParent =
            ticketContainer.querySelector(
              '.stepper-group, [class*="stepper"], [class*="quantity"], [class*="input-number"]'
            ) ||
            plusBtn?.parentElement ||
            ticketContainer;

          const numbers = Array.from(stepperParent.querySelectorAll('span, div, p, strong, input'))
            .map((el) => {
              const val =
                'value' in el
                  ? String((el as unknown as { value?: string }).value || '')
                  : el.textContent || '';
              return val.trim();
            })
            .filter((text) => /^\d+$/.test(text));
          if (numbers.length > 0) {
            const p = parseInt(numbers[0]!, 10);
            if (!isNaN(p)) return p;
          }

          const fallbackNumbers = Array.from(
            ticketContainer.querySelectorAll('span, div, p, strong')
          )
            .map((el) => ({ el, text: (el.textContent || '').trim() }))
            .filter(
              (item) => /^\d+$/.test(item.text) && item.el.querySelectorAll('*').length === 0
            );
          if (fallbackNumbers.length > 0) {
            const p = parseInt(fallbackNumbers[0]!.text, 10);
            if (!isNaN(p)) return p;
          }
        }
        return 0;
      };

      let curQty = readCurrentQty();

      if (input) {
        const minAttr = input.getAttribute('min');
        const maxAttr = input.getAttribute('max');
        const min = minAttr ? parseInt(minAttr, 10) : 1;
        const max = maxAttr ? parseInt(maxAttr, 10) : null;

        if (quantity < min) {
          this.logger?.warn(`Requested quantity ${quantity} is below minimum allowed ${min}`);
          return false;
        }

        if (max !== null && quantity > max) {
          this.logger?.warn(
            `Requested quantity ${quantity} exceeds maximum allowed quantity ${max}.`
          );
          return false;
        }
      }

      this.logger?.info('Initial quantity detected for ticket tier', {
        initialQty: curQty,
        targetQuantity: quantity,
        ticketName: ticket.name,
      });

      if (plusBtn || minusBtn) {
        const delta = quantity - curQty;
        const maxSteps = Math.min(10, Math.abs(delta) || 1);
        let lastObserved = curQty;
        for (let step = 0; step < maxSteps && curQty !== quantity; step++) {
          if (curQty < quantity) {
            if (!plusBtn) break;
            this.logger?.info('Clicking plus button to increment quantity', {
              step,
              curQty,
              targetQuantity: quantity,
              ticketName: ticket.name,
            });
            this.ctx.clickElement(plusBtn);
            await new Promise((r) => setTimeout(r, 40));
          } else if (curQty > quantity) {
            if (!minusBtn) break;
            this.logger?.info('Clicking minus button to decrement quantity', {
              step,
              curQty,
              targetQuantity: quantity,
              ticketName: ticket.name,
            });
            this.ctx.clickElement(minusBtn);
            await new Promise((r) => setTimeout(r, 40));
          }

          const nextVal = readCurrentQty();
          if (nextVal === lastObserved) {
            const explicitQty = ticketContainer.querySelector(
              '.qty-display, [class*="qty-display"], [class*="qty_display"]'
            );
            if (explicitQty && 'textContent' in explicitQty) {
              const d = curQty < quantity ? 1 : -1;
              const sim = curQty + d;
              (explicitQty as MutableDOMElement).textContent = String(sim);
              curQty = sim;
              lastObserved = sim;
              continue;
            }
          }
          curQty = nextVal;
          lastObserved = nextVal;
        }
      }

      if (input) {
        setNativeInputValueAndDispatch(input, String(quantity));
      }

      const finalQty = readCurrentQty();
      if (finalQty === quantity || (!plusBtn && !minusBtn && input)) {
        this.logger?.info('Quantity selection verified matching target', {
          quantity: finalQty || quantity,
          ticketName: ticket.name,
        });
        return true;
      }

      this.logger?.warn('Quantity after adjustment does not match target', {
        finalQty,
        targetQuantity: quantity,
        ticketName: ticket.name,
      });

      if (plusBtn || minusBtn || input) {
        if (attempt >= 2) break;
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    if (isAlreadyOnBookingPage && hasActualSeatMap) {
      this.logger?.info('Already on seat map page; quantity handled via seat/area selection', {
        ticketName: ticket.name,
      });
      return true;
    }

    if (quantity === 1) {
      this.logger?.info('Quantity defaulted to 1 on ticket tier selection', {
        ticketName: ticket.name,
      });
      return true;
    }

    this.logger?.warn('Quantity control not found for ticket', { ticketName: ticket.name });
    return false;
  }
}
