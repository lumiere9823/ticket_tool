import { describe, it, expect } from 'vitest';
import {
  TicketboxSeatMapParser,
  SeatmapApiResponse,
} from '../../../src/infrastructure/ticketbox/parsing/TicketboxSeatMapParser';
import { TicketboxCatalogParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxCatalogParser';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { Seat } from '../../../src/domain/entities/BookingJourneyModels';
import { AdjacentSeatStrategy } from '../../../src/domain/policies/AdjacentSeatStrategy';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';

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
      const tickets =
        TicketboxSeatMapParser.parseTicketTypesFromSeatmapApi(MOCK_SEATMAP_API_RESPONSE);

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
      const catalog = TicketboxCatalogParser.parseCatalog(
        dom,
        'https://ticketbox.vn/tudaytunay-26578'
      );

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

    it('should select adjacent seats in theatrical odd-numbered seating (section 13308)', () => {
      const oddSeats: Seat[] = [
        {
          id: '696600',
          label: 'VIP_A21',
          row: 'VIP_A',
          number: 21,
          position: 0,
          x: 51.3,
          y: 108.4,
          area: '1st_ROW_L',
          status: 'AVAILABLE',
          selectable: true,
        },
        {
          id: '696601',
          label: 'VIP_A19',
          row: 'VIP_A',
          number: 19,
          position: 1,
          x: 72.5,
          y: 108.4,
          area: '1st_ROW_L',
          status: 'AVAILABLE',
          selectable: true,
        },
        {
          id: '696602',
          label: 'VIP_A17',
          row: 'VIP_A',
          number: 17,
          position: 2,
          x: 93.7,
          y: 108.4,
          area: '1st_ROW_L',
          status: 'AVAILABLE',
          selectable: true,
        },
        {
          id: '696603',
          label: 'VIP_A15',
          row: 'VIP_A',
          number: 15,
          position: 3,
          x: 114.8,
          y: 108.4,
          area: '1st_ROW_L',
          status: 'AVAILABLE',
          selectable: true,
        },
      ];

      const decision = AdjacentSeatStrategy.selectSeats(oddSeats, 2, '1st_ROW_L');
      expect(decision.status).toBe('SUCCESS');
      expect(decision.isAdjacent).toBe(true);
      expect(decision.selectedSeats).toHaveLength(2);
      expect(['VIP_A21', 'VIP_A19', 'VIP_A17', 'VIP_A15']).toContain(
        decision.selectedSeats[0]?.label
      );
      expect(['VIP_A21', 'VIP_A19', 'VIP_A17', 'VIP_A15']).toContain(
        decision.selectedSeats[1]?.label
      );
    });

    it('should execute end-to-end seated booking journey on seatmap page up to PAYMENT_GATE', async () => {
      const dom = parseHtmlToDOMElementLike(`
        <div id="booking-container">
          <svg class="seatmap" width="800" height="600">
            <circle cx="100.0" cy="108.4" r="5" fill="#f00"></circle>
            <circle cx="110.0" cy="108.4" r="5" fill="#fff" id="circle-a2"></circle>
            <circle cx="120.0" cy="108.4" r="5" fill="#fff" id="circle-a3"></circle>
          </svg>
          <div class="bottom-bar">
            <button class="ant-btn-primary" id="btn-continue">Vui lòng chọn vé &gt;&gt;</button>
          </div>
        </div>
      `);
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const adapter = new TicketboxJourneyAdapter(undefined, dom);
      adapter.setSeatmapData(MOCK_SEATMAP_API_RESPONSE);
      const eventBus = new ChromeMessageBus();
      const useCase = new ExecuteBookingJourneyUseCase(
        stateMachine,
        adapter,
        eventBus,
        new SanitizedLogger()
      );

      const result = await useCase.execute({
        categoryPriority: ['1st Row (L&R)'],
        quantity: 2,
        allowFallback: false,
      });

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
      expect(result.selection?.seats).toEqual(['A2', 'A3']);
    });

    it('should reconcile already selected seats from DOM bottom bar', async () => {
      const dom = parseHtmlToDOMElementLike(`
        <div id="booking-container">
          <svg class="seatmap" width="800" height="600">
            <circle cx="100.0" cy="108.4" r="5" fill="#f00"></circle>
            <circle cx="110.0" cy="108.4" r="5" fill="#4CAF50" class="selected"></circle>
          </svg>
          <div class="bottom-bar">
            <span>Ghế: A2</span>
            <button class="ant-btn-primary" id="btn-continue">Tiếp tục &gt;&gt;</button>
          </div>
        </div>
      `);
      const adapter = new TicketboxJourneyAdapter(undefined, dom);
      adapter.setSeatmapData(MOCK_SEATMAP_API_RESPONSE);

      const seats = await adapter.discoverSeats('1st_ROW_L');
      const selected = seats.find((s) => s.label === 'A2');
      expect(selected?.status).toBe('SELECTED');
    });

    it('should find and select seat by attribute fallback when coordinates vary', async () => {
      const dom = parseHtmlToDOMElementLike(`
        <div id="booking-container">
          <svg class="seatmap" width="800" height="600">
            <circle data-seat-id="696602" data-seat-label="A2" r="5" fill="#fff"></circle>
          </svg>
        </div>
      `);
      const adapter = new TicketboxJourneyAdapter(undefined, dom);
      adapter.setSeatmapData(MOCK_SEATMAP_API_RESPONSE);

      await adapter.discoverSeats('1st_ROW_L');
      const ok = await adapter.selectSpecificSeats(['696602']);
      expect(ok).toBe(true);

      const target = dom.querySelector('[data-seat-id="696602"]');
      expect(target?.getAttribute('data-status')).toBe('selected');
      expect(target?.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('Area-based / Non-reserving Seatmap Handling (Concert Zones)', () => {
    const MOCK_AREA_BASED_SEATMAP_RESPONSE: SeatmapApiResponse = {
      status: 1,
      message: 'Success',
      data: {
        result: {
          id: 869,
          name: 'SAO CONCERT-VAN PHUC CITY.svg',
          status: 0,
          sections: [
            {
              id: 12724,
              seatMapId: 869,
              name: 'stage',
              isStage: true,
              isReservingSeat: false,
              status: 1,
            },
            {
              id: 12768,
              seatMapId: 869,
              name: 'ULTRA_VIP_L2',
              isReservingSeat: false,
              isStage: false,
              ticketTypeId: 1086256,
              status: 1,
              ticketType: {
                id: 1086256,
                name: 'ULTRA VIP - L2',
                price: 1550000,
                status: 'book_now',
                minQtyPerOrder: 1,
                maxQtyPerOrder: 6,
              },
              attribute: {
                x: 956.2,
                y: 1502.8,
                width: 211.8,
                height: 135.1,
              },
            },
            {
              id: 12725,
              seatMapId: 869,
              name: 'STARDOM_L',
              isReservingSeat: false,
              isStage: false,
              ticketTypeId: 1086309,
              status: 1,
              ticketType: {
                id: 1086309,
                name: 'STARDOM - L',
                price: 688000,
                status: 'book_now',
                minQtyPerOrder: 1,
                maxQtyPerOrder: 4,
              },
            },
          ],
        },
      },
    };

    it('should parse area-based sections with ticketTypeId and non-reserving seat attributes', () => {
      const areas = TicketboxSeatMapParser.parseAreasFromSeatmapApi(MOCK_AREA_BASED_SEATMAP_RESPONSE);
      expect(areas).toHaveLength(2); // stage skipped, 2 salable zones kept

      const ultraVip = areas.find((a) => a.id === '12768');
      expect(ultraVip).toBeDefined();
      expect(ultraVip?.name).toBe('ULTRA_VIP_L2');
      expect(ultraVip?.ticketTypeId).toBe('1086256');
      expect(ultraVip?.ticketTypeName).toBe('ULTRA VIP - L2');
      expect(ultraVip?.isReservingSeat).toBe(false);
      expect(ultraVip?.mode).toBe('AREA_BASED');
      expect(ultraVip?.availability).toBe('AVAILABLE');
      expect(ultraVip?.x).toBe(956.2);
    });

    it('should successfully complete journey on area-based seat map without individual seats', async () => {
      const origWindow = globalThis.window;
      globalThis.window = {
        location: {
          href: 'https://ticketbox.vn/events/26418/bookings/79214083095652/select-ticket',
        },
      } as unknown as Window & typeof globalThis;

      try {
        const dom = parseHtmlToDOMElementLike(`
          <div id="booking-container">
            <svg class="seatmap" width="1000" height="800">
              <g id="ULTRA_VIP_L2" data-section-id="12768">
                <text>ULTRA VIP - L2</text>
              </g>
            </svg>
            <div class="sidebar">
              <button class="ant-btn-primary" id="btn-continue">Tiếp tục &gt;&gt;</button>
            </div>
          </div>
        `);

        const stateMachine = new PurchaseStateMachine(PurchaseState.READY, 'attempt-area-test');
        stateMachine.transition({ type: 'ARM' });
        stateMachine.transition({ type: 'MONITORING_STARTED' });

        const adapter = new TicketboxJourneyAdapter(new SanitizedLogger(), dom);
        adapter.setSeatmapData(MOCK_AREA_BASED_SEATMAP_RESPONSE);

        const eventBus = new ChromeMessageBus();
        const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, new SanitizedLogger());

        const result = await useCase.execute({
          categoryPriority: ['ULTRA VIP - L2', '1086256'],
          quantity: 1,
          allowFallback: false,
        });

        expect(result.success).toBe(true);
        expect(result.finalState).toBe(PurchaseState.SEATS_SELECTED);
        expect(result.selection?.seats).toContain('ULTRA_VIP_L2');
        expect(stateMachine.state).toBe(PurchaseState.SEATS_SELECTED);
      } finally {
        globalThis.window = origWindow;
      }
    });
  });
});

