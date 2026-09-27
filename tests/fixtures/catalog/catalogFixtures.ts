/**
 * Deterministic Test Fixtures for Ticketbox Event Catalog Discovery.
 * Contains 16 deterministic fixtures covering all structural and availability scenarios.
 */

export const CATALOG_FIXTURES = {
  // 1. Event page with multiple standing tickets
  MULTIPLE_STANDING: `
    <div id="event-detail">
      <h1>Concert Anh Trai Vượt Ngàn Chông Gai 2026</h1>
      <section id="ticket-info">
        <h2>Thông tin vé</h2>
        <div class="ticket-item" data-ticket-id="stand-1">
          <h3 class="ticket-name">Hoả Tâm 1 (Standing)</h3>
          <span class="price">3.000.000 đ</span>
          <span class="status">Đang mở bán</span>
          <button type="button">Mua ngay</button>
        </div>
        <div class="ticket-item" data-ticket-id="stand-2">
          <h3 class="ticket-name">Hoả Tâm 2 (Standing)</h3>
          <span class="price">2.500.000 đ</span>
          <span class="status">Còn vé</span>
          <button type="button">Mua ngay</button>
        </div>
      </section>
    </div>
  `,

  // 2. Event page with seated tickets
  SEATED_TICKETS: `
    <div id="event-detail">
      <h1>Giao Hưởng Mùa Xuân</h1>
      <section id="ticket-info">
        <div class="ticket-row" data-ticket-id="seat-vip">
          <h4 class="name">Khán Đài VIP (Seated)</h4>
          <div class="ticket-price">4.500.000 VND</div>
          <button type="button">Chọn ghế</button>
        </div>
        <div class="ticket-row" data-ticket-id="seat-std">
          <h4 class="name">Khán Đài A (Ngồi)</h4>
          <div class="ticket-price">2.000.000 VND</div>
          <button type="button">Chọn ghế</button>
        </div>
      </section>
    </div>
  `,

  // 3. Mixed standing/seated catalog
  MIXED_STANDING_SEATED: `
    <section id="ticket-info">
      <div class="ticket-card" data-ticket-id="t-1">
        <div class="title">GA Standing VIP</div>
        <span class="price">3.200.000 đ</span>
        <button type="button">Mua vé</button>
      </div>
      <div class="ticket-card" data-ticket-id="t-2">
        <div class="title">Zone B (Seated)</div>
        <span class="price">2.800.000 đ</span>
        <button type="button">Mua vé</button>
      </div>
    </section>
  `,

  // 4. Available ticket
  AVAILABLE_TICKET: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="avail-1">
        <h3 class="ticket-name">Vé Tiêu Chuẩn</h3>
        <span class="price">1.500.000 đ</span>
        <span class="badge">Đang mở bán</span>
        <button type="button">Chọn vé</button>
      </div>
    </div>
  `,

  // 5. Sold-out ticket
  SOLDOUT_TICKET: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="sold-1" data-availability="sold_out">
        <h3 class="ticket-name">Vé Early Bird</h3>
        <span class="price">800.000 đ</span>
        <span class="badge-soldout">Hết vé (Sold out)</span>
        <button type="button" disabled>Hết vé</button>
      </div>
    </div>
  `,

  // 6. Unknown availability (insufficient evidence)
  UNKNOWN_AVAILABILITY: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="unk-1">
        <h3 class="ticket-name">Vé Bí Ẩn</h3>
        <span class="price">1.000.000 đ</span>
        <!-- No button, no status text, no availability attribute -->
      </div>
    </div>
  `,

  // 7. Disabled ticket
  DISABLED_TICKET: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="dis-1" aria-disabled="true">
        <h3 class="ticket-name">Vé Tạm Khóa</h3>
        <span class="price">1.200.000 đ</span>
        <button type="button" disabled aria-disabled="true">Không khả dụng</button>
      </div>
    </div>
  `,

  // 8. Quantity input with min/max
  QUANTITY_WITH_MIN_MAX: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="qty-1">
        <h3 class="ticket-name">Vé Gia Đình</h3>
        <span class="price">5.000.000 đ</span>
        <input type="number" class="qty-input" min="2" max="6" value="2" />
        <button type="button">Tiếp tục</button>
      </div>
    </div>
  `,

  // 9. Quantity control without explicit max
  QUANTITY_WITHOUT_EXPLICIT_MAX: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="qty-no-max">
        <h3 class="ticket-name">Vé Linh Hoạt</h3>
        <span class="price">500.000 đ</span>
        <input type="number" class="qty-input" value="1" />
        <button type="button">Mua vé</button>
      </div>
    </div>
  `,

  // 10. Multiple showings
  MULTIPLE_SHOWINGS: `
    <div id="event-detail">
      <h1>Vở Kịch Đêm Đông</h1>
      <div class="session-tab" data-showing-id="show-day-1">
        <h4 class="showing-name">Đêm diễn 1</h4>
        <time class="showing-date">2026-10-15</time>
        <div class="ticket-item" data-ticket-id="d1-t1">
          <h3 class="ticket-name">Vé Đêm 1</h3>
          <span class="price">600.000 đ</span>
          <button type="button">Mua ngay</button>
        </div>
      </div>
      <div class="session-tab" data-showing-id="show-day-2">
        <h4 class="showing-name">Đêm diễn 2</h4>
        <time class="showing-date">2026-10-16</time>
        <div class="ticket-item" data-ticket-id="d2-t1">
          <h3 class="ticket-name">Vé Đêm 2</h3>
          <span class="price">700.000 đ</span>
          <button type="button">Mua ngay</button>
        </div>
      </div>
    </div>
  `,

  // 11. Ticket name containing parentheses
  NAME_WITH_PARENTHESES: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="paren-1">
        <h3 class="ticket-name">Ngoại Ô 1 (Seated - Hàng Đầu) (VIP Special)</h3>
        <span class="price">3.500.000 đ</span>
        <button type="button">Mua ngay</button>
      </div>
    </div>
  `,

  // 12. VND price parsing variations
  VND_PRICE_VARIATIONS: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="v-1">
        <h3 class="ticket-name">Vé Dấu Chấm</h3>
        <span class="price">3.500.000 đ</span>
        <button type="button">Mua</button>
      </div>
      <div class="ticket-item" data-ticket-id="v-2">
        <h3 class="ticket-name">Vé Dấu Phẩy</h3>
        <span class="price">2,500,000 VND</span>
        <button type="button">Mua</button>
      </div>
      <div class="ticket-item" data-ticket-id="v-3">
        <h3 class="ticket-name">Vé Liền Đ</h3>
        <span class="price">1.200.000đ</span>
        <button type="button">Mua</button>
      </div>
      <div class="ticket-item" data-ticket-id="v-4">
        <h3 class="ticket-name">Vé Số Thuần</h3>
        <span class="price">900000 VNĐ</span>
        <button type="button">Mua</button>
      </div>
    </div>
  `,

  // 13. Duplicate visible labels
  DUPLICATE_VISIBLE_LABELS: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="dup-1">
        <h3 class="ticket-name">Standard Zone</h3>
        <span class="price">1.000.000 đ</span>
        <button type="button">Mua</button>
      </div>
      <div class="ticket-item" data-ticket-id="dup-2">
        <h3 class="ticket-name">Standard Zone</h3>
        <span class="price">1.000.000 đ</span>
        <button type="button">Mua</button>
      </div>
    </div>
  `,

  // 14. Missing ticket price
  MISSING_TICKET_PRICE: `
    <div id="ticket-info">
      <div class="ticket-item" data-ticket-id="no-price">
        <h3 class="ticket-name">Vé Mời Đặc Biệt</h3>
        <!-- Price element omitted -->
        <button type="button">Đăng ký</button>
      </div>
    </div>
  `,

  // 15. Malformed ticket candidate
  MALFORMED_CANDIDATE: `
    <div id="ticket-info">
      <div class="ticket-item">
        <!-- completely empty item without name, price or button -->
      </div>
      <div class="ticket-item" data-ticket-id="valid-after-malformed">
        <h3 class="ticket-name">Vé Hợp Lệ</h3>
        <span class="price">500.000 đ</span>
        <button type="button">Mua</button>
      </div>
    </div>
  `,

  // 16. Empty catalog
  EMPTY_CATALOG: `
    <div id="event-detail">
      <h1>Sự Kiện Chưa Cập Nhật Vé</h1>
      <section id="ticket-info">
        <p>Hiện chưa có thông tin vé cho sự kiện này.</p>
      </section>
    </div>
  `,
};
