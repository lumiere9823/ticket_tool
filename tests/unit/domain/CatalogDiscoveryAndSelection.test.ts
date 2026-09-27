import { describe, it, expect } from 'vitest';
import { TicketboxCatalogParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxCatalogParser';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { AvailabilityEvaluator } from '../../../src/domain/policies/AvailabilityEvaluator';
import { TicketCandidateSelector } from '../../../src/domain/policies/TicketCandidateSelector';
import { TicketPreference } from '../../../src/domain/entities/TicketPreference';
import { Quantity } from '../../../src/domain/value-objects/Quantity';
import { CATALOG_FIXTURES } from '../../fixtures/catalog/catalogFixtures';
import { SafeStubAdapter } from '../../../src/infrastructure/ticketbox/SafeStubAdapter';
import { TicketboxDiscoveryAdapter } from '../../../src/infrastructure/ticketbox/TicketboxDiscoveryAdapter';

describe('Ticketbox Event Ticket Catalog, Availability & Quantity Discovery', () => {
  // =========================================================================
  // 1. DETERMINISTIC TEST FIXTURES (16 Scenarios)
  // =========================================================================
  describe('Deterministic Test Fixtures Parsing', () => {
    it('1. Event page with multiple standing tickets', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MULTIPLE_STANDING);
      const catalog = TicketboxCatalogParser.parseCatalog(
        dom,
        'https://ticketbox.vn/concert-anh-trai-vuot-ngan-chong-gai-2026-day-1-day-2-26416#ticket-info'
      );

      expect(catalog.eventId).toBe('26416');
      expect(catalog.eventTitle).toContain('Concert Anh Trai Vượt Ngàn Chông Gai 2026');
      expect(catalog.showings).toHaveLength(1);

      const tickets = catalog.showings[0]!.ticketTypes;
      expect(tickets).toHaveLength(2);

      expect(tickets[0]!.name).toBe('Hoả Tâm 1 (Standing)');
      expect(tickets[0]!.price.amount).toBe(3000000);
      expect(tickets[0]!.price.currency).toBe('VND');
      expect(tickets[0]!.mode).toBe('STANDING');
      expect(tickets[0]!.availability).toBe('AVAILABLE');
      expect(tickets[0]!.selectable).toBe(true);

      expect(tickets[1]!.name).toBe('Hoả Tâm 2 (Standing)');
      expect(tickets[1]!.price.amount).toBe(2500000);
      expect(tickets[1]!.mode).toBe('STANDING');
      expect(tickets[1]!.availability).toBe('AVAILABLE');
      expect(tickets[1]!.selectable).toBe(true);
    });

    it('2. Event page with seated tickets', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.SEATED_TICKETS);
      const catalog = TicketboxCatalogParser.parseCatalog(
        dom,
        'https://ticketbox.vn/event/giao-huong-mua-xuan-9988'
      );

      const tickets = catalog.showings[0]!.ticketTypes;
      expect(tickets).toHaveLength(2);

      expect(tickets[0]!.name).toBe('Khán Đài VIP (Seated)');
      expect(tickets[0]!.mode).toBe('SEATED');
      expect(tickets[0]!.price.amount).toBe(4500000);

      expect(tickets[1]!.name).toBe('Khán Đài A (Ngồi)');
      expect(tickets[1]!.mode).toBe('SEATED');
      expect(tickets[1]!.price.amount).toBe(2000000);
    });

    it('3. Mixed standing/seated catalog', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MIXED_STANDING_SEATED);
      const catalog = TicketboxCatalogParser.parseCatalog(
        dom,
        'https://ticketbox.vn/event/live-fest-100'
      );

      const tickets = catalog.showings[0]!.ticketTypes;
      expect(tickets).toHaveLength(2);

      expect(tickets[0]!.mode).toBe('STANDING');
      expect(tickets[0]!.price.amount).toBe(3200000);

      expect(tickets[1]!.mode).toBe('SEATED');
      expect(tickets[1]!.price.amount).toBe(2800000);
    });

    it('4. Available ticket', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.AVAILABLE_TICKET);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.availability).toBe('AVAILABLE');
      expect(ticket.selectable).toBe(true);
      expect(ticket.source.evidence).toContain('EXPLICIT_ON_SALE_SIGNAL');
    });

    it('5. Sold-out ticket', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.SOLDOUT_TICKET);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.availability).toBe('SOLD_OUT');
      expect(ticket.selectable).toBe(false);
      expect(ticket.source.evidence).toContain('EXPLICIT_SOLD_OUT_SIGNAL');
      expect(ticket.source.evidence).toContain('CONTROL_DISABLED');
    });

    it('6. Unknown availability (insufficient evidence)', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.UNKNOWN_AVAILABILITY);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      // Invariant: Visible ticket without availability signals must be UNKNOWN
      expect(ticket.availability).toBe('UNKNOWN');
      expect(ticket.selectable).toBe(false);
      expect(ticket.source.evidence).toContain('INSUFFICIENT_EVIDENCE_FOR_AVAILABILITY');
    });

    it('7. Disabled ticket', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.DISABLED_TICKET);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.selectable).toBe(false);
      expect(ticket.availability).toBe('UNKNOWN'); // Disabled without explicit sold-out text is UNKNOWN
    });

    it('8. Quantity input with min/max', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.QUANTITY_WITH_MIN_MAX);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.minQuantity).toBe(2);
      expect(ticket.maxQuantity).toBe(6);
      expect(ticket.selectedQuantity).toBe(2);
      expect(ticket.source.evidence).toContain('OBSERVABLE_MAX_QUANTITY_6');
      expect(ticket.source.evidence).toContain('OBSERVABLE_MIN_QUANTITY_2');
    });

    it('9. Quantity control without explicit max', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.QUANTITY_WITHOUT_EXPLICIT_MAX);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      // Invariant: Never invent maxQuantity = 4 when not observable
      expect(ticket.maxQuantity).toBeNull();
      expect(ticket.minQuantity).toBeNull();
      expect(ticket.selectedQuantity).toBe(1);
    });

    it('10. Multiple showings', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MULTIPLE_SHOWINGS);
      const catalog = TicketboxCatalogParser.parseCatalog(
        dom,
        'https://ticketbox.vn/event/kich-dem-dong-555'
      );

      expect(catalog.showings).toHaveLength(2);

      const s1 = catalog.showings[0]!;
      expect(s1.id).toBe('show-day-1');
      expect(s1.name).toBe('Đêm diễn 1');
      expect(s1.date).toBe('2026-10-15');
      expect(s1.ticketTypes).toHaveLength(1);
      expect(s1.ticketTypes[0]!.name).toBe('Vé Đêm 1');
      expect(s1.ticketTypes[0]!.price.amount).toBe(600000);

      const s2 = catalog.showings[1]!;
      expect(s2.id).toBe('show-day-2');
      expect(s2.name).toBe('Đêm diễn 2');
      expect(s2.date).toBe('2026-10-16');
      expect(s2.ticketTypes).toHaveLength(1);
      expect(s2.ticketTypes[0]!.name).toBe('Vé Đêm 2');
      expect(s2.ticketTypes[0]!.price.amount).toBe(700000);
    });

    it('11. Ticket name containing parentheses', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.NAME_WITH_PARENTHESES);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.name).toBe('Ngoại Ô 1 (Seated - Hàng Đầu) (VIP Special)');
      expect(ticket.rawLabel).toContain('VIP Special');
      expect(ticket.mode).toBe('SEATED');
      expect(ticket.price.amount).toBe(3500000);
    });

    it('12. VND price parsing variations', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.VND_PRICE_VARIATIONS);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const tickets = catalog.showings[0]!.ticketTypes;

      expect(tickets).toHaveLength(4);
      expect(tickets[0]!.price.amount).toBe(3500000); // 3.500.000 đ
      expect(tickets[1]!.price.amount).toBe(2500000); // 2,500,000 VND
      expect(tickets[2]!.price.amount).toBe(1200000); // 1.200.000đ
      expect(tickets[3]!.price.amount).toBe(900000); // 900000 VNĐ
    });

    it('13. Duplicate visible labels', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.DUPLICATE_VISIBLE_LABELS);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const tickets = catalog.showings[0]!.ticketTypes;

      expect(tickets).toHaveLength(2);
      expect(tickets[0]!.name).toBe('Standard Zone');
      expect(tickets[0]!.id).toBe('dup-1');
      expect(tickets[1]!.name).toBe('Standard Zone');
      expect(tickets[1]!.id).toBe('dup-2');
    });

    it('14. Missing ticket price', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MISSING_TICKET_PRICE);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.name).toBe('Vé Mời Đặc Biệt');
      expect(ticket.price.amount).toBe(0);
      expect(ticket.source.evidence).toContain('PRICE_NOT_OBSERVABLE');
    });

    it('15. Malformed ticket candidate', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MALFORMED_CANDIDATE);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const tickets = catalog.showings[0]!.ticketTypes;

      // Empty item is skipped, valid ticket extracted
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.name).toBe('Vé Hợp Lệ');
      expect(tickets[0]!.price.amount).toBe(500000);
    });

    it('16. Empty catalog', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.EMPTY_CATALOG);
      const catalog = TicketboxCatalogParser.parseCatalog(
        dom,
        'https://ticketbox.vn/event/no-tickets-000'
      );

      expect(catalog.showings[0]!.ticketTypes).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. TICKET CANDIDATE SELECTOR TESTS
  // =========================================================================
  describe('TicketCandidateSelector Policy & Fallback Verification', () => {
    it('should select top preferred category when available', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MULTIPLE_STANDING);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);

      const pref = new TicketPreference({
        categoryPriority: ['Hoả Tâm 1', 'Hoả Tâm 2'],
        quantity: new Quantity(2),
        allowFallback: true,
      });

      const result = TicketCandidateSelector.selectBestCandidate(catalog, pref);

      expect(result.selectedCandidate).not.toBeNull();
      expect(result.selectedCandidate!.ticket.name).toBe('Hoả Tâm 1 (Standing)');
      expect(result.isFallback).toBe(false);
    });

    it('should fallback to second priority when top priority is SOLD_OUT and allowFallback=true', () => {
      const dom = parseHtmlToDOMElementLike(`
        <div id="ticket-info">
          <div class="ticket-item" data-ticket-id="t-1" data-availability="sold_out">
            <h3>Hoả Tâm 1 (Standing)</h3>
            <span class="price">3.000.000 đ</span>
            <button disabled>Hết vé</button>
          </div>
          <div class="ticket-item" data-ticket-id="t-2">
            <h3>Hoả Tâm 2 (Standing)</h3>
            <span class="price">2.500.000 đ</span>
            <button>Mua ngay</button>
          </div>
        </div>
      `);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);

      const pref = new TicketPreference({
        categoryPriority: ['Hoả Tâm 1', 'Hoả Tâm 2'],
        quantity: new Quantity(2),
        allowFallback: true,
      });

      const result = TicketCandidateSelector.selectBestCandidate(catalog, pref);

      expect(result.selectedCandidate).not.toBeNull();
      expect(result.selectedCandidate!.ticket.name).toBe('Hoả Tâm 2 (Standing)');
      expect(result.isFallback).toBe(true);
      expect(result.reason).toContain('Fell back');
    });

    it('should REJECT fallback and return null when top priority is SOLD_OUT and allowFallback=false', () => {
      const dom = parseHtmlToDOMElementLike(`
        <div id="ticket-info">
          <div class="ticket-item" data-ticket-id="t-1" data-availability="sold_out">
            <h3>Hoả Tâm 1 (Standing)</h3>
            <span class="price">3.000.000 đ</span>
            <button disabled>Hết vé</button>
          </div>
          <div class="ticket-item" data-ticket-id="t-2">
            <h3>Hoả Tâm 2 (Standing)</h3>
            <span class="price">2.500.000 đ</span>
            <button>Mua ngay</button>
          </div>
        </div>
      `);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);

      const pref = new TicketPreference({
        categoryPriority: ['Hoả Tâm 1', 'Hoả Tâm 2'],
        quantity: new Quantity(2),
        allowFallback: false, // Strict: no fallback!
      });

      const result = TicketCandidateSelector.selectBestCandidate(catalog, pref);

      expect(result.selectedCandidate).toBeNull();
      expect(result.isFallback).toBe(false);
      expect(result.reason).toContain('allowFallback is false');
    });

    it('should REJECT ticket when requested quantity exceeds observable maxQuantity', () => {
      const dom = parseHtmlToDOMElementLike(`
        <div id="ticket-info">
          <div class="ticket-item">
            <h3>Vé Giới Hạn</h3>
            <span class="price">1.000.000 đ</span>
            <input type="number" min="1" max="2" value="1" />
            <button>Mua</button>
          </div>
        </div>
      `);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);

      const pref = new TicketPreference({
        categoryPriority: ['Vé Giới Hạn'],
        quantity: new Quantity(4), // 4 > maxQuantity of 2
        allowFallback: false,
      });

      const result = TicketCandidateSelector.selectBestCandidate(catalog, pref);

      expect(result.selectedCandidate).toBeNull();
      const candidate = result.allCandidates[0]!;
      expect(candidate.canAttemptSelection).toBe(false);
      expect(candidate.rejectionReasons).toContain('QUANTITY_EXCEEDS_MAX: 4 > 2');
    });

    it('should NEVER select arbitrary ticket categories outside user preferences', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.MULTIPLE_STANDING);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);

      const pref = new TicketPreference({
        categoryPriority: ['Super VIP Lounge'], // Not in catalog
        quantity: new Quantity(1),
        allowFallback: true,
      });

      const result = TicketCandidateSelector.selectBestCandidate(catalog, pref);

      // Must NOT arbitrarily pick Hoả Tâm 1 or Hoả Tâm 2
      expect(result.selectedCandidate).toBeNull();
      expect(result.reason).toContain('No ticket in catalog matched');
    });
  });

  // =========================================================================
  // 3. NEGATIVE INVARIANT TESTS
  // =========================================================================
  describe('Negative Invariant Verification', () => {
    it('UNKNOWN availability is NEVER silently converted to AVAILABLE', () => {
      const signals = {
        visibleText: 'Một loại vé không có nút bấm hay trạng thái',
        isDisabled: false,
      };

      const evalResult = AvailabilityEvaluator.evaluateAvailability(signals);
      expect(evalResult.availability).toBe('UNKNOWN');
      expect(evalResult.selectable).toBe(false);
    });

    it('Visible ticket is NOT automatically selectable without active control', () => {
      const signals = {
        visibleText: 'Vé Xem Thử',
        isControlEnabled: false,
      };

      const evalResult = AvailabilityEvaluator.evaluateAvailability(signals);
      expect(evalResult.selectable).toBe(false);
    });

    it('Presence of a seated zone is NOT proof that seats are available', () => {
      const signals = {
        mode: 'SEATED' as const,
        hasSeatMap: true,
        availableSeatCount: 0, // Seat map has 0 seats left
      };

      const evalResult = AvailabilityEvaluator.evaluateAvailability(signals);
      expect(evalResult.availability).toBe('SOLD_OUT');
      expect(evalResult.selectable).toBe(false);
    });

    it('Missing max quantity does NOT become an invented value like 4', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.QUANTITY_WITHOUT_EXPLICIT_MAX);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      expect(ticket.maxQuantity).toBeNull();
    });

    it('Malformed HTML does NOT crash the parser', () => {
      const malformedHtml = `
        <div>
          <section id="ticket-info">
            <div class="ticket-item"><h3>Unclosed title
            <span class="price">3.000.000 đ
            <button disabled>Hết vé
        </div>
      `;
      const dom = parseHtmlToDOMElementLike(malformedHtml);

      expect(() => {
        const catalog = TicketboxCatalogParser.parseCatalog(dom);
        expect(catalog).toBeDefined();
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 4. CATALOG VS BOOKING REVALIDATION
  // =========================================================================
  describe('Catalog vs Booking Transaction Revalidation', () => {
    it('should confirm available ticket if selectable in booking flow', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.AVAILABLE_TICKET);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      const revalidation = AvailabilityEvaluator.revalidateInBooking(ticket, {
        isSelectableInBooking: true,
        isQuantityAvailable: true,
      });

      expect(revalidation.isConfirmedAvailable).toBe(true);
      expect(revalidation.evidence).toContain('BOOKING_SELECTION_CONFIRMED_SELECTABLE');
    });

    it('should REJECT confirmation if booking page shows selection unavailable', () => {
      const dom = parseHtmlToDOMElementLike(CATALOG_FIXTURES.AVAILABLE_TICKET);
      const catalog = TicketboxCatalogParser.parseCatalog(dom);
      const ticket = catalog.showings[0]!.ticketTypes[0]!;

      const revalidation = AvailabilityEvaluator.revalidateInBooking(ticket, {
        isSelectableInBooking: false,
        bookingErrorText: 'Vé này vừa hết trong quá trình chọn',
      });

      expect(revalidation.isConfirmedAvailable).toBe(false);
      expect(revalidation.reason).toContain('Vé này vừa hết');
      expect(revalidation.evidence).toContain('BOOKING_SELECTION_CONTROL_DISABLED');
    });
  });

  // =========================================================================
  // 5. PAGE TYPE DETECTION
  // =========================================================================
  describe('Page Type Detection', () => {
    it('detects EVENT page from URL and DOM', () => {
      const dom = parseHtmlToDOMElementLike('<div id="ticket-info"><h1>Concert</h1></div>');
      const pageType = TicketboxCatalogParser.detectPageType(
        'https://ticketbox.vn/concert-2026-26416#ticket-info',
        dom
      );
      expect(pageType).toBe('EVENT');
    });

    it('detects TICKET_SELECTION page from URL', () => {
      const pageType = TicketboxCatalogParser.detectPageType(
        'https://ticketbox.vn/events/26416/select-ticket'
      );
      expect(pageType).toBe('TICKET_SELECTION');
    });

    it('detects QUESTION_FORM page from URL', () => {
      const pageType = TicketboxCatalogParser.detectPageType(
        'https://ticketbox.vn/events/26416/question-form'
      );
      expect(pageType).toBe('QUESTION_FORM');
    });

    it('detects CHECKOUT page from URL', () => {
      const pageType = TicketboxCatalogParser.detectPageType(
        'https://ticketbox.vn/events/26416/checkout'
      );
      expect(pageType).toBe('CHECKOUT');
    });

    it('detects UNKNOWN page when unrecognizable', () => {
      const pageType = TicketboxCatalogParser.detectPageType('https://other-site.com/random');
      expect(pageType).toBe('UNKNOWN');
    });
  });

  // =========================================================================
  // 6. ADAPTERS DISCOVERY INTEGRATION
  // =========================================================================
  describe('Adapter Catalog Discovery Integration', () => {
    it('SafeStubAdapter returns safe stubs for all extended catalog methods', async () => {
      const stub = new SafeStubAdapter();

      expect(await stub.detectPage()).toBe('UNKNOWN');
      expect(await stub.discoverEvent()).toBeNull();
      expect(await stub.discoverShowings()).toHaveLength(0);

      const catalog = await stub.discoverTicketCatalog();
      expect(catalog.showings).toHaveLength(0);

      const seatMap = await stub.detectSeatMap();
      expect(seatMap.hasSeatMap).toBe(false);

      expect(await stub.selectQuantity({} as never, 2)).toBe(false);

      expect(await stub.selectSeats({ seatIds: ['s1'] })).toBe(false);
    });

    it('TicketboxDiscoveryAdapter performs passive detection and blocks mutations', async () => {
      const adapter = new TicketboxDiscoveryAdapter();

      const pageType = await adapter.detectPage();
      expect(pageType).toBeDefined();

      const seatMap = await adapter.detectSeatMap();
      expect(seatMap.hasSeatMap).toBe(false);

      // Discovery mode forbids mutating form or selecting seats
      const qtyResult = await adapter.selectQuantity({ name: 'VIP' } as never, 2);
      expect(qtyResult).toBe(false);

      const seatResult = await adapter.selectSeats({ seatIds: ['A-1'] });
      expect(seatResult).toBe(false);
    });
  });
});
