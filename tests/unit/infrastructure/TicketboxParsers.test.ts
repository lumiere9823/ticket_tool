import { describe, it, expect } from 'vitest';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { TicketboxSeatMapParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxSeatMapParser';
import { TicketboxSummaryParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxSummaryParser';
import { TicketboxFormParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxFormParser';
import { BOOKING_JOURNEY_FIXTURES } from '../../fixtures/booking/bookingFixtures';

describe('Ticketbox Parsers', () => {
  describe('TicketboxSeatMapParser', () => {
    it('should parse selectable seat areas from Case D', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_D_SEATED_WITH_AREA_SELECTION);
      const areas = TicketboxSeatMapParser.parseAreas(root);

      expect(areas.length).toBeGreaterThanOrEqual(3);

      const hoaTam = areas.find((a) => a.name.includes('HỎA TÂM 1'));
      expect(hoaTam).toBeDefined();
      expect(hoaTam?.availability).toBe('SOLD_OUT');
      expect(hoaTam?.selectable).toBe(false);

      const ngoaiO = areas.find((a) => a.name.includes('NGOẠI Ô 1'));
      expect(ngoaiO).toBeDefined();
      expect(ngoaiO?.availability).toBe('AVAILABLE');
      expect(ngoaiO?.selectable).toBe(true);
      expect(ngoaiO?.price).toBe(3500000);
      expect(ngoaiO?.availableSeatCount).toBe(84);
    });

    it('should parse individual seats from Case E', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_E_SEATED_WITH_SEAT_MAP);
      const seats = TicketboxSeatMapParser.parseSeats(root);

      expect(seats.length).toBe(2);
      expect(seats[0]?.label).toBe('A01');
      expect(seats[0]?.row).toBe('A');
      expect(seats[0]?.number).toBe(1);
      expect(seats[0]?.status).toBe('AVAILABLE');
      expect(seats[0]?.selectable).toBe(true);

      expect(seats[1]?.label).toBe('A02');
      expect(seats[1]?.row).toBe('A');
      expect(seats[1]?.number).toBe(2);
      expect(seats[1]?.status).toBe('AVAILABLE');
      expect(seats[1]?.selectable).toBe(true);
    });

    it('should classify seat statuses accurately from Case F (occupied vs available)', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_F_TWO_ADJACENT_SEATS);
      const seats = TicketboxSeatMapParser.parseSeats(root);

      expect(seats.length).toBe(5);
      const s01 = seats.find((s) => s.label === 'A01');
      const s02 = seats.find((s) => s.label === 'A02');
      const s03 = seats.find((s) => s.label === 'A03');
      const s05 = seats.find((s) => s.label === 'A05');
      const s06 = seats.find((s) => s.label === 'A06');

      expect(s01?.status).toBe('OCCUPIED');
      expect(s01?.selectable).toBe(false);

      expect(s02?.status).toBe('AVAILABLE');
      expect(s02?.selectable).toBe(true);

      expect(s03?.status).toBe('AVAILABLE');
      expect(s03?.selectable).toBe(true);

      expect(s05?.status).toBe('AVAILABLE');
      expect(s05?.selectable).toBe(true);

      expect(s06?.status).toBe('OCCUPIED');
      expect(s06?.selectable).toBe(false);
    });
  });

  describe('TicketboxSummaryParser', () => {
    it('should parse standing booking summary from Case A', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING);
      const summary = TicketboxSummaryParser.parseSummary(root);

      expect(summary).not.toBeNull();
      expect(summary?.items).toHaveLength(1);
      expect(summary?.items[0]?.ticket).toBe('Hoả Tâm 2');
      expect(summary?.items[0]?.quantity).toBe(2);
      expect(summary?.items[0]?.price).toBe(3000000);
      expect(summary?.subtotal).toBe(6000000);
      expect(summary?.fees).toBe(0);
      expect(summary?.total).toBe(6000000);
    });

    it('should parse seated booking summary with assigned seats from Case D', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_D_SEATED_WITH_AREA_SELECTION);
      const summary = TicketboxSummaryParser.parseSummary(root);

      expect(summary).not.toBeNull();
      expect(summary?.items).toHaveLength(1);
      expect(summary?.items[0]?.ticket).toBe('Ngoại Ô 1');
      expect(summary?.items[0]?.quantity).toBe(2);
      expect(summary?.items[0]?.seats).toEqual(['A12', 'A13']);
      expect(summary?.subtotal).toBe(7000000);
      expect(summary?.total).toBe(7000000);
    });

    it('should return null when summary panel is absent', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_L_UNSUPPORTED_STRUCTURE);
      const summary = TicketboxSummaryParser.parseSummary(root);
      expect(summary).toBeNull();
    });
  });

  describe('TicketboxFormParser', () => {
    it('should extract attendee form fields from Case I', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_I_QUESTION_FORM);
      const formSchema = TicketboxFormParser.parseForm(root);

      expect(formSchema).not.toBeNull();
      expect(formSchema?.fields).toHaveLength(3);

      const nameField = formSchema?.fields.find((f) => f.label.includes('Họ và tên'));
      expect(nameField?.required).toBe(true);
      expect(nameField?.type).toBe('TEXT');

      const phoneField = formSchema?.fields.find((f) => f.label.includes('Số điện thoại'));
      expect(phoneField?.required).toBe(true);
      expect(phoneField?.type).toBe('PHONE');

      const emailField = formSchema?.fields.find((f) => f.label.includes('Email'));
      expect(emailField?.required).toBe(true);
      expect(emailField?.type).toBe('EMAIL');
    });

    it('should detect consent checkbox and terms requirement from Case J', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_J_CONSENT_FORM);
      const formSchema = TicketboxFormParser.parseForm(root);

      expect(formSchema).not.toBeNull();
      expect(formSchema?.hasConsentCheckbox).toBe(true);
      expect(formSchema?.consentLabel).toContain('đồng ý');
      expect(formSchema?.fields).toHaveLength(2);

      const consentField = formSchema?.fields.find((f) => f.type === 'CHECKBOX');
      expect(consentField?.required).toBe(true);
    });

    it('should return null when no form inputs exist', () => {
      const root = parseHtmlToDOMElementLike(BOOKING_JOURNEY_FIXTURES.CASE_L_UNSUPPORTED_STRUCTURE);
      const formSchema = TicketboxFormParser.parseForm(root);
      expect(formSchema).toBeNull();
    });
  });
});
