# ADR-005 — Phase 3 Security & Privacy Hardening

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Trong quá trình bảo mật hóa và củng cố quyền riêng tư cho Ticketbox Purchase Assistant (Phase 3), năm điểm yếu trọng yếu đã được xác định:

1. **Kênh truyền thông Isolated World <-> Main World dễ bị giả mạo:** `postMessage` sử dụng `targetOrigin: '*'` và kênh song song `CustomEvent` cho phép bất kỳ script độc hại nào trên trang web lắng nghe hoặc phát thông điệp điều khiển/chọn ghế.
2. **Thiếu xác thực danh tính người gửi (Sender Authentication):** Service Worker và Content Script chưa kiểm tra `sender.id === chrome.runtime.id` và `sender.frameId === 0`, mở đường cho web page injection hoặc iframe bên thứ ba gửi các message đặc quyền (`ARM_REQUESTED`, `STOP_REQUESTED`, `RESET_CONFIG_REQUESTED`). Ngoài ra `FETCH_SHOWING_REQUEST` chưa được bảo vệ bằng Scope Guard.
3. **Nguy cơ XSS trong Popup và CSP lỏng lẻo:** `popup.ts` sử dụng `innerHTML` dạng chuỗi nội suy để render thông tin sự kiện và danh mục vé; `manifest.json` thiếu chỉ thị CSP tường minh cho các extension pages.
4. **Lưu trữ và rò rỉ dữ liệu cá nhân (PII):** Logs hệ thống và state contexts lưu trữ họ tên, email, SĐT, số CCCD và địa chỉ dưới dạng plaintext mà không qua che giấu (redaction). Không có cơ chế hết hạn (24h retention) hoặc xoá PII khi hoàn thành/dừng săn vé.
5. **Tài nguyên bộ nhớ không giới hạn & Rò rỉ thông tin mạng:** Các tập hợp ghế (`selectedSeatIds`, `blacklistedSeatKeys`, `failedSeatmapShowingIds`) tăng trưởng không giới hạn qua các phiên săn vé kéo dài; các request `fetch` không bắt buộc `{ credentials: 'omit' }` và thiếu kiểm tra giới hạn tên miền (`*.ticketbox.vn`).

---

## Decisions

### 1. Kênh truyền thông bảo mật qua Nonce Handshake (P3-1)
- Xoá bỏ hoàn toàn kênh `CustomEvent`.
- Tạo `BridgeProtocol.ts` định nghĩa schema dữ liệu typed có gắn `nonce` mật mã sinh từ `crypto.getRandomValues()`.
- Chuyển `targetOrigin` từ `'*'` sang `window.location.origin` (fallback `*` chỉ khi origin là `null`).
- Trước khi chèn `<script>` `content-main.js`, Content Script ghi nonce vào `data-tb-bridge-nonce` trên `document.documentElement`. `page-bridge.ts` đọc và xóa ngay thuộc tính này khỏi DOM khi khởi động.
- Mọi thông điệp Request và Response giữa hai context đều bắt buộc phải mang đúng `nonce`.

### 2. Xác thực người gửi và Scope Guard cho API Showings (P3-2)
- Trong `ChromeMessageBus`, `service-worker.ts`, và `content.ts`: bắt buộc kiểm tra `sender.id === chrome.runtime.id` và `sender.frameId === 0`.
- Các thông điệp điều khiển đặc quyền (`ARM_REQUESTED`, `STOP_REQUESTED`, `RESET_CONFIG_REQUESTED`, `START_MONITORING`) bị từ chối nếu xuất phát từ tab web (`sender.tabId !== undefined`) hoặc URL ngoài extension.
- Áp dụng Scope Guard cho `FETCH_SHOWING_REQUEST` trong Service Worker: từ chối mọi yêu cầu lấy showing nằm ngoài whitelist `scopedPurchasePlan.targets`.

### 3. Phòng vệ XSS trong Popup UI và CSP Chặt chẽ (P3-3)
- Bổ sung CSP nghiêm ngặt vào `manifest.json`:
  ```json
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
  ```
- Thay thế toàn bộ các thao tác gán `innerHTML` động trong `popup.ts` bằng các DOM API an toàn: `createElement`, `textContent`, `append`, `replaceChildren`.

### 4. Che giấu và Kiểm soát vòng đời Dữ liệu Cá nhân (PII) (P3-4)
- **Redaction trong Logs:** `SanitizedLogger` tự động che giấu các khóa nhạy cảm (`fullName`, `phone`, `email`, `idCard`, `address`, `birthYear`, `gender`) và regex quét chuỗi tìm email, số điện thoại VN (10 chữ số), số CMND/CCCD (9/12 chữ số) thành `[REDACTED]`.
- **Sanitization trong State Storage:** Mọi phương thức lưu State (`saveCurrentState`, `saveJourneyState`, `saveLifecycleState`, `savePersistentState`) lọc sạch PII trước khi ghi vào `chrome.storage.local`.
- **Ranh giới Đồng thuận (Consent):** Thông tin CCCD (`idCard`) và Địa chỉ (`address`) bắt buộc phải có checkbox đồng thuận `allowSensitivePii` mới được lưu.
- **Vòng đời 24h & Purge:** Tự động xoá `userProfile` sau 24 giờ lưu trữ; tự động xoá sạch `userProfile` khi hành trình kết thúc (`CONFIRMED`, `STOP_REQUESTED`, `RESET_CONFIG_REQUESTED`); cung cấp nút "Xoá dữ liệu cá nhân khỏi bộ nhớ" trong Popup.

### 5. Giới hạn Tài nguyên & An toàn Mạng (P3-5)
- Giới hạn các tập hợp ghế `selectedSeatIds` và `blacklistedSeatKeys` tối đa `MAX_SEAT_SET_SIZE = 500` phần tử với cơ chế loại bỏ cũ nhất trước (FIFO eviction).
- Tạo module `NetworkSafety.ts` với hàm `safeTicketboxFetch`:
  - Kiểm tra nghiêm ngặt `isAllowedTicketboxHost(url)`: chỉ chấp nhận domain `ticketbox.vn` hoặc subdomain `*.ticketbox.vn`.
  - Ép buộc `{ credentials: 'omit' }` trên toàn bộ các yêu cầu HTTP để ngăn chặn rò rỉ cookie phiên làm việc.
- Cấu hình `host_permissions` trong `manifest.json` chỉ giới hạn cho `*://*.ticketbox.vn/*`.

---

## Consequences

### Positive
- Ngăn chặn hoàn toàn việc rò rỉ token, cookie hoặc thông tin nhạy cảm của người dùng sang các trang web hoặc extension khác.
- Ngăn ngừa tấn công XSS và injection thông qua kênh truyền thông `postMessage` hoặc DOM popup.
- Đảm bảo tuân thủ các quy định về bảo vệ dữ liệu cá nhân (PII) theo nguyên tắc Zero Credential Persistence.
- Bảo vệ tài nguyên bộ nhớ của trình duyệt không bị rò rỉ (memory leak) trong các phiên săn vé dài hàng giờ.

### Negative
- Người dùng cần phải tick chọn lại checkbox đồng thuận lưu thông tin nhạy cảm (CCCD/địa chỉ) nếu muốn hệ thống tự động điền các trường này.
- Khi săn vé thành công hoặc nhấn Dừng, thông tin người dùng được dọn dẹp để đảm bảo an toàn, yêu cầu người dùng nhập lại cho phiên săn vé tiếp theo nếu quá thời hạn 24 giờ.
