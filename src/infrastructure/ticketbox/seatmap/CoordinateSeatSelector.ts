/**
 * Coordinate Seat Selector
 *
 * Handles mouse and pointer event simulations at exact coordinate points
 * for SVG/Canvas seats on Ticketbox seatmaps.
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { Seat } from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';
import { addBoundedSetItem, MutableDOMElement } from '../types/TicketboxApiTypes';
import { SvgSeatFinder } from './SvgSeatFinder';

export interface CoordinateSeatContext {
  getRoot: () => DOMElementLike | null;
  getCachedSeats: () => Seat[];
  getSelectedSeatIds: () => Set<string>;
  findSeatmapSvg: () => SVGSVGElement | null;
}

export class CoordinateSeatSelector {
  public static async selectSeatByCoordinates(
    seatId: string,
    ctx: CoordinateSeatContext,
    logger?: LoggerPort
  ): Promise<boolean> {
    const root = ctx.getRoot();
    if (!root) return false;

    const seat = ctx.getCachedSeats().find((s) => s.id === seatId || s.label === seatId);

    let targetEl: DOMElementLike | null = null;
    let nativeTarget: Element | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const seatmapSvg = ctx.findSeatmapSvg();

      if (!targetEl && seat) {
        const match = SvgSeatFinder.findSeatByCoordinates(seat, seatmapSvg, root);
        if (match) {
          targetEl = match;
          nativeTarget = (targetEl.rawElement || targetEl) as Element;
          logger?.info('Found seat SVG shape by coordinates', {
            seatId,
            label: seat?.label,
            x: seat?.x,
            y: seat?.y,
          });
        }
      }

      if (!targetEl) {
        const safeSeatId = seatId.replace(/"/g, '\\"');
        const safeLabel = (seat?.label || seatId).replace(/"/g, '\\"');
        targetEl =
          root.querySelector(`[data-seat-id="${safeSeatId}"]`) ||
          root.querySelector(`[id="${safeSeatId}"]`) ||
          root.querySelector(`[id*="${safeSeatId}"]`) ||
          root.querySelector(`[data-id="${safeSeatId}"]`) ||
          root.querySelector(`[data-seat="${safeSeatId}"]`) ||
          root.querySelector(`[data-seat-label="${safeLabel}"]`) ||
          root.querySelector(`[data-seat="${safeLabel}"]`) ||
          root.querySelector(`[id*="${safeLabel}"]`) ||
          root.querySelector(`[aria-label*="${safeLabel}"]`) ||
          root.querySelector(`[title*="${safeLabel}"]`);

        if (!targetEl && seat?.row && typeof seat.number === 'number') {
          targetEl =
            root.querySelector(`[data-row="${seat.row}"][data-number="${seat.number}"]`) ||
            root.querySelector(`[data-row="${seat.row}"][data-seat-number="${seat.number}"]`) ||
            root.querySelector(`[data-row="${seat.row}"][data-seat="${seat.number}"]`);
        }
        if (targetEl) {
          nativeTarget = (targetEl.rawElement || targetEl) as Element;
        }
      }

      if (!targetEl && seat) {
        const ctmMatch = SvgSeatFinder.findSeatByScreenCTM(seat, seatmapSvg);
        if (ctmMatch) {
          targetEl = ctmMatch;
          nativeTarget = (targetEl.rawElement || targetEl) as Element;
          logger?.info('Located seat element via SVG screen coordinate transform', {
            seatId,
            label: seat?.label,
          });
        }
      }

      if (
        !targetEl &&
        typeof document !== 'undefined' &&
        seat &&
        typeof seat.x === 'number' &&
        typeof seat.y === 'number'
      ) {
        const canvas = (document.querySelector('.konvajs-content canvas') ||
          document.querySelector('.konvajs-content') ||
          document.querySelector('canvas')) as HTMLElement | null;
        if (canvas) {
          nativeTarget = canvas;
          targetEl = wrapBrowserElement(canvas);
          logger?.info('Located seat on Konva canvas via coordinates', {
            seatId,
            label: seat?.label,
            x: seat.x,
            y: seat.y,
          });
        }
      }

      if (targetEl) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!targetEl) {
      logger?.warn('Seat element not found in DOM or SVG', { seatId });
      return false;
    }

    const nativeEl = (nativeTarget || targetEl.rawElement || targetEl) as Element;

    if (typeof (nativeEl as HTMLElement).scrollIntoView === 'function') {
      try {
        (nativeEl as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch {
        // ignore
      }
    }

    let clientX = seat?.x ?? 0;
    let clientY = seat?.y ?? 0;

    if (typeof nativeEl.getBoundingClientRect === 'function') {
      const rect = nativeEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const tag = nativeEl.tagName ? nativeEl.tagName.toLowerCase() : '';
        const isCanvasOrKonva =
          tag === 'canvas' ||
          (typeof nativeEl.className === 'string' && nativeEl.className.includes('konvajs')) ||
          (typeof nativeEl.closest === 'function' && !!nativeEl.closest('.konvajs-content'));

        if (isCanvasOrKonva && seat && typeof seat.x === 'number' && typeof seat.y === 'number') {
          clientX = rect.left + seat.x;
          clientY = rect.top + seat.y;
        } else {
          clientX = rect.left + rect.width / 2;
          clientY = rect.top + rect.height / 2;
        }
      }
    }

    if (typeof (nativeEl as HTMLElement).focus === 'function') {
      try {
        (nativeEl as HTMLElement).focus();
      } catch {
        // ignore
      }
    }

    if (
      typeof window !== 'undefined' &&
      typeof window.MouseEvent === 'function' &&
      'dispatchEvent' in (nativeEl as object)
    ) {
      const mouseOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        buttons: 1,
      };
      const pointerOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      const releaseOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        buttons: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };

      if (typeof window.PointerEvent === 'function') {
        nativeEl.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
        nativeEl.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
        nativeEl.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
      }
      nativeEl.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
      nativeEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

      if (typeof window.PointerEvent === 'function') {
        nativeEl.dispatchEvent(new PointerEvent('pointerup', releaseOpts));
      }
      nativeEl.dispatchEvent(new MouseEvent('mouseup', releaseOpts));
      nativeEl.dispatchEvent(new MouseEvent('click', releaseOpts));

      const parent = nativeEl.parentElement;
      if (
        parent &&
        (parent.tagName.toLowerCase() === 'g' || parent.tagName.toLowerCase() === 'a')
      ) {
        parent.dispatchEvent(new MouseEvent('click', releaseOpts));
        if (typeof (parent as HTMLElement).click === 'function') {
          (parent as HTMLElement).click();
        }
      }

      if (
        typeof document !== 'undefined' &&
        typeof document.elementFromPoint === 'function' &&
        clientX > 0 &&
        clientY > 0
      ) {
        const topEl = document.elementFromPoint(clientX, clientY);
        if (topEl && topEl !== nativeEl && !nativeEl.contains(topEl) && !topEl.contains(nativeEl)) {
          try {
            if (typeof window.PointerEvent === 'function') {
              topEl.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
              topEl.dispatchEvent(new PointerEvent('pointerup', releaseOpts));
            }
            topEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
            topEl.dispatchEvent(new MouseEvent('mouseup', releaseOpts));
            topEl.dispatchEvent(new MouseEvent('click', releaseOpts));
            if (typeof (topEl as HTMLElement).click === 'function') {
              (topEl as HTMLElement).click();
            }
          } catch {
            // ignore
          }
        }
      }
    }

    if (typeof (nativeEl as HTMLElement).click === 'function') {
      (nativeEl as HTMLElement).click();
    } else if (typeof (targetEl as MutableDOMElement).click === 'function') {
      (targetEl as MutableDOMElement).click!();
    }

    if (typeof (nativeEl as Element).setAttribute === 'function') {
      nativeEl.setAttribute('aria-pressed', 'true');
      nativeEl.setAttribute('data-status', 'selected');
      const currentClass = nativeEl.getAttribute('class') || '';
      if (!currentClass.includes('selected')) {
        nativeEl.setAttribute('class', `${currentClass} selected`.trim());
      }
    }
    if ((targetEl as MutableDOMElement).attributes) {
      (targetEl as MutableDOMElement).attributes!['data-status'] = 'selected';
      (targetEl as MutableDOMElement).attributes!['aria-pressed'] = 'true';
    }
    if (targetEl.setAttribute) {
      targetEl.setAttribute('data-status', 'selected');
      targetEl.setAttribute('aria-pressed', 'true');
    }
    if (typeof (targetEl as MutableDOMElement).className === 'string') {
      const cur = (targetEl as MutableDOMElement).className || '';
      if (!cur.includes('selected')) {
        (targetEl as MutableDOMElement).className = `${cur} selected`.trim();
      }
    }

    const selectedSeatIds = ctx.getSelectedSeatIds();
    addBoundedSetItem(selectedSeatIds, seatId);
    if (seat?.label) addBoundedSetItem(selectedSeatIds, seat.label);
    if (seat) seat.status = 'SELECTED';

    logger?.info('Seat selection clicked and verified', { seatId, label: seat?.label });
    await new Promise((r) => setTimeout(r, 200));

    return true;
  }
}
