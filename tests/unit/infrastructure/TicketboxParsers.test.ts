import { describe, it, expect } from 'vitest';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { TicketboxSeatMapParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxSeatMapParser';
import { TicketboxSummaryParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxSummaryParser';
import { TicketboxFormParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxFormParser';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { BOOKING_JOURNEY_FIXTURES } from '../../fixtures/booking/bookingFixtures';

describe('Ticketbox Parsers', () => {
  describe('TicketboxSeatMapParser', () => {
    it('should parse selectable seat areas from Case D', () => {
      const root = parseHtmlToDOMElementLike(
        BOOKING_JOURNEY_FIXTURES.CASE_D_SEATED_WITH_AREA_SELECTION
      );
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
      const root = parseHtmlToDOMElementLike(
        BOOKING_JOURNEY_FIXTURES.CASE_D_SEATED_WITH_AREA_SELECTION
      );
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

    it('should parse real Ticketbox Vietnamese attendee questionnaire with consent radio and generic placeholder inputs', () => {
      const html = `
        <div class="question-container">
          <h2>BẢNG CÂU HỎI</h2>
          <div class="tier-section">
            <h3>YELLOW</h3>
            <div class="form-item">
              <div class="title">TÔI ĐỒNG Ý CHO BTC VÀ TICKETBOX SỬ DỤNG THÔNG TIN CHO MỤC ĐÍCH VẬN HÀNH SỰ KIỆN *</div>
              <label class="ant-radio-wrapper">
                <input type="radio" name="consent" class="ant-radio-input" />
                <span>Tôi đồng ý</span>
              </label>
            </div>
            <div class="form-item">
              <div class="title">Họ & tên / Full name</div>
              <input type="text" name="full_name" placeholder="Điền câu trả lời của bạn" />
            </div>
            <div class="form-item">
              <div class="title">Số điện thoại *</div>
              <input type="tel" name="phone_number" placeholder="Điền câu trả lời của bạn" />
            </div>
            <div class="form-item">
              <div class="title">Email *</div>
              <input type="email" name="email_address" placeholder="Điền câu trả lời của bạn" />
            </div>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const formSchema = TicketboxFormParser.parseForm(root);

      expect(formSchema).not.toBeNull();
      expect(formSchema?.hasConsentCheckbox).toBe(true);
      expect(formSchema?.fields).toHaveLength(4);

      const consentField = formSchema?.fields.find((f) => f.type === 'RADIO');
      expect(consentField).toBeDefined();

      const nameField = formSchema?.fields.find((f) => f.label.toLowerCase().includes('họ & tên'));
      expect(nameField).toBeDefined();
      expect(nameField?.type).toBe('TEXT');

      const phoneField = formSchema?.fields.find((f) => f.type === 'PHONE');
      expect(phoneField).toBeDefined();
      expect(phoneField?.required).toBe(true);

      const emailField = formSchema?.fields.find((f) => f.type === 'EMAIL');
      expect(emailField).toBeDefined();
      expect(emailField?.required).toBe(true);
    });

    it('should fill Vietnamese attendee questionnaire and tick consent radio when agreeToTerms is true', async () => {
      const html = `
        <div class="question-container">
          <h2>BẢNG CÂU HỎI</h2>
          <div class="tier-section">
            <div class="form-item">
              <div class="title">TÔI ĐỒNG Ý CHO BTC VÀ TICKETBOX SỬ DỤNG THÔNG TIN CHO MỤC ĐÍCH VẬN HÀNH SỰ KIỆN *</div>
              <label class="ant-radio-wrapper">
                <input type="radio" name="consent" class="ant-radio-input" />
                <span>Tôi đồng ý</span>
              </label>
            </div>
            <div class="form-item">
              <div class="title">Họ & tên / Full name</div>
              <input type="text" name="full_name" placeholder="Điền câu trả lời của bạn" />
            </div>
            <div class="form-item">
              <div class="title">Số điện thoại *</div>
              <input type="tel" name="phone_number" placeholder="Điền câu trả lời của bạn" />
            </div>
            <div class="form-item">
              <div class="title">Email *</div>
              <input type="email" name="email_address" placeholder="Điền câu trả lời của bạn" />
            </div>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(undefined, root);

      const fillResult = await adapter.fillAttendeeForm({
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        email: 'nguyenvana@gmail.com',
        agreeToTerms: true,
      });

      expect(fillResult.isConsentBlocked).toBe(false);
      expect(fillResult.allSatisfied).toBe(true);
      expect(fillResult.missingFields).toHaveLength(0);

      // Verify DOM inputs updated
      const consentInput = root.querySelector('input[name="consent"]');
      expect(consentInput?.getAttribute('checked')).toBe('true');

      const nameInput = root.querySelector('input[name="full_name"]');
      expect(nameInput?.getAttribute('value')).toBe('Nguyễn Văn A');

      const phoneInput = root.querySelector('input[name="phone_number"]');
      expect(phoneInput?.getAttribute('value')).toBe('0901234567');

      const emailInput = root.querySelector('input[name="email_address"]');
      expect(emailInput?.getAttribute('value')).toBe('nguyenvana@gmail.com');
    });

    it('should block with isConsentBlocked when agreeToTerms is false on Vietnamese questionnaire', async () => {
      const html = `
        <div class="question-container">
          <div class="form-item">
            <div class="title">TÔI ĐỒNG Ý CHO BTC VÀ TICKETBOX SỬ DỤNG THÔNG TIN CHO MỤC ĐÍCH VẬN HÀNH SỰ KIỆN *</div>
            <input type="radio" name="consent" />
          </div>
          <div class="form-item">
            <div class="title">Họ & tên / Full name</div>
            <input type="text" name="full_name" />
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(undefined, root);

      const fillResult = await adapter.fillAttendeeForm({
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        email: 'nguyenvana@gmail.com',
        agreeToTerms: false,
      });

      expect(fillResult.isConsentBlocked).toBe(true);
      expect(fillResult.allSatisfied).toBe(false);
    });
  });

  describe('proceedToNextStep & Tailwind disabled handling', () => {
    it('should successfully click continue button having Tailwind disabled: prefix classes', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button id="btn-continue" class="flex items-center justify-center bg-green-500 text-white disabled:opacity-50 disabled:cursor-not-allowed">
            <span>Tiếp tục - 1.000.000 đ &gt;&gt;</span>
          </button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('#btn-continue');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(true);
      expect(wasClicked).toBe(true);
      expect(adapter.isNavigationPending()).toBe(true);
    });

    it('should ignore prompt button containing "vui lòng"', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button class="bg-gray-400 text-white">
            <span>Vui lòng chọn vé &gt;&gt;</span>
          </button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('button');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(false);
      expect(wasClicked).toBe(false);
    });

    it('should ignore button with native disabled attribute', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button disabled="disabled" class="ant-btn">
            <span>Tiếp tục &gt;&gt;</span>
          </button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('button');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(false);
      expect(wasClicked).toBe(false);
    });

    it('should ignore button with aria-disabled="true" or ant-btn-disabled class', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button class="ant-btn ant-btn-primary ant-btn-disabled" aria-disabled="true">
            <span>Tiếp tục</span>
          </button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('button');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(false);
      expect(wasClicked).toBe(false);
    });
  });

  // P2-9: URL-based page guard and per-page keyword allowlist
  describe('proceedToNextStep — P2-9 page guard (URL-based allowlist)', () => {
    it('should return false WITHOUT scanning DOM when URL is /payment', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button id="btn-continue"><span>Thanh toán</span></button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('#btn-continue');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      adapter.setCustomUrl('https://ticketbox.vn/payment/order-abc');
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(false);
      expect(wasClicked).toBe(false);
    });

    it('should return false WITHOUT scanning DOM when URL is /checkout', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button id="btn-continue"><span>Tiếp tục</span></button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('#btn-continue');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      adapter.setCustomUrl('https://ticketbox.vn/checkout/confirm');
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(false);
      expect(wasClicked).toBe(false);
    });

    it('should NOT click a "Thanh toán" button on /select-ticket page', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button id="btn-pay"><span>Thanh toán</span></button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('#btn-pay');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      adapter.setCustomUrl('https://ticketbox.vn/event/abc/select-ticket');
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(false);
      expect(wasClicked).toBe(false);
    });

    it('should click "Tiếp tục" on /select-ticket page', async () => {
      let wasClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button id="btn-continue"><span>Tiếp tục</span></button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const btn = root.querySelector('#btn-continue');
      if (btn) {
        btn.click = () => {
          wasClicked = true;
        };
      }

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      adapter.setCustomUrl('https://ticketbox.vn/event/abc/select-ticket');
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(true);
      expect(wasClicked).toBe(true);
    });

    it('should click "Tiếp tục" on /question-form page but NOT "Thanh toán"', async () => {
      let payClicked = false;
      let continueClicked = false;
      const html = `
        <div class="sidebar-footer">
          <button id="btn-pay"><span>Thanh toán</span></button>
          <button id="btn-continue"><span>Tiếp tục</span></button>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);
      const payBtn = root.querySelector('#btn-pay');
      const continueBtn = root.querySelector('#btn-continue');
      if (payBtn)
        payBtn.click = () => {
          payClicked = true;
        };
      if (continueBtn)
        continueBtn.click = () => {
          continueClicked = true;
        };

      const adapter = new TicketboxJourneyAdapter(undefined, root);
      adapter.setCustomUrl('https://ticketbox.vn/event/abc/question-form');
      const result = await adapter.proceedToNextStep();

      expect(result).toBe(true);
      expect(payClicked).toBe(false);
      expect(continueClicked).toBe(true);
    });
  });
});
