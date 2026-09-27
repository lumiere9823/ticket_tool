import { describe, it, expect } from 'vitest';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { TicketboxCatalogParser } from '../../../src/infrastructure/ticketbox/parsing/TicketboxCatalogParser';

const LIVE_TICKETBOX_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>TỪ ĐÂY TỪ NAY - PHUCXUOI | Ticketbox</title>
  <meta property="og:title" content="TỪ ĐÂY TỪ NAY - PHUCXUOI">
</head>
<body>
  <div id="banner">
    <img alt="TỪ ĐÂY TỪ NAY - PHUCXUOI" src="https://images.tkbcdn.com/banner.jpg" />
  </div>
  <div id="ticket-info">
    <div id="headers">
      <div class="header-title">Thông tin vé</div>
    </div>
    <div class="parent-panels">
      <div class="ant-collapse">
        <div class="ant-collapse-item">
          <div class="ant-collapse-header">
            <div class="first-row">19:30 - Thứ 7, 04/04/2026</div>
            <div class="second-row">Nhà thi đấu Quân Khu 7 - 202 Hoàng Văn Thụ, Phường 9, Quận Phú Nhuận, TP. Hồ Chí Minh</div>
            <button id="select-showing-btn" type="button" class="ant-btn">Mua vé ngay</button>
          </div>
          <div class="ant-collapse-content">
            <div class="content-row">
              <div class="title-tickettype">Vé VIP Đứng</div>
              <div class="tkt-price"><span class="price-value">1.100.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge disabled">Hết vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">GDC</div>
              <div class="tkt-price"><span class="price-value">900.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge disabled">Hết vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">TIÊU BIỂU</div>
              <div class="tkt-price"><span class="price-value">800.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge disabled">Hết vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">STAND</div>
              <div class="tkt-price"><span class="price-value">750.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge disabled">Hết vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">CAT 1</div>
              <div class="tkt-price"><span class="price-value">700.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge">Còn vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">CAT 2</div>
              <div class="tkt-price"><span class="price-value">500.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge">Còn vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">VÉ COUPLE</div>
              <div class="tkt-price"><span class="price-value">1.300.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge">Còn vé</div>
            </div>
            <div class="content-row">
              <div class="title-tickettype">Vé Đơn</div>
              <div class="tkt-price"><span class="price-value">400.000&nbsp;đ</span></div>
              <div id="status-badge" class="badge">Còn vé</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

describe('TicketboxCatalogParser with Live Production DOM', () => {
  it('should parse live event catalog from Ticketbox tudaytunay page', () => {
    const root = parseHtmlToDOMElementLike(LIVE_TICKETBOX_HTML);
    const catalog = TicketboxCatalogParser.parseCatalog(
      root,
      'https://ticketbox.vn/tudaytunay-phuciuoi-26578?utm_medium=trending-events&utm_source=tkb-homepage'
    );

    expect(catalog.eventId).toBe('26578');
    expect(catalog.eventTitle).toBe('TỪ ĐÂY TỪ NAY - PHUCXUOI');
    expect(catalog.showings).toHaveLength(1);

    const showing = catalog.showings[0]!;
    expect(showing.date).toBe('19:30 - Thứ 7, 04/04/2026');
    expect(showing.name).toContain('Nhà thi đấu Quân Khu 7');
    expect(showing.ticketTypes).toHaveLength(8);

    // Verify sold out ticket
    const vip = showing.ticketTypes.find((t) => t.name === 'Vé VIP Đứng');
    expect(vip).toBeDefined();
    expect(vip?.price.amount).toBe(1100000);
    expect(vip?.price.currency).toBe('VND');
    expect(vip?.mode).toBe('STANDING');
    expect(vip?.availability).toBe('SOLD_OUT');
    expect(vip?.selectable).toBe(false);

    // Verify available ticket
    const cat1 = showing.ticketTypes.find((t) => t.name === 'CAT 1');
    expect(cat1).toBeDefined();
    expect(cat1?.price.amount).toBe(700000);
    expect(cat1?.price.currency).toBe('VND');
    expect(cat1?.availability).toBe('AVAILABLE');
    expect(cat1?.selectable).toBe(true);

    const cat2 = showing.ticketTypes.find((t) => t.name === 'CAT 2');
    expect(cat2).toBeDefined();
    expect(cat2?.price.amount).toBe(500000);
    expect(cat2?.availability).toBe('AVAILABLE');
    expect(cat2?.selectable).toBe(true);
  });
});
