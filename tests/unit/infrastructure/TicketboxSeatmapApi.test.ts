import { describe, it, expect } from 'vitest';
import {
  TicketboxSeatMapParser,
  SeatmapApiResponse,
} from '../../../src/infrastructure/ticketbox/parsing/TicketboxSeatMapParser';
import { TicketboxCatalogParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxCatalogParser';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';

const MOCK_SEATMAP_API_RESPONSE: SeatmapApiResponse = {
  status: 1,
  message: 'Success',
  data: {
    result: {
      id: 900,
      name: 'THE BROTHERS-TTNT ÂU CƠ-190826-A.svg',
      status: 0,
      sections: [
        {
          id: 13307,
          seatMapId: 900,
          name: 'stage',
          isReservingSeat: false,
          isStage: true,
          status: 1,
        },
        {
          id: 13308,
          seatMapId: 900,
          name: '1st_ROW_L',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091993,
            name: '1st Row (L&R)',
            price: 2400000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
          rows: [
            {
              id: 49605,
              sectionId: 13308,
              name: 'A',
              seats: [
                { id: 696601, rowId: 49605, name: '1', status: 4, x: 100.0, y: 108.4 },
                { id: 696602, rowId: 49605, name: '2', status: 1, x: 110.0, y: 108.4 },
                { id: 696603, rowId: 49605, name: '3', status: 1, x: 120.0, y: 108.4 },
              ],
            },
          ],
        },
        {
          id: 13309,
          seatMapId: 900,
          name: '1st_ROW_C',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091992,
            name: '1st Row',
            price: 2500000,
            status: 'sold_out',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
          rows: [
            {
              id: 49606,
              sectionId: 13309,
              name: 'A',
              seats: [
                { id: 696604, rowId: 49606, name: '4', status: 4, x: 130.0, y: 108.4 },
                { id: 696605, rowId: 49606, name: '5', status: 4, x: 140.0, y: 108.4 },
              ],
            },
          ],
        },
        {
          id: 13310,
          seatMapId: 900,
          name: '1st_ROW_R',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091993,
            name: '1st Row (L&R)',
            price: 2400000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
          rows: [
            {
              id: 49607,
              sectionId: 13310,
              name: 'A',
              seats: [
                { id: 696606, rowId: 49607, name: '6', status: 1, x: 150.0, y: 108.4 },
                { id: 696607, rowId: 49607, name: '7', status: 1, x: 160.0, y: 108.4 },
              ],
            },
          ],
        },
        {
          id: 13311,
          seatMapId: 900,
          name: 'RED',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091994,
            name: 'RED',
            price: 2200000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
          rows: [
            {
              id: 49608,
              sectionId: 13311,
              name: 'B',
              seats: [
                { id: 696610, rowId: 49608, name: '1', status: 1, x: 100.0, y: 130.0 },
                { id: 696611, rowId: 49608, name: '2', status: 1, x: 110.0, y: 130.0 },
              ],
            },
          ],
        },
        {
          id: 13312,
          seatMapId: 900,
          name: 'YELLOW',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091995,
            name: 'YELLOW',
            price: 1900000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
        },
        {
          id: 13313,
          seatMapId: 900,
          name: 'PINK',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091996,
            name: 'PINK',
            price: 1600000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
        },
        {
          id: 13314,
          seatMapId: 900,
          name: 'GREEN',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091997,
            name: 'GREEN',
            price: 1400000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
        },
        {
          id: 13315,
          seatMapId: 900,
          name: 'BLUE',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091998,
            name: 'BLUE',
            price: 1000000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
        },
        {
          id: 13316,
          seatMapId: 900,
          name: 'PURPLE',
          isReservingSeat: true,
          status: 1,
          ticketType: {
            id: 1091999,
            name: 'PURPLE',
            price: 800000,
            status: 'book_now',
            minQtyPerOrder: 1,
            maxQtyPerOrder: 4,
          },
        },
      ],
    },
  },
};

describe('Authoritative Ticketbox Seatmap API Integration', () => {
  describe('TicketboxSeatMapParser.parseTicketTypesFromSeatmapApi', () => {
    it('should parse exactly 8 distinct ticket tiers deduplicated by ticketType id', () => {
      const tickets = TicketboxSeatMapParser.parseTicketTypesFromSeatmapApi(MOCK_SEATMAP_API_RESPONSE);

      expect(tickets).toHaveLength(8);

      const t1stRow = tickets.find((t) => t.name === '1st Row');
      expect(t1stRow).toBeDefined();
      expect(t1stRow?.price.amount).toBe(2500000);
      expect(t1stRow?.availability).toBe('SOLD_OUT');
      expect(t1stRow?.selectable).toBe(false);

      const t1stRowLR = tickets.find((t) => t.name === '1st Row (L&R)');
      expect(t1stRowLR).toBeDefined();
      expect(t1stRowLR?.price.amount).toBe(2400000);
      expect(t1stRowLR?.availability).toBe('AVAILABLE');
      expect(t1stRowLR?.selectable).toBe(true);

      const red = tickets.find((t) => t.name === 'RED');
      expect(red).toBeDefined();
      expect(red?.price.amount).toBe(2200000);
      expect(red?.availability).toBe('AVAILABLE');

      const yellow = tickets.find((t) => t.name === 'YELLOW');
      expect(yellow).toBeDefined();
      expect(yellow?.price.amount).toBe(1900000);

      const pink = tickets.find((t) => t.name === 'PINK');
      expect(pink).toBeDefined();
      expect(pink?.price.amount).toBe(1600000);

      const green = tickets.find((t) => t.name === 'GREEN');
      expect(green).toBeDefined();
      expect(green?.price.amount).toBe(1400000);

      const blue = tickets.find((t) => t.name === 'BLUE');
      expect(blue).toBeDefined();
      expect(blue?.price.amount).toBe(1000000);

      const purple = tickets.find((t) => t.name === 'PURPLE');
      expect(purple).toBeDefined();
      expect(purple?.price.amount).toBe(800000);
    });
  });

  describe('TicketboxSeatMapParser.parseSeatsFromSeatmapApi', () => {
    it('should parse seats with exact SVG coordinates (x, y) and availability status', () => {
      const seats = TicketboxSeatMapParser.parseSeatsFromSeatmapApi(MOCK_SEATMAP_API_RESPONSE);

      expect(seats.length).toBeGreaterThanOrEqual(7);

      const seat601 = seats.find((s) => s.id === '696601');
      expect(seat601).toBeDefined();
      expect(seat601?.label).toBe('A1');
      expect(seat601?.row).toBe('A');
      expect(seat601?.number).toBe(1);
      expect(seat601?.status).toBe('UNAVAILABLE');
      expect(seat601?.selectable).toBe(false);
      expect(seat601?.x).toBe(100.0);
      expect(seat601?.y).toBe(108.4);

      const seat602 = seats.find((s) => s.id === '696602');
      expect(seat602).toBeDefined();
      expect(seat602?.label).toBe('A2');
      expect(seat602?.status).toBe('AVAILABLE');
      expect(seat602?.selectable).toBe(true);
      expect(seat602?.x).toBe(110.0);
      expect(seat602?.y).toBe(108.4);
    });

    it('should filter seats by target ticket tier name', () => {
      const redSeats = TicketboxSeatMapParser.parseSeatsFromSeatmapApi(
        MOCK_SEATMAP_API_RESPONSE,
        'RED'
      );
      expect(redSeats).toHaveLength(2);
      expect(redSeats[0]?.area).toBe('RED');
      expect(redSeats[0]?.label).toBe('B1');
      expect(redSeats[1]?.label).toBe('B2');
    });
  });

  describe('TicketboxCatalogParser.extractShowingId', () => {
    it('should extract showingId from booking URL path', () => {
      const url = 'https://ticketbox.vn/events/26578/bookings/81077997936830/select-ticket';
      const id = TicketboxCatalogParser.extractShowingId(url);
      expect(id).toBe('81077997936830');
    });

    it('should extract showingId from query parameters', () => {
      const url = 'https://ticketbox.vn/booking?showingId=81077997936830';
      const id = TicketboxCatalogParser.extractShowingId(url);
      expect(id).toBe('81077997936830');
    });

    it('should extract showingId from DOM data attributes', () => {
      const dom = parseHtmlToDOMElementLike('<div data-showing-id="81077997936830"></div>');
      const id = TicketboxCatalogParser.extractShowingId('https://ticketbox.vn/event', dom);
      expect(id).toBe('81077997936830');
    });

    it('should extract showingId from DOM booking links', () => {
      const dom = parseHtmlToDOMElementLike(
        '<a href="/events/26578/bookings/81077997936830/select-ticket">Mua vé</a>'
      );
      const id = TicketboxCatalogParser.extractShowingId('https://ticketbox.vn/event', dom);
      expect(id).toBe('81077997936830');
    });
  });

  describe('TicketboxCatalogParser responsive tier deduplication', () => {
    it('should deduplicate duplicate responsive .content-row items to exact 8 tiers', () => {
      // 16 rows: 8 desktop + 8 mobile
      const duplicateHtml = `
        <div id="ticket-info">
          <div class="content-row"><div class="title-tickettype">1st Row</div><div class="price">2.500.000 đ</div><div class="status">Hết vé</div></div>
          <div class="content-row"><div class="title-tickettype">1st Row</div><div class="price">2.500.000 đ</div><div class="status">Hết vé</div></div>
          <div class="content-row"><div class="title-tickettype">1st Row (L&R)</div><div class="price">2.400.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">1st Row (L&R)</div><div class="price">2.400.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">RED</div><div class="price">2.200.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">RED</div><div class="price">2.200.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">YELLOW</div><div class="price">1.900.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">YELLOW</div><div class="price">1.900.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">PINK</div><div class="price">1.600.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">PINK</div><div class="price">1.600.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">GREEN</div><div class="price">1.400.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">GREEN</div><div class="price">1.400.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">BLUE</div><div class="price">1.000.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">BLUE</div><div class="price">1.000.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">PURPLE</div><div class="price">800.000 đ</div><div class="status">Còn vé</div></div>
          <div class="content-row"><div class="title-tickettype">PURPLE</div><div class="price">800.000 đ</div><div class="status">Còn vé</div></div>
        </div>
      `;
      const dom = parseHtmlToDOMElementLike(duplicateHtml);
      const catalog = TicketboxCatalogParser.parseCatalog(dom, 'https://ticketbox.vn/tudaytunay-26578');

      const tickets = catalog.showings[0]!.ticketTypes;
      expect(tickets).toHaveLength(8);
      expect(tickets.map((t) => t.name)).toEqual([
        '1st Row',
        '1st Row (L&R)',
        'RED',
        'YELLOW',
        'PINK',
        'GREEN',
        'BLUE',
        'PURPLE',
      ]);
    });
  });

  describe('TicketboxJourneyAdapter with Seatmap API', () => {
    it('should discover seats and select seat via SVG coordinates', async () => {
      const svgHtml = `
        <div id="booking-container">
          <svg class="seatmap" width="800" height="600">
            <circle cx="100.0" cy="108.4" r="5" fill="#f00"></circle>
            <circle cx="110.0" cy="108.4" r="5" fill="#fff" id="circle-a2"></circle>
            <circle cx="120.0" cy="108.4" r="5" fill="#fff" id="circle-a3"></circle>
          </svg>
        </div>
      `;
      const dom = parseHtmlToDOMElementLike(svgHtml);
      const adapter = new TicketboxJourneyAdapter(undefined, dom);
      adapter.setSeatmapData(MOCK_SEATMAP_API_RESPONSE);

      const seats = await adapter.discoverSeats('1st_ROW_L');
      expect(seats.length).toBeGreaterThan(0);

      // Select available seat A2 (id: 696602, x: 110, y: 108.4)
      const selected = await adapter.selectSpecificSeats(['696602']);
      expect(selected).toBe(true);

      const circleA2 = dom.querySelector('#circle-a2');
      expect(circleA2?.getAttribute('data-status')).toBe('selected');
      expect(circleA2?.className).toContain('selected');
    });
  });
});
