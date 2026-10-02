/**
 * SVG Seat Finder
 *
 * Locates seatmap SVGs and seat elements on Ticketbox canvas / SVG maps
 * using coordinate distance math, screen matrix transforms (CTM), and bounding boxes.
 */

import { Seat } from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';

export class SvgSeatFinder {
  public static findSeatmapSvg(): SVGSVGElement | null {
    if (typeof document === 'undefined') return null;

    const allSvgs = Array.from(document.querySelectorAll('svg')) as SVGSVGElement[];
    if (allSvgs.length === 0) return null;

    for (const svg of allSvgs) {
      if (svg.querySelectorAll('circle, ellipse, [cx]').length > 5) {
        return svg;
      }
    }

    for (const svg of allSvgs) {
      const parent = svg.closest(
        '[class*="seat"], [id*="seat"], [class*="map"], [id*="map"], [class*="booking"]'
      );
      if (parent) {
        try {
          const rect = svg.getBoundingClientRect();
          if (rect.width > 150 && rect.height > 150) {
            return svg;
          }
        } catch {
          return svg;
        }
      }
    }

    let largestSvg: SVGSVGElement | null = null;
    let maxArea = 0;
    for (const svg of allSvgs) {
      try {
        const rect = svg.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > maxArea && rect.width > 150 && rect.height > 150) {
          maxArea = area;
          largestSvg = svg;
        }
      } catch {
        // ignore
      }
    }
    if (largestSvg) return largestSvg;

    for (const svg of allSvgs) {
      const vb = svg.getAttribute('viewBox');
      if (vb) {
        const parts = vb
          .trim()
          .split(/[\s,]+/)
          .map(parseFloat);
        if (
          parts.length === 4 &&
          typeof parts[2] === 'number' &&
          typeof parts[3] === 'number' &&
          parts[2] > 200 &&
          parts[3] > 200
        ) {
          return svg;
        }
      }
    }

    return null;
  }

  public static findSeatByCoordinates(
    seat: Seat,
    seatmapSvg: SVGSVGElement | null,
    root: DOMElementLike
  ): DOMElementLike | null {
    if (typeof seat.x !== 'number' || typeof seat.y !== 'number') {
      return null;
    }

    const shapes = seatmapSvg
      ? Array.from(seatmapSvg.querySelectorAll('circle, ellipse, rect, path, [cx]')).map((el) =>
          wrapBrowserElement(el)
        )
      : root.querySelectorAll(
          'svg circle, circle, svg rect, rect, svg ellipse, ellipse, svg path, svg [cx], [cx]'
        );

    let bestMatch: DOMElementLike | null = null;
    let minDistance = 25.0;

    for (const s of shapes) {
      const cxAttr = s.getAttribute('cx') || s.getAttribute('x');
      const cyAttr = s.getAttribute('cy') || s.getAttribute('y');
      let cx = cxAttr ? parseFloat(cxAttr) : NaN;
      let cy = cyAttr ? parseFloat(cyAttr) : NaN;

      if (isNaN(cx) || isNaN(cy)) {
        const raw = (s.rawElement || s) as SVGGraphicsElement;
        if (raw && typeof raw.getBBox === 'function') {
          try {
            const bbox = raw.getBBox();
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
          } catch {
            // ignore
          }
        }
      }

      if (!isNaN(cx) && !isNaN(cy)) {
        const dist = Math.hypot(cx - seat.x, cy - seat.y);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = s;
          if (dist < 1.0) break;
        }
      }
    }

    return bestMatch;
  }

  public static findSeatByScreenCTM(
    seat: Seat,
    seatmapSvg: SVGSVGElement | null
  ): DOMElementLike | null {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      !seatmapSvg ||
      typeof seatmapSvg.createSVGPoint !== 'function' ||
      typeof seatmapSvg.getScreenCTM !== 'function' ||
      typeof seat.x !== 'number' ||
      typeof seat.y !== 'number'
    ) {
      return null;
    }

    try {
      const ctm = seatmapSvg.getScreenCTM();
      if (!ctm) return null;

      const pt = seatmapSvg.createSVGPoint();
      pt.x = seat.x;
      pt.y = seat.y;
      const screenPt = pt.matrixTransform(ctm);

      if (
        screenPt.x > 0 &&
        screenPt.y > 0 &&
        screenPt.x < window.innerWidth &&
        screenPt.y < window.innerHeight
      ) {
        if (typeof document.elementsFromPoint === 'function') {
          const stack = document.elementsFromPoint(screenPt.x, screenPt.y);
          const svgMatch = stack.find((el) => {
            const tag = el.tagName.toLowerCase();
            return (
              tag === 'circle' ||
              tag === 'rect' ||
              tag === 'ellipse' ||
              tag === 'path' ||
              tag === 'g'
            );
          });
          if (svgMatch) {
            return wrapBrowserElement(svgMatch);
          }
        }

        const elAtPoint = document.elementFromPoint(screenPt.x, screenPt.y);
        if (elAtPoint) {
          return wrapBrowserElement(elAtPoint);
        }
      }
    } catch {
      // ignore
    }

    return null;
  }
}
