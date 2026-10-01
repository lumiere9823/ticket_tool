import { describe, it, expect, beforeEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { TicketType } from '../../../src/domain/entities/EventCatalog';

describe('Fast Quantity Adjustment & Anti-Bot Zoom Defense', () => {
  let logger: SanitizedLogger;

  beforeEach(() => {
    logger = new SanitizedLogger({ state: 'TEST' });
  });

  const MOCK_TICKET: TicketType = {
    id: 't-101',
    name: 'GA Standing',
    price: { amount: 500000, currency: 'VND' },
    mode: 'STANDING',
    availability: 'AVAILABLE',
    minQuantity: 1,
    maxQuantity: 4,
    selectedQuantity: 0,
    selectable: true,
    source: { page: 'BOOKING', evidence: [] },
  };

  describe('selectQuantity React input property vs SSR attribute priority', () => {
    it('should read live input.value when attribute value is stuck at SSR "0"', async () => {
      const html = `
        <div class="ticket-row" data-ticket-id="t-101">
          <span class="ticket-name">GA Standing</span>
          <div class="quantity-stepper">
            <button class="btn-minus" aria-label="minus">-</button>
            <input type="number" class="qty-input" />
            <button class="btn-plus" aria-label="plus">+</button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      const input = root.querySelector('.qty-input') as { value?: string; getAttribute: (k: string) => string | null };
      expect(input).toBeDefined();

      // Simulate React hydration: the attribute returns '0' (from initial HTML SSR markup)
      // but the live JS DOM property is '2'
      input.getAttribute = (k: string) => (k === 'value' ? '0' : null);
      (input as unknown as { value: string }).value = '2';

      expect(input.getAttribute('value')).toBe('0');
      expect((input as unknown as { value: string }).value).toBe('2');

      // Attempt to select quantity 2: adapter must read property 'value' ('2')
      // and immediately succeed without issuing unwanted button clicks or failing verification
      const success = await adapter.selectQuantity(MOCK_TICKET, 2);
      expect(success).toBe(true);
    });

    it('should execute exact minimal stepper clicks for required quantity delta', async () => {
      const html = `
        <div class="ticket-row" data-ticket-id="t-101">
          <span class="ticket-name">GA Standing</span>
          <div class="quantity-stepper">
            <button class="btn-minus" aria-label="minus">-</button>
            <input type="number" class="qty-input" value="1" />
            <button class="btn-plus" aria-label="plus">+</button>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      const input = root.querySelector('.qty-input') as { value?: string };
      let plusClicks = 0;
      const plusBtn = root.querySelector('.btn-plus') as { click?: () => void };
      plusBtn.click = () => {
        plusClicks++;
        if (input) {
          input.value = String(1 + plusClicks);
        }
      };

      const success = await adapter.selectQuantity(MOCK_TICKET, 3);
      expect(success).toBe(true);
      // Started at 1, needed 3 => exactly 2 clicks
      expect(plusClicks).toBe(2);
      expect(input.value).toBe('3');
    });

    it('should early-return on seatmap booking page when no quantity steppers exist', async () => {
      const html = `
        <div class="booking-view">
          <div class="konvajs-content">
            <canvas width="800" height="600"></canvas>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      // On a visual seatmap page, quantity is inherently determined by seat nodes clicked
      const success = await adapter.selectQuantity(MOCK_TICKET, 2);
      expect(success).toBe(true);
    });
  });

  describe('Anti-Bot Zoom Thrash Defense Invariant', () => {
    it('should detect rapid direction oscillations and trigger reload when threshold is reached', () => {
      const windowMs = 4000;
      const threshold = 2;
      const timestamps: number[] = [];
      let lastDpr = 1.0;
      let lastDirection: -1 | 0 | 1 = 0;
      let reloadTriggered = false;

      function simulateZoomSample(newDpr: number, now: number): void {
        const delta = newDpr - lastDpr;
        if (Math.abs(delta) < 0.01) return;

        const direction: -1 | 1 = delta > 0 ? 1 : -1;
        if (lastDirection !== 0 && direction !== lastDirection) {
          timestamps.push(now);
        }
        lastDirection = direction;
        lastDpr = newDpr;

        // Sliding window pruning
        const cutoff = now - windowMs;
        while (timestamps.length > 0 && timestamps[0]! < cutoff) {
          timestamps.shift();
        }

        if (timestamps.length >= threshold) {
          reloadTriggered = true;
          timestamps.length = 0;
          lastDirection = 0;
        }
      }

      const t0 = 10000;

      // Sample 1: initial zoom-in (scale 1.0 -> 1.5) -> direction: +1, no reversal yet
      simulateZoomSample(1.5, t0);
      expect(reloadTriggered).toBe(false);
      expect(timestamps.length).toBe(0);

      // Sample 2: anti-bot zooms OUT (scale 1.5 -> 0.8) -> reversal 1!
      simulateZoomSample(0.8, t0 + 200);
      expect(reloadTriggered).toBe(false);
      expect(timestamps.length).toBe(1);

      // Sample 3: anti-bot zooms IN again (scale 0.8 -> 1.3) -> reversal 2!
      simulateZoomSample(1.3, t0 + 500);
      // Threshold 2 reached within 500ms (< 4000ms window) -> reload triggered!
      expect(reloadTriggered).toBe(true);
    });

    it('should NOT trigger reload for gradual single-direction zooming', () => {
      const windowMs = 4000;
      const threshold = 2;
      const timestamps: number[] = [];
      let lastDpr = 1.0;
      let lastDirection: -1 | 0 | 1 = 0;
      let reloadTriggered = false;

      function simulateZoomSample(newDpr: number, now: number): void {
        const delta = newDpr - lastDpr;
        if (Math.abs(delta) < 0.01) return;

        const direction: -1 | 1 = delta > 0 ? 1 : -1;
        if (lastDirection !== 0 && direction !== lastDirection) {
          timestamps.push(now);
        }
        lastDirection = direction;
        lastDpr = newDpr;

        const cutoff = now - windowMs;
        while (timestamps.length > 0 && timestamps[0]! < cutoff) {
          timestamps.shift();
        }

        if (timestamps.length >= threshold) {
          reloadTriggered = true;
        }
      }

      const t0 = 10000;
      // User gradually zooms in: 1.0 -> 1.2 -> 1.4 -> 1.6
      simulateZoomSample(1.2, t0);
      simulateZoomSample(1.4, t0 + 300);
      simulateZoomSample(1.6, t0 + 600);

      expect(reloadTriggered).toBe(false);
      expect(timestamps.length).toBe(0); // Zero reversals
    });

    it('should prune reversals outside the 4000ms sliding window', () => {
      const windowMs = 4000;
      const threshold = 2;
      const timestamps: number[] = [];
      let lastDpr = 1.0;
      let lastDirection: -1 | 0 | 1 = 0;
      let reloadTriggered = false;

      function simulateZoomSample(newDpr: number, now: number): void {
        const delta = newDpr - lastDpr;
        if (Math.abs(delta) < 0.01) return;

        const direction: -1 | 1 = delta > 0 ? 1 : -1;
        if (lastDirection !== 0 && direction !== lastDirection) {
          timestamps.push(now);
        }
        lastDirection = direction;
        lastDpr = newDpr;

        const cutoff = now - windowMs;
        while (timestamps.length > 0 && timestamps[0]! < cutoff) {
          timestamps.shift();
        }

        if (timestamps.length >= threshold) {
          reloadTriggered = true;
        }
      }

      const t0 = 10000;
      // Reversal 1: zoom in then zoom out at t0
      simulateZoomSample(1.5, t0);
      simulateZoomSample(1.0, t0 + 200);
      expect(timestamps.length).toBe(1);

      // Reversal 2 occurs 5000ms later (t0 + 5200) -> outside 4000ms window
      simulateZoomSample(1.4, t0 + 5200);

      // Previous reversal was pruned
      expect(timestamps.length).toBe(1);
      expect(reloadTriggered).toBe(false);
    });
  });
});
