import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { TicketboxCatalogParser } from '../../src/infrastructure/ticketbox/parsing/TicketboxCatalogParser';
import { DOMElementLike } from '../../src/infrastructure/ticketbox/parsing/DOMElementLike';

describe('Performance Benchmark: DOM Catalog Discovery & Parsing', () => {
  function createMockElement(
    tagName: string,
    attributes: Record<string, string> = {},
    textContent = '',
    children: DOMElementLike[] = []
  ): DOMElementLike {
    const el: DOMElementLike = {
      tagName: tagName.toUpperCase(),
      textContent,
      getAttribute: (name: string) => attributes[name] ?? null,
      hasAttribute: (name: string) => name in attributes,
      querySelector: (selector: string): DOMElementLike | null => {
        if (selector === '[data-event-id]' && attributes['data-event-id']) return el;
        if (selector === '#ticket-info' && attributes['id'] === 'ticket-info') return el;
        if (selector.startsWith('.') && attributes['class']?.includes(selector.slice(1))) return el;
        for (const child of children) {
          const res = child.querySelector(selector);
          if (res) return res;
        }
        return null;
      },
      querySelectorAll: (selector: string): DOMElementLike[] => {
        const results: DOMElementLike[] = [];
        if (selector.includes('button') && tagName.toUpperCase() === 'BUTTON') {
          results.push(el);
        }
        if (selector.startsWith('.') && attributes['class']?.includes(selector.slice(1))) {
          results.push(el);
        }
        for (const child of children) {
          results.push(...child.querySelectorAll(selector));
        }
        return results;
      },
    };
    return el;
  }

  function createMockDomTree(ticketCount: number): DOMElementLike {
    const ticketNodes: DOMElementLike[] = [];
    for (let i = 0; i < ticketCount; i++) {
      ticketNodes.push(
        createMockElement('div', { class: 'ticket-item', 'data-showing-id': 'showing_1' }, '', [
          createMockElement('span', { class: 'ticket-name' }, `VIP Section ${i}`),
          createMockElement('span', { class: 'ticket-price' }, `${1000000 + i * 100000} đ`),
          createMockElement('button', { class: 'btn-buy' }, 'Mua vé'),
        ])
      );
    }

    return createMockElement('div', { id: 'root' }, '', [
      createMockElement(
        'div',
        { 'data-event-id': '26416', id: 'ticket-info' },
        'Concert Live 2026',
        ticketNodes
      ),
    ]);
  }

  it('measures catalog parsing latency across 100 iterations on 20-ticket DOM tree', async () => {
    const root = createMockDomTree(20);
    const url = 'https://ticketbox.vn/event/live-concert-26416';

    const stats = await BenchmarkRunner.run(
      () => {
        const catalog = TicketboxCatalogParser.parseCatalog(root, url);
        expect(catalog.eventId).toBe('26416');
      },
      { iterations: 100, warmupIterations: 10 }
    );

    console.info('[PERF] Discovery Catalog Parsing Stats (ms):', stats);
    expect(stats.p95).toBeLessThan(5);
  });
});
