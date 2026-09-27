import {
  BookingSummary,
  SummaryItem,
} from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike } from './DOMElementLike';

export class TicketboxSummaryParser {
  /**
   * Parses the BookingSummary panel from the page DOM.
   * Conforms to Section 16.
   */
  public static parseSummary(root: DOMElementLike): BookingSummary | null {
    const summaryContainer =
      root.querySelector(
        '.booking-summary, #booking-summary, .order-summary, #order-summary, .cart-summary, [data-summary], .summary-panel, #cart-summary'
      ) ||
      root.querySelector('.checkout-summary, .summary-box') ||
      root;

    const items = this.parseItems(summaryContainer);
    const subtotal = this.parseAmount(
      summaryContainer,
      '.subtotal, .sub-total, [data-subtotal], .summary-subtotal'
    );
    const fees = this.parseAmount(
      summaryContainer,
      '.fees, .service-fee, [data-fees], .processing-fee'
    );
    const total = this.parseAmount(
      summaryContainer,
      '.total, .total-amount, [data-total], .summary-total, strong.grand-total'
    );

    // If no items found, return null (summary panel not present)
    if (items.length === 0 && subtotal === 0 && total === 0) {
      return null;
    }

    return {
      items,
      subtotal: subtotal > 0 ? subtotal : total > 0 ? total - fees : 0,
      fees,
      total: total > 0 ? total : subtotal + fees,
      currency: 'VND',
    };
  }

  private static parseItems(container: DOMElementLike): SummaryItem[] {
    const itemElements = container.querySelectorAll(
      '.summary-item, .order-item, .cart-item, tr.summary-row, [data-summary-item], .item-row'
    );

    const items: SummaryItem[] = [];

    for (const el of itemElements) {
      const nameEl = el.querySelector(
        '.ticket-name, .item-name, .title, strong, h4, .name'
      );
      const ticketName = nameEl ? nameEl.textContent.trim() : '';
      if (!ticketName) continue;

      // Quantity extraction
      let quantity = 1;
      const qtyEl = el.querySelector('.qty, .quantity, [data-quantity], .item-qty');
      if (qtyEl) {
        const qtyMatch = qtyEl.textContent.match(/(\d+)/);
        if (qtyMatch && qtyMatch[1]) {
          quantity = parseInt(qtyMatch[1], 10);
        }
      } else {
        // Check "x 2" or "2x" in text
        const textQtyMatch = el.textContent.match(/(?:x\s*(\d+)|\b(\d+)\s*x\b)/i);
        if (textQtyMatch) {
          quantity = parseInt(textQtyMatch[1] ?? textQtyMatch[2] ?? '1', 10);
        }
      }

      // Price extraction
      const price = this.extractPriceFromText(el.textContent);

      // Seats extraction
      const seatsEl = el.querySelector('.seats, .seat-numbers, [data-seats], .seat-list');
      const seats: string[] = [];
      if (seatsEl) {
        const seatsText = seatsEl.textContent.trim();
        const matches = Array.from(seatsText.matchAll(/([A-Za-z]+\s*[-_]?\s*\d+)/g));
        for (const m of matches) {
          seats.push(m[1]!.replace(/\s+/g, ''));
        }
      }

      items.push({
        ticket: ticketName,
        quantity,
        price,
        seats: seats.length > 0 ? seats : undefined,
      });
    }

    return items;
  }

  private static parseAmount(container: DOMElementLike, selector: string): number {
    const el = container.querySelector(selector);
    if (!el) return 0;
    return this.extractPriceFromText(el.textContent);
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
}
