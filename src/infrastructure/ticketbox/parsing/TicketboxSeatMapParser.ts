import {
  Seat,
  SeatArea,
  SeatMap,
  SeatMapLegendItem,
  SeatStatus,
} from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike } from './DOMElementLike';

export class TicketboxSeatMapParser {
  /**
   * Parses the SeatMap structure from the page DOM.
   * Resilient to layout variations: works with SVG, HTML buttons, divs, and data attributes.
   * Conforms to Sections 10, 11, 12, 14.
   */
  public static parseSeatMap(root: DOMElementLike): SeatMap {
    const areas = this.parseAreas(root);
    const seats = this.parseSeats(root);
    const legend = this.parseLegend(root);

    return {
      areas,
      seats,
      legend,
    };
  }

  /**
   * Parses selectable seat zones/areas (e.g. "Chọn khu vực" map or zone cards).
   */
  public static parseAreas(root: DOMElementLike): SeatArea[] {
    const areaElements = root.querySelectorAll(
      '.area-item, [data-zone-id], [data-area-id], .zone-card, .zone-item, .area-select-button, [data-area-name], .map-zone, svg g[data-area]'
    );

    const areas: SeatArea[] = [];

    for (const el of areaElements) {
      const id =
        el.getAttribute('data-zone-id') ||
        el.getAttribute('data-area-id') ||
        el.getAttribute('data-area') ||
        el.getAttribute('id') ||
        null;

      const nameEl = el.querySelector('.area-name, .zone-name, .zone-title, h3, h4, text');
      let name = nameEl ? nameEl.textContent.trim() : el.textContent.trim();
      // Clean up multiline or extra badge text
      if (name.includes('\n')) {
        name = name.split('\n')[0]!.trim();
      }

      if (!name) continue;

      const textCorpus = el.textContent.toLowerCase();
      const isDisabled =
        el.hasAttribute('disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        (el.className || '').toLowerCase().includes('disabled') ||
        (el.className || '').toLowerCase().includes('sold-out');

      const isSoldOut =
        textCorpus.includes('hết vé') ||
        textCorpus.includes('sold out') ||
        textCorpus.includes('hết chỗ') ||
        el.getAttribute('data-status') === 'sold_out';

      let availability: SeatArea['availability'] = 'AVAILABLE';
      let selectable = true;

      if (isSoldOut || (isDisabled && textCorpus.includes('hết'))) {
        availability = 'SOLD_OUT';
        selectable = false;
      } else if (isDisabled) {
        availability = 'CLOSED';
        selectable = false;
      }

      // Price extraction
      const price = this.extractPriceFromText(el.textContent);

      // Available seats count if observable
      let availableSeatCount: number | undefined;
      const seatCountAttr = el.getAttribute('data-seats-available');
      if (seatCountAttr) {
        const parsed = parseInt(seatCountAttr, 10);
        if (!isNaN(parsed)) availableSeatCount = parsed;
      } else {
        const countMatch = textCorpus.match(/(?:còn|available)\s*(\d+)\s*(?:chỗ|seats|ghế)/i);
        if (countMatch && countMatch[1]) {
          availableSeatCount = parseInt(countMatch[1], 10);
        }
      }

      areas.push({
        id: id || this.slugify(name),
        name,
        price,
        currency: 'VND',
        mode: 'SEATED',
        availability,
        selectable,
        availableSeatCount,
      });
    }

    return areas;
  }

  /**
   * Parses individual seat nodes (SVG rects/circles, HTML buttons, divs).
   */
  public static parseSeats(root: DOMElementLike): Seat[] {
    const seatElements = root.querySelectorAll(
      '.seat, [data-seat-id], button.seat-btn, circle.seat, rect.seat, [role="button"][data-seat], [data-row][data-seat-number]'
    );

    const seats: Seat[] = [];

    for (const el of seatElements) {
      const id =
        el.getAttribute('data-seat-id') ||
        el.getAttribute('data-id') ||
        el.getAttribute('id') ||
        el.getAttribute('data-seat') ||
        '';

      const ariaLabel = el.getAttribute('aria-label') || '';
      const dataLabel = el.getAttribute('data-seat-label') || el.getAttribute('data-label') || '';
      const text = el.textContent.trim();
      const label = dataLabel || ariaLabel || text || id;

      if (!label && !id) continue;

      // Extract row and number
      let row = el.getAttribute('data-row') || '';
      let num = el.getAttribute('data-seat-number') || el.getAttribute('data-number') || '';

      if (!row || !num) {
        // Try parsing from label e.g. "A12", "Row A Seat 12", "A-12", "Hàng A - Ghế 12"
        const parsed = this.parseRowAndNumber(label || id);
        if (!row) row = parsed.row;
        if (!num) num = String(parsed.number);
      }

      const numericNumber = parseInt(num, 10) || 0;
      const area =
        el.getAttribute('data-area') ||
        el.getAttribute('data-zone') ||
        el.getAttribute('data-section') ||
        '';

      // Parse status
      const status = this.classifySeatStatus(el);
      const selectable = status === 'AVAILABLE';

      // Optional price
      const price = el.getAttribute('data-price')
        ? parseInt(el.getAttribute('data-price')!, 10) || undefined
        : undefined;

      seats.push({
        id: id || `${row}_${numericNumber}`,
        label: label || `${row}${numericNumber}`,
        row: row.toUpperCase(),
        number: numericNumber,
        area,
        status,
        selectable,
        price,
        element: el,
      });
    }

    return seats;
  }

  /**
   * Parses legend items on the right side of the seat map.
   */
  public static parseLegend(root: DOMElementLike): SeatMapLegendItem[] {
    const legendElements = root.querySelectorAll(
      '.legend-item, .seat-legend > div, [data-legend-item], .ticket-legend .item, .legend-row'
    );

    const legend: SeatMapLegendItem[] = [];

    for (const el of legendElements) {
      const nameEl = el.querySelector('.name, .label, .tier-name, span');
      const name = nameEl ? nameEl.textContent.trim() : el.textContent.trim();
      if (!name) continue;

      const price = this.extractPriceFromText(el.textContent);
      const isAvailable =
        !el.hasAttribute('disabled') &&
        !el.textContent.toLowerCase().includes('hết vé') &&
        !el.textContent.toLowerCase().includes('sold out');

      legend.push({
        name,
        price,
        color: el.getAttribute('data-color') || undefined,
        available: isAvailable,
      });
    }

    return legend;
  }

  private static classifySeatStatus(el: DOMElementLike): SeatStatus {
    const className = (el.className || '').toLowerCase();
    const dataStatus = (el.getAttribute('data-status') || '').toLowerCase();
    const ariaDisabled = el.getAttribute('aria-disabled') === 'true';
    const ariaPressed = el.getAttribute('aria-pressed') === 'true';
    const isDisabled = el.hasAttribute('disabled') || ariaDisabled;

    // 1. Selected
    if (
      ariaPressed ||
      dataStatus === 'selected' ||
      className.includes('selected') ||
      className.includes('active')
    ) {
      return 'SELECTED';
    }

    // 2. Occupied / Taken / Booked
    if (
      dataStatus === 'occupied' ||
      dataStatus === 'taken' ||
      dataStatus === 'booked' ||
      className.includes('occupied') ||
      className.includes('taken') ||
      className.includes('booked')
    ) {
      return 'OCCUPIED';
    }

    // 3. Blocked / Locked
    if (
      dataStatus === 'blocked' ||
      dataStatus === 'locked' ||
      className.includes('blocked') ||
      className.includes('locked')
    ) {
      return 'BLOCKED';
    }

    // 4. Unavailable / Disabled / Sold out
    if (
      dataStatus === 'unavailable' ||
      dataStatus === 'sold_out' ||
      isDisabled ||
      className.includes('disabled') ||
      className.includes('sold-out') ||
      className.includes('unavailable')
    ) {
      return 'UNAVAILABLE';
    }

    // 5. Available
    if (
      dataStatus === 'available' ||
      className.includes('available') ||
      el.tagName === 'button' ||
      el.hasAttribute('data-seat-id')
    ) {
      return 'AVAILABLE';
    }

    return 'UNKNOWN';
  }

  public static parseRowAndNumber(label: string): { row: string; number: number } {
    // Matches patterns like "A12", "Row A - 12", "A-12", "Hàng A Số 12"
    const match =
      label.match(/([a-zA-Z]+)[\s\-_/]*(\d+)/) ||
      label.match(/(?:hàng|row)\s*([a-zA-Z]+).*?(?:số|ghế|seat)?\s*(\d+)/i);

    if (match && match[1] && match[2]) {
      return {
        row: match[1].toUpperCase(),
        number: parseInt(match[2], 10) || 0,
      };
    }

    return { row: 'GEN', number: 0 };
  }

  private static extractPriceFromText(text: string): number {
    const match =
      text.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:đ|vnd|vnđ|d)/iu) ||
      text.match(/\b(\d{1,3}(?:[.,]\d{3})+)\b/);

    if (match && match[1]) {
      const sanitized = match[1].replace(/[.,]/g, '');
      const parsed = parseInt(sanitized, 10);
      return !isNaN(parsed) ? parsed : 0;
    }
    return 0;
  }

  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
