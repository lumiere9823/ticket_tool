/**
 * Deterministic Test Fixtures covering Cases A through L for the Booking Journey.
 * Conforms to Section 32 and 37.
 */

export const BOOKING_JOURNEY_FIXTURES = {
  // CASE A: Standing ticket
  CASE_A_STANDING: `
    <div id="event-detail">
      <h1>Concert Anh Trai Vượt Ngàn Chông Gai</h1>
      <div class="session-tab" data-showing-id="show-1">
        <h4 class="showing-name">Đêm diễn 1</h4>
        <time class="showing-date">2026-10-18 19:00</time>
        <div class="ticket-item" data-ticket-id="stand-ht2">
          <h3 class="ticket-name">Hoả Tâm 2</h3>
          <span class="price">3.000.000 đ</span>
          <span class="mode-badge">Standing</span>
          <span class="status">Đang mở bán</span>
          <input type="number" class="qty-input" min="1" max="4" value="1" />
          <button type="button">Mua ngay</button>
        </div>
      </div>
      <div class="booking-summary" id="order-summary">
        <div class="summary-item">
          <span class="ticket-name">Hoả Tâm 2</span>
          <span class="qty">2</span>
          <span class="price">3.000.000 đ</span>
        </div>
        <div class="subtotal">6.000.000 đ</div>
        <div class="fees">0 đ</div>
        <div class="total">6.000.000 đ</div>
      </div>
    </div>
  `,

  // CASE B: Standing ticket with max quantity = 1
  CASE_B_STANDING_MAX_QTY_1: `
    <div id="event-detail">
      <h1>Sự Kiện Giới Hạn 1 Vé</h1>
      <div class="ticket-item" data-ticket-id="stand-limited">
        <h3 class="ticket-name">GA Special Limited</h3>
        <span class="price">1.500.000 đ</span>
        <span class="mode-badge">Standing</span>
        <input type="number" class="qty-input" min="1" max="1" value="1" />
        <button type="button">Mua ngay</button>
      </div>
      <div class="booking-summary">
        <div class="summary-item">
          <span class="ticket-name">GA Special Limited</span>
          <span class="qty">1</span>
          <span class="price">1.500.000 đ</span>
        </div>
        <div class="subtotal">1.500.000 đ</div>
        <div class="total">1.500.000 đ</div>
      </div>
    </div>
  `,

  // CASE C: Multiple available standing tickets (VIP sold out, CAT 1 available, CAT 2 available)
  CASE_C_MULTIPLE_STANDING: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="vip-standing" data-availability="sold_out">
        <h3 class="ticket-name">VIP Standing</h3>
        <span class="price">4.000.000 đ</span>
        <button type="button" disabled>Hết vé</button>
      </div>
      <div class="ticket-item" data-ticket-id="cat1-standing">
        <h3 class="ticket-name">CAT 1 Standing</h3>
        <span class="price">2.500.000 đ</span>
        <input type="number" class="qty-input" min="1" max="4" value="1" />
        <button type="button">Mua ngay</button>
      </div>
      <div class="ticket-item" data-ticket-id="cat2-standing">
        <h3 class="ticket-name">CAT 2 Standing</h3>
        <span class="price">1.800.000 đ</span>
        <input type="number" class="qty-input" min="1" max="4" value="1" />
        <button type="button">Mua ngay</button>
      </div>
      <div class="booking-summary">
        <div class="summary-item">
          <span class="ticket-name">CAT 1 Standing</span>
          <span class="qty">2</span>
          <span class="price">2.500.000 đ</span>
        </div>
        <div class="subtotal">5.000.000 đ</div>
        <div class="total">5.000.000 đ</div>
      </div>
    </div>
  `,

  // CASE D: Seated ticket with area selection ("Chọn khu vực")
  CASE_D_SEATED_WITH_AREA_SELECTION: `
    <div id="booking-container">
      <h2>Chọn khu vực</h2>
      <div class="ticket-item" data-ticket-id="ngoai-o-1">
        <h3 class="ticket-name">Ngoại Ô 1</h3>
        <span class="price">3.500.000 đ</span>
        <span class="mode-badge">Seated</span>
        <button type="button">Chọn ghế</button>
      </div>
      <div class="area-selection-map">
        <div class="area-item" data-zone-id="zone-hoa-tam-1" data-status="sold_out" disabled>
          <span class="area-name">HỎA TÂM 1</span>
          <span class="price">3.000.000 đ</span>
          <span class="badge">Hết vé</span>
        </div>
        <div class="area-item" data-zone-id="zone-ngoai-o-1" data-status="available">
          <span class="area-name">NGOẠI Ô 1</span>
          <span class="price">3.500.000 đ</span>
          <span class="badge">Còn 84 chỗ</span>
        </div>
        <div class="area-item" data-zone-id="zone-chien-tuong-1" data-status="available">
          <span class="area-name">CHIẾN TƯỚNG 1</span>
          <span class="price">2.800.000 đ</span>
          <span class="badge">Còn 50 chỗ</span>
        </div>
      </div>
      <div class="seat-map" id="seat-map">
        <button class="seat" data-seat-id="s-a12" data-row="A" data-seat-number="12" data-area="zone-ngoai-o-1" data-status="available">A12</button>
        <button class="seat" data-seat-id="s-a13" data-row="A" data-seat-number="13" data-area="zone-ngoai-o-1" data-status="available">A13</button>
      </div>
      <div class="booking-summary">
        <div class="summary-item">
          <span class="ticket-name">Ngoại Ô 1</span>
          <span class="qty">2</span>
          <span class="price">3.500.000 đ</span>
          <span class="seats">A12, A13</span>
        </div>
        <div class="subtotal">7.000.000 đ</div>
        <div class="total">7.000.000 đ</div>
      </div>
    </div>
  `,

  // CASE E: Seated ticket with seat map
  CASE_E_SEATED_WITH_SEAT_MAP: `
    <div id="booking-page">
      <div class="ticket-item" data-ticket-id="seated-vip">
        <h3 class="ticket-name">VIP Seated</h3>
        <span class="price">4.000.000 đ</span>
        <button type="button">Chọn ghế</button>
      </div>
      <div class="seat-map">
        <div class="seat-grid">
          <button class="seat available" data-seat-id="vip-a1" data-row="A" data-seat-number="1">A01</button>
          <button class="seat available" data-seat-id="vip-a2" data-row="A" data-seat-number="2">A02</button>
        </div>
      </div>
      <div class="booking-summary">
        <div class="summary-item">
          <span class="ticket-name">VIP Seated</span>
          <span class="qty">2</span>
          <span class="price">4.000.000 đ</span>
          <span class="seats">A01, A02</span>
        </div>
        <div class="subtotal">8.000.000 đ</div>
        <div class="total">8.000.000 đ</div>
      </div>
    </div>
  `,

  // CASE F: Two adjacent seats available (A01 occupied, A02 available, A03 available, A05 available)
  CASE_F_TWO_ADJACENT_SEATS: `
    <div class="seat-map">
      <button class="seat occupied" data-seat-id="s-01" data-row="A" data-seat-number="1" data-status="occupied">A01</button>
      <button class="seat available" data-seat-id="s-02" data-row="A" data-seat-number="2" data-status="available">A02</button>
      <button class="seat available" data-seat-id="s-03" data-row="A" data-seat-number="3" data-status="available">A03</button>
      <button class="seat available" data-seat-id="s-05" data-row="A" data-seat-number="5" data-status="available">A05</button>
      <button class="seat occupied" data-seat-id="s-06" data-row="A" data-seat-number="6" data-status="occupied">A06</button>
    </div>
  `,

  // CASE G: Only non-adjacent seats available (A01 available, A02 occupied, A03 occupied, A04 available)
  CASE_G_ONLY_NON_ADJACENT_SEATS: `
    <div class="seat-map">
      <button class="seat available" data-seat-id="na-01" data-row="A" data-seat-number="1" data-status="available">A01</button>
      <button class="seat occupied" data-seat-id="na-02" data-row="A" data-seat-number="2" data-status="occupied">A02</button>
      <button class="seat occupied" data-seat-id="na-03" data-row="A" data-seat-number="3" data-status="occupied">A03</button>
      <button class="seat available" data-seat-id="na-04" data-row="A" data-seat-number="4" data-status="available">A04</button>
    </div>
  `,

  // CASE H: Selected ticket becomes unavailable
  CASE_H_STALE_TICKET_BEFORE: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="flash-vip">
        <h3 class="ticket-name">Flash VIP</h3>
        <span class="price">3.000.000 đ</span>
        <button type="button">Mua ngay</button>
      </div>
      <div class="ticket-item" data-ticket-id="regular-cat1">
        <h3 class="ticket-name">Regular CAT 1</h3>
        <span class="price">2.000.000 đ</span>
        <button type="button">Mua ngay</button>
      </div>
    </div>
  `,
  CASE_H_STALE_TICKET_AFTER: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="flash-vip" data-availability="sold_out">
        <h3 class="ticket-name">Flash VIP</h3>
        <span class="price">3.000.000 đ</span>
        <button type="button" disabled>Hết vé</button>
      </div>
      <div class="ticket-item" data-ticket-id="regular-cat1">
        <h3 class="ticket-name">Regular CAT 1</h3>
        <span class="price">2.000.000 đ</span>
        <button type="button">Mua ngay</button>
      </div>
    </div>
  `,

  // CASE I: Question form with required fields
  CASE_I_QUESTION_FORM: `
    <div id="form-container">
      <form class="questionnaire-form" id="question-form">
        <div class="form-group">
          <label for="f-fullname">Họ và tên *</label>
          <input type="text" id="f-fullname" name="fullName" required />
        </div>
        <div class="form-group">
          <label for="f-phone">Số điện thoại *</label>
          <input type="tel" id="f-phone" name="phone" required />
        </div>
        <div class="form-group">
          <label for="f-email">Email *</label>
          <input type="email" id="f-email" name="email" required />
        </div>
      </form>
    </div>
  `,

  // CASE J: Consent required checkbox
  CASE_J_CONSENT_FORM: `
    <div id="form-container">
      <form class="attendee-form" id="attendee-form">
        <div class="form-group">
          <label for="user-name">Họ tên *</label>
          <input type="text" id="user-name" name="name" required />
        </div>
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" id="terms-consent" name="agreeTerms" required />
            Tôi đã đọc và đồng ý với điều khoản & điều kiện của sự kiện
          </label>
        </div>
      </form>
    </div>
  `,

  // CASE K: Payment gate
  CASE_K_PAYMENT_GATE: `
    <div class="checkout-container" id="payment-methods">
      <h2>Phương thức thanh toán</h2>
      <p>Vui lòng chọn cổng thanh toán để tiếp tục (VNPAY, Thẻ Quốc Tế, MoMo)</p>
      <div class="payment-options">
        <div class="payment-option">VNPAY QR</div>
        <div class="payment-option">Thẻ Tín Dụng / Ghi Nợ (Visa, Mastercard)</div>
      </div>
    </div>
  `,

  // CASE L: Unsupported page structure
  CASE_L_UNSUPPORTED_STRUCTURE: `
    <div class="mystery-wrapper">
      <div class="unknown-box">
        <p>Hệ thống đang bảo trì hoặc giao diện không được hỗ trợ.</p>
      </div>
    </div>
  `,
};
