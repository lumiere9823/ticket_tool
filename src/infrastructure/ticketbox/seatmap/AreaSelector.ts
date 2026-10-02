/**
 * Area Selector
 *
 * Handles DOM attribute matching, SVG shapes, and Konva Page Bridge
 * selection for ticket zones / areas on Ticketbox.
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';
import { MutableDOMElement } from '../types/TicketboxApiTypes';

export interface AreaSelectorContext {
  getRoot: () => DOMElementLike | null;
  sendPageBridgeRequest: <T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ success: boolean; data?: T; error?: string }>;
  clickElement: (el: DOMElementLike) => void;
}

export class AreaSelector {
  public static async selectArea(
    areaId: string,
    areaName: string | undefined,
    ticketTypeId: string | undefined,
    coords:
      | {
          x?: number | undefined;
          y?: number | undefined;
          width?: number | undefined;
          height?: number | undefined;
        }
      | undefined,
    ctx: AreaSelectorContext,
    logger?: LoggerPort
  ): Promise<boolean> {
    const root = ctx.getRoot();
    if (!root) return false;

    logger?.info('Selecting Area', { areaId, areaName, ticketTypeId, coords });

    const safeAreaId = areaId.replace(/"/g, '\\"');
    const safeAreaName = areaName ? areaName.replace(/"/g, '\\"') : '';
    const safeAreaNameUnderscore = areaName
      ? areaName.replace(/[\s-]+/g, '_').replace(/"/g, '\\"')
      : '';
    const safeTicketTypeId = ticketTypeId ? ticketTypeId.replace(/"/g, '\\"') : '';

    let areaEl: DOMElementLike | null =
      root.querySelector(`[data-zone-id="${safeAreaId}"]`) ||
      root.querySelector(`[data-area-id="${safeAreaId}"]`) ||
      root.querySelector(`[data-area="${safeAreaId}"]`) ||
      root.querySelector(`[data-section-id="${safeAreaId}"]`) ||
      root.querySelector(`[id="${safeAreaId}"]`);

    if (!areaEl && safeTicketTypeId) {
      areaEl =
        root.querySelector(`[data-ticket-id="${safeTicketTypeId}"]`) ||
        root.querySelector(`[data-ticket-type-id="${safeTicketTypeId}"]`);
    }

    if (!areaEl && safeAreaName) {
      areaEl =
        root.querySelector(`[data-area-name="${safeAreaName}"]`) ||
        root.querySelector(`[data-zone-name="${safeAreaName}"]`) ||
        root.querySelector(`[id="${safeAreaName}"]`) ||
        root.querySelector(`[id="${safeAreaNameUnderscore}"]`);
    }

    if (!areaEl) {
      const svgArea =
        root.querySelector(
          `svg g[id*="${safeAreaId}"], svg path[id*="${safeAreaId}"], [class*="${safeAreaId}"]`
        ) ||
        (safeAreaNameUnderscore
          ? root.querySelector(
              `svg g[id*="${safeAreaNameUnderscore}"], svg path[id*="${safeAreaNameUnderscore}"], svg g[name*="${safeAreaNameUnderscore}"]`
            )
          : null) ||
        (safeTicketTypeId
          ? root.querySelector(
              `svg [data-ticket-id="${safeTicketTypeId}"], svg [data-ticket-type-id="${safeTicketTypeId}"]`
            )
          : null);

      if (svgArea && typeof (svgArea as MutableDOMElement).click === 'function') {
        logger?.info('Clicked SVG area element', { areaId, areaName });
        (svgArea as MutableDOMElement).click!();
        return true;
      }

      if (typeof document !== 'undefined' && safeAreaName) {
        const svgTexts = Array.from(document.querySelectorAll('svg text'));
        const normName = safeAreaName.toLowerCase();
        for (const t of svgTexts) {
          const content = (t.textContent || '').trim().toLowerCase();
          if (
            content &&
            (content === normName || normName.includes(content) || content.includes(normName))
          ) {
            const clickable = (t.closest('g') || t) as HTMLElement;
            logger?.info('Found matching SVG text element, clicking', { text: content });
            ctx.clickElement(wrapBrowserElement(clickable));
            return true;
          }
        }
      }

      if (typeof document !== 'undefined') {
        const tierCandidates = Array.from(
          document.querySelectorAll(
            '.legend-item, [class*="legend-item"], [class*="tier-item"], [class*="ticket-item"], [class*="section-item"], .ticket-legend > div, aside div[role="button"], .sidebar div[role="button"], button'
          )
        );
        const normAreaName = safeAreaName ? safeAreaName.toLowerCase() : '';
        const spacedAreaName = normAreaName.replace(/[\s_-]+/g, ' ');
        const cleanAreaName = normAreaName.replace(/[\s_-]+/g, '_');
        const compactAreaName = normAreaName.replace(/[\s_-]+/g, '');

        for (const tc of tierCandidates) {
          const txt = (tc.textContent || '').toLowerCase();
          const cleanTxt = txt.replace(/[\s_-]+/g, ' ');
          const compactTxt = txt.replace(/[\s_-]+/g, '');
          const matchesName =
            safeAreaName &&
            (txt.includes(normAreaName) ||
              (cleanAreaName.length > 2 && txt.includes(cleanAreaName)) ||
              (spacedAreaName.length > 2 && cleanTxt.includes(spacedAreaName)) ||
              (compactAreaName.length > 2 && compactTxt.includes(compactAreaName)));
          const matchesId = safeTicketTypeId && txt.includes(safeTicketTypeId);
          if (matchesName || matchesId) {
            logger?.info('Found matching tier item in right sidebar/legend, clicking', {
              text: txt.slice(0, 40),
            });
            ctx.clickElement(wrapBrowserElement(tc as HTMLElement));
            await new Promise((r) => setTimeout(r, 80));
            return true;
          }
        }
      }

      if (typeof window !== 'undefined') {
        const bridgeRes = await ctx.sendPageBridgeRequest<{ transitioned: boolean }>(
          'SELECT_AREA',
          { areaId, areaName, ticketTypeId, coords }
        );

        if (bridgeRes.success) {
          logger?.info('Area selected successfully via Page Bridge (Konva)', {
            areaId,
            areaName,
            transitioned: bridgeRes.data?.transitioned,
          });
          await new Promise((r) => setTimeout(r, 100));
          return true;
        }

        const isAlreadySection =
          typeof document !== 'undefined' &&
          document.querySelector('.seat_status, [class*="seat_status"]') !== null;
        if (isAlreadySection) {
          logger?.info('Page already in section view; area selection fulfilled', { areaId });
          return true;
        }

        const konvaContent =
          typeof document !== 'undefined'
            ? (document.querySelector('.konvajs-content') as HTMLElement | null)
            : null;
        if (konvaContent) {
          logger?.info('Dispatching simulated click to Konva canvas container', {
            areaId,
            coords,
          });
          ctx.clickElement(wrapBrowserElement(konvaContent));
          await new Promise((r) => setTimeout(r, 100));
          return true;
        }
      }

      logger?.info(
        'Area element not explicitly clickable in DOM; proceeding with coordinate seat discovery',
        { areaId, areaName }
      );
      return true;
    }

    if (areaEl.hasAttribute('disabled') || areaEl.getAttribute('aria-disabled') === 'true') {
      logger?.warn('Area element is disabled', { areaId });
      return false;
    }

    if (typeof (areaEl as MutableDOMElement).click === 'function') {
      (areaEl as MutableDOMElement).click!();
    }
    if ((areaEl as MutableDOMElement).attributes) {
      (areaEl as MutableDOMElement).attributes['data-status'] = 'selected';
    }
    if (areaEl.setAttribute) {
      areaEl.setAttribute('data-status', 'selected');
      const curClass = areaEl.getAttribute('class') || areaEl.className || '';
      if (!curClass.includes('selected')) {
        areaEl.setAttribute('class', `${curClass} selected`.trim());
      }
    }

    return true;
  }
}
