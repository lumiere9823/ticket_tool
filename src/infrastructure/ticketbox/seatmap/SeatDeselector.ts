/**
 * Seat Deselector Helper
 *
 * Handles deselecting seats in memory, clicking DOM/Ant-Design tag close icons,
 * dispatching DESELECT_SEATS to Konva Page Bridge, and clicking SVG seat shapes.
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { Seat } from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';
import { MutableDOMElement } from '../types/TicketboxApiTypes';
import { SvgSeatFinder } from './SvgSeatFinder';

export interface DeselectSeatContext {
  getRoot: () => DOMElementLike | null;
  getSelectedSeatIds: () => Set<string>;
  getCachedSeats: () => Seat[];
  invalidateSeatmapCache: () => void;
  sendPageBridgeRequest: <T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ success: boolean; data?: T; error?: string }>;
  clickElement: (el: DOMElementLike) => void;
}

export class SeatDeselector {
  public static async deselectSeat(
    seatLabel: string | undefined,
    ctx: DeselectSeatContext,
    logger?: LoggerPort
  ): Promise<boolean> {
    logger?.info('Deselecting seat from reservation', { seatLabel });

    const selectedSeatIds = ctx.getSelectedSeatIds();
    const cachedSeats = ctx.getCachedSeats();

    if (seatLabel) {
      const raw = seatLabel.trim();
      const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      selectedSeatIds.delete(raw);
      selectedSeatIds.delete(raw.toUpperCase());
      if (norm) selectedSeatIds.delete(norm);
      for (const s of cachedSeats) {
        if (
          s.id === raw ||
          s.label === raw ||
          (norm && s.label?.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm)
        ) {
          s.status = 'AVAILABLE';
        }
      }
    } else {
      selectedSeatIds.clear();
      for (const s of cachedSeats) {
        if (s.status === 'SELECTED') {
          s.status = 'AVAILABLE';
        }
      }
    }

    ctx.invalidateSeatmapCache();

    const root = ctx.getRoot();
    const doc = typeof document !== 'undefined' ? document : null;
    const targetNorm = seatLabel ? seatLabel.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;

    const tagSelector =
      '.ant-tag, [class*="seat-tag"], [class*="seat-item"], [class*="selected-seat"], [class*="seatTag"], [class*="badge"], [class*="seat-pill"], [class*="ticket-item"], [class*="cart-item"], [class*="seatItem"]';

    const domContainers: DOMElementLike[] = [];
    if (root) domContainers.push(root);
    if (doc) domContainers.push(wrapBrowserElement(doc));

    for (const container of domContainers) {
      const tags = container.querySelectorAll(tagSelector);
      for (const tag of tags) {
        const text = (tag.textContent || '').toUpperCase().trim();
        const textNorm = text.replace(/[^A-Z0-9]/g, '');
        const isMatch =
          !targetNorm ||
          textNorm.includes(targetNorm) ||
          (seatLabel && text.includes(seatLabel.toUpperCase()));

        if (isMatch) {
          const rawTag = (tag.rawElement || tag) as HTMLElement;
          const closeIcon =
            (rawTag.querySelector?.(
              '.ant-tag-close-icon, [aria-label="close"], [class*="close"], [class*="remove"], [class*="delete"], svg'
            ) as HTMLElement | null) ||
            tag.querySelector(
              '.ant-tag-close-icon, [aria-label="close"], [class*="close"], [class*="remove"], [class*="delete"], svg'
            );

          if (closeIcon && typeof (closeIcon as MutableDOMElement).click === 'function') {
            logger?.info('Clicking close icon on seat tag to deselect', { text });
            ctx.clickElement(closeIcon as DOMElementLike);
          } else if (typeof (tag as MutableDOMElement).click === 'function') {
            logger?.info('Clicking seat tag directly to deselect', { text });
            ctx.clickElement(tag);
          }
        }
      }
    }

    if (typeof window !== 'undefined') {
      const seatPayload = seatLabel ? [{ id: seatLabel, label: seatLabel }] : [];
      ctx
        .sendPageBridgeRequest('DESELECT_SEATS', { seats: seatPayload }, 1500)
        .catch(() => {});
    }

    if (seatLabel) {
      const raw = seatLabel.trim();
      const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const seat = cachedSeats.find(
        (s) =>
          s.id === raw ||
          s.label === raw ||
          (norm && s.label?.toUpperCase().replace(/[^A-Z0-9]/g, '') === norm)
      );
      if (seat && typeof seat.x === 'number' && typeof seat.y === 'number') {
        const seatmapSvg = SvgSeatFinder.findSeatmapSvg();
        if (seatmapSvg) {
          const shapes = Array.from(seatmapSvg.querySelectorAll('circle, [cx]')).map((el) =>
            wrapBrowserElement(el)
          );
          for (const s of shapes) {
            const cx = parseFloat(s.getAttribute('cx') || '');
            const cy = parseFloat(s.getAttribute('cy') || '');
            if (!isNaN(cx) && !isNaN(cy) && Math.hypot(cx - seat.x, cy - seat.y) < 5.0) {
              if (typeof (s as MutableDOMElement).click === 'function') {
                ctx.clickElement(s);
              }
              break;
            }
          }
        }
      }
    }

    return true;
  }
}
