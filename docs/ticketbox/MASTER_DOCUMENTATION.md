# TỔNG HỢP TOÀN DIỆN HỆ THỐNG TICKETBOX PURCHASE ASSISTANT (MASTER DOCUMENTATION)

**Tài liệu tham chiếu hợp nhất:** `docs/ticketbox/MASTER_DOCUMENTATION.md`  
**Phiên bản hệ thống:** v0.1.0 (Production Architecture Baseline)  
**Mục tiêu:** Hợp nhất, tinh gọn và hệ thống hóa toàn bộ kiến thức kỹ thuật, kiến trúc, quy tắc miền, bảo mật và vận hành từ hơn 35 tài liệu kỹ thuật rải rác trong `docs/ticketbox/` thành một nguồn tham chiếu thống nhất, dễ tra cứu và toàn diện nhất.

---

## 📑 MỤC LỤC TỔNG HỢP

1. [Chương 1: Tổng quan dự án & Các ràng buộc bất biến](#chương-1-tổng-quan-dự-án--các-ràng-buộc-bất-biến)
2. [Chương 2: Kiến trúc hệ thống Clean Architecture & MV3 Topology](#chương-2-kiến-trúc-hệ-thống-clean-architecture--mv3-topology)
3. [Chương 3: Cỗ máy trạng thái (Domain State Machine) & ActionGuard](#chương-3-cỗ-máy-trạng-thái-domain-state-machine--actionguard)
4. [Chương 4: Quy trình đặt vé (Booking Journey) & Konva Canvas Bridge](#chương-4-quy-trình-đặt-vé-booking-journey--konva-canvas-bridge)
5. [Chương 5: Đồng bộ giờ, hẹn giờ chính xác & An toàn hàng chờ (IN_QUEUE)](#chương-5-đồng-bộ-giờ-hẹn-giờ-chính-xác--an-toàn-hàng-chờ-in_queue)
6. [Chương 6: Bảo mật, Cô lập đa tài khoản & Ma trận phục hồi lỗi](#chương-6-bảo-mật-cô-lập-đa-tài-khoản--ma-trận-phục-hồi-lỗi)
7. [Chương 7: Ma trận tra cứu & Chỉ mục toàn bộ tài liệu chi tiết](#chương-7-ma-trận-tra-cứu--chỉ-mục-toàn-bộ-tài-liệu-chi-tiết)

---

## Chương 1: Tổng quan dự án & Các ràng buộc bất biến

### 1.1 Mục tiêu và Bản chất của Tool

Ticketbox Purchase Assistant là một tiện ích mở rộng Chrome (Manifest V3) hỗ trợ người dùng theo dõi mở bán và thực hiện quy trình mua vé bình thường trên nền tảng Ticketbox một cách nhanh chóng, chính xác và an toàn.

> **Định nghĩa cốt lõi:** Đây là một công cụ hỗ trợ người dùng (Assistant), **hoàn toàn KHÔNG PHẢI bot tự động lách luật hay vượt cơ chế công bằng**. Tool chỉ giảm độ trễ kỹ thuật của chính client mà không can thiệp, không phá vỡ ranh giới bảo mật của Ticketbox.

### 1.2 Bảy nguyên tắc bất biến (Hard Invariants)

1. **Ranh giới đặt chỗ nghiêm ngặt (Reservation Boundary):**
   - $\text{SELECTED} \neq \text{RESERVED}$ và $\text{RESERVING} \neq \text{HELD}$.
   - Trạng thái `HELD` bắt buộc phải có bằng chứng xác nhận chính thức từ server (`reservationId` / `holdId`). Tuyệt đối không suy diễn từ kết quả click DOM hay callback client.
2. **Kích hoạt có chủ đích (Explicit Arming):**
   - Trợ lý không bao giờ tự ý thao tác từ trạng thái `READY`. Người dùng bắt buộc phải bấm nút `ARM` hoặc cấu hình hẹn giờ `scheduledArmAt`.
3. **Giới hạn tự động hóa (Bounded Automation):**
   - Không hạ chu kỳ thăm dò dưới $1500\text{ms}$ (`MIN_POLL_INTERVAL_MS`), bắt buộc kèm full jitter.
   - Trần số lần thử tối đa 8 lần cho journey, mặc định 1000 lần thử và 120 phút theo dõi (`DEFAULT_PERSISTENCE_POLICY`).
4. **Ranh giới thanh toán (Payment & Consent Gate):**
   - Trợ lý tự động dừng lại ở màn hình `/payment`, `/checkout` hoặc khi gặp `CONSENT_REQUIRED`. Người dùng tự chọn phương thức thanh toán, tick điều khoản và nhập OTP/3DS.
5. **Không bao giờ lách cơ chế bảo mật (Zero Evasion):**
   - Gặp CAPTCHA, Turnstile, OTP, Rate Limit (429) hoặc Hàng chờ (Virtual Waiting Room / Queue-it): Trợ lý tự động tạm dừng để người dùng xử lý, tuyệt đối không bypass.
6. **Không lưu trữ thông tin nhạy cảm (Zero Credential Storage):**
   - Không bao giờ lưu mật khẩu, OTP, CVV, raw tokens, cookies vào storage hay log. Thông tin cá nhân (PII) có thời hạn lưu tối đa 24 giờ và tự động hủy sau phiên mua.
7. **Cô lập ngữ cảnh đa tài khoản (Profile Isolation):**
   - Mỗi tài khoản chạy trên một Chrome Profile độc lập. Không tráo đổi cookie hoặc mở nhiều tab tranh chấp cùng một suất vé.

---

## Chương 2: Kiến trúc hệ thống Clean Architecture & MV3 Topology

### 2.1 Cấu trúc phân tầng (Clean Architecture)

Hệ thống được tổ chức phân tầng rõ rệt, tuân thủ nguyên tắc Dependency Rule (tầng trong không phụ thuộc tầng ngoài):

```text
Presentation Layer (src/extension/popup/)
        ↓ phụ thuộc
Application Layer (src/application/use-cases/, ports/, services/)
        ↓ phụ thuộc
Domain Layer (src/domain/states/, entities/, policies/, value-objects/)
        ↑ thực thi cổng (implements ports)
Infrastructure Layer (src/infrastructure/storage/, messaging/, ticketbox/, security/)
```

- **Domain Layer (`src/domain/`):** Mã nguồn TypeScript thuần túy, 100% độc lập với môi trường Chrome API hay DOM, chạy hoàn hảo trong Node.js / Vitest.
- **Application Layer (`src/application/`):** Chứa các Use Case điều phối luồng (`ExecuteBookingJourneyUseCase`, `PreWarmPurchasePlanUseCase`, `ArmAssistantUseCase`).
- **Infrastructure Layer (`src/infrastructure/`):** Chứa các adapter giao tiếp với Chrome Storage (`ChromeStorageRepository`), mạng an toàn (`NetworkSafety`), và phân tích trang (`TicketboxCatalogParser`, `DOMElementLike`).
- **Presentation Layer (`src/extension/`):** Giao diện popup, content script và service worker kết nối với người dùng.

### 2.2 Mô hình MV3 Topology & Phân chia trách nhiệm

- **Service Worker (`src/extension/background/service-worker.ts`):** Quản lý chuông báo thức thô (`chrome.alarms`), quản lý badge extension, heartbeat kiểm tra thời gian sống, và rehydrate trạng thái khi worker bị khởi động lại.
- **Content Script (`src/extension/content/content.ts`):** Chạy trên tab sự kiện Ticketbox. Trực tiếp giữ vòng lặp theo dõi, chạy bộ hẹn giờ chính xác `PrecisionContentTimer`, và kích hoạt use-case hành trình khi điều kiện thỏa mãn.
- **Page Bridge (`src/extension/content/page-bridge.ts` - MAIN World):** Được tiêm vào ngữ cảnh trang web với nonce bảo mật để tương tác trực tiếp với canvas Konva.js mà không làm rò rỉ extension context.

---

## Chương 3: Cỗ máy trạng thái (Domain State Machine) & ActionGuard

### 3.1 Vòng đời trạng thái chuẩn (Canonical State Machine)

Toàn bộ hoạt động của hệ thống được kiểm soát bởi `PurchaseStateMachine`:

```text
[Khởi tạo & Sẵn sàng]
INIT → AUTH_CHECK → EVENT_CHECK → READY → ARMED → MONITORING

[Săn vé & Chọn chỗ]
MONITORING → AVAILABLE_DETECTED → TICKETS_DETECTED → EVALUATING_TICKETS
           → TICKET_SELECTED → BOOKING_MODE_DETECTED
           → SELECTING_QUANTITY → SELECTING_AREA → SELECTING_SEATS → SEATS_SELECTED

[Xác nhận thông tin & Giữ chỗ]
SEATS_SELECTED → BOOKING_SUMMARY_DETECTED → QUESTION_FORM_DETECTED
               → FILLING_ATTENDEE_FORM → FORM_VALIDATED → RESERVING → HELD

[Thanh toán & Hoàn tất]
HELD → CHECKOUT → PAYMENT_GATE (Dừng chờ người dùng) → CONFIRMED

[Trạng thái Can thiệp thủ công (Tự động hóa tạm dừng)]
CAPTCHA_REQUIRED | OTP_REQUIRED | PAYMENT_ACTION_REQUIRED
| SESSION_REAUTH_REQUIRED | UNKNOWN_SECURITY_CHALLENGE | IN_QUEUE
```

### 3.2 ActionGuard: Chính sách kiểm soát hành động nghiêm ngặt

`ActionGuard.ts` là người gác cổng fail-closed cho mọi thao tác. Mỗi trạng thái chỉ cho phép một tập hợp hành động nhất định:

- Trong trạng thái `IN_QUEUE`: Chỉ cho phép `OBSERVE` và `USER_ACTION`.
- Trong trạng thái `CONFIRMED`: Chặn 100% mọi hành động (bất biến sau khi đã thành công).
- Ngăn chặn triệt để thao tác chéo (Cross-context): Kiểm tra khớp hoàn toàn `profileId`, `accountId`, `eventId`, và `workflowId`.

---

## Chương 4: Quy trình đặt vé (Booking Journey) & Konva Canvas Bridge

### 4.1 Thách thức của sơ đồ ghế Konva.js trên Ticketbox

Trên trang `/select-ticket` có sơ đồ chỗ ngồi, Ticketbox không render các ghế thành các thẻ HTML hay SVG DOM node riêng lẻ mà vẽ toàn bộ lên thẻ `<canvas>` bằng thư viện **Konva.js v9.3.11** (`react-konva`). Các content script thông thường ở isolated world không thể click hay đọc được đối tượng ghế trong canvas.

### 4.2 Giải pháp Kiến trúc Page-World Bridge (MAIN World)

Hệ thống giải quyết triệt để thông qua cầu nối Page Bridge:

1. `content.ts` (Isolated World) tiêm `content-main.js` (Main World) kèm theo thuộc tính `data-tb-bridge-nonce` an toàn.
2. Hai bên giao tiếp thông qua giao thức postMessage có xác thực nonce (`BridgeProtocol.ts`).
3. Bridge truy cập trực tiếp vào `window.Konva.stages`, tìm các shape ghế theo tọa độ `(seat.x, seat.y)` từ API và phát sự kiện click/tap Konva chuẩn.
4. Xử lý va chạm ghế (`-1242 seat unavailable`): Khi ghế bị người khác chọn trước, hệ thống tự động đưa ghế vào blacklist, bỏ chọn ở thanh trạng thái và tìm ghế khác liền kề trong cùng phân khu.

---

## Chương 5: Đồng bộ giờ, hẹn giờ chính xác & An toàn hàng chờ (IN_QUEUE)

### 5.1 Đồng bộ thời gian với Server (`ServerClock`)

- **Vấn đề:** Đồng hồ máy tính người dùng thường lệch so với server Ticketbox từ 1 đến 5 giây.
- **Giải pháp:** Sử dụng `ServerClockPort` và `HttpDateServerClockAdapter` đọc header `Date` của response HTTP nhẹ (`credentials: 'omit'`).
- **Thuật toán:** $\text{offset} = \text{serverTime} + \frac{\text{RTT}}{2} - \text{clientNow}$. Chọn mẫu có RTT nhỏ nhất trong cửa sổ T-10 phút đến T-30s và tính biên không chắc chắn ($\pm 500\text{ms} + \frac{\text{RTT}}{2}$).

### 5.2 Bộ hẹn giờ chính xác 2 tầng (`PrecisionContentTimer`)

- **Tầng 1 (Coarse):** Sử dụng `setTimeout` thông thường chạy đến mốc $T_0 - 300\text{ms}$.
- **Tầng 2 (Fine-grained):** Dùng vòng lặp `requestAnimationFrame` kết hợp `performance.now()` trên tab foreground để bắt chính xác thời điểm mili-giây mở bán mà không gây nghẽn CPU.
- Có cơ chế chống kích hoạt kép (`isExecutingScheduledArm`) và tự động tính lại mốc nếu Service Worker hoặc Tab bị khởi động lại.

### 5.3 An toàn hàng chờ (Virtual Waiting Room Safety)

- **Vấn đề:** Khi mở bán show lớn, Ticketbox điều hướng người dùng vào hàng chờ (Queue-it / Waiting Room). Nếu tiện ích tự reload do cơ chế chống zoom-thrash hoặc phục hồi trang 404, **người dùng sẽ mất ngay vị trí xếp hàng**.
- **Giải pháp:** Trạng thái `IN_QUEUE` bảo vệ tuyệt đối:
  - Tự động dừng mọi click và thao tác DOM.
  - Chặn đứng 100% lệnh `window.location.reload()` và `detectAndRecoverFromStrayPage()`.
  - Icon extension hiển thị badge cam `QUEU`, popup nhắc nhở người dùng giữ nguyên trang.
  - Tự động tiếp tục hành trình khi người dùng vượt qua hàng chờ.

---

## Chương 6: Bảo mật, Cô lập đa tài khoản & Ma trận phục hồi lỗi

### 6.1 Cô lập Profile & Vệ sinh dữ liệu (Sanitization)

- Hỗ trợ đa tài khoản theo chuẩn **1 Chrome Profile = 1 Ticketbox Account**.
- `SanitizedLogger`: Tự động che giấu (mask) các trường nhạy cảm như `password`, `token`, `otp`, `cookie`, `phone`, `email` trong log console và bộ nhớ tạm.
- Không bao giờ lưu trữ thẻ tín dụng hay thông tin thanh toán.

### 6.2 Phân loại và phục hồi lỗi (`ErrorClassifier`)

- Lỗi 404 / chưa mở sự kiện trước $T_0$: Phân loại là `TRANSIENT` retryable, thử lại với giãn cách lũy tiến (backoff 400ms – 2500ms), trần tối đa 6 lần.
- Lỗi kéo dài sau $T_0$, hoặc gặp lỗi 403, 429: Chuyển sang `UNKNOWN_SECURITY_CHALLENGE` để người dùng can thiệp thủ công, kiên quyết không gửi request dồn dập làm tăng nguy cơ khóa tài khoản.

---

## Chương 7: Ma trận tra cứu & Chỉ mục toàn bộ tài liệu chi tiết

Dưới đây là bản đồ tra cứu toàn bộ các tài liệu chi tiết trong kho lưu trữ `docs/ticketbox/`:

| Nhóm tài liệu                  | Mã văn bản & Đường dẫn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nội dung chi tiết                                                                                                 |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| **Quy chuẩn & Ranh giới**      | [`00-project-overview.md`](00-project-overview.md)<br>[`01-product-requirements.md`](01-product-requirements.md)<br>[`05-reservation-boundary.md`](05-reservation-boundary.md)<br>[`08-security-and-compliance.md`](08-security-and-compliance.md)<br>[`12-ai-engineering-rules.md`](12-ai-engineering-rules.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Mục tiêu, yêu cầu chức năng, ranh giới pháp lý, an toàn dữ liệu và quy chuẩn kỹ thuật cho AI agent.               |
| **Kiến trúc & Hạ tầng**        | [`07-extension-architecture.md`](07-extension-architecture.md)<br>[`11-technical-design.md`](11-technical-design.md)<br>[`15-architecture-baseline.md`](15-architecture-baseline.md)<br>[`16-technology-stack.md`](16-technology-stack.md)<br>[`06-multi-account-orchestration.md`](06-multi-account-orchestration.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Cấu trúc phân tầng Clean Architecture, topology Manifest V3, ngăn xếp công nghệ và cô lập đa tài khoản.           |
| **Cỗ máy trạng thái**          | [`04-state-machine.md`](04-state-machine.md)<br>[`09-error-and-retry-matrix.md`](09-error-and-retry-matrix.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Đặc tả cỗ máy trạng thái có tính thẩm quyền cao nhất, bảng chuyển đổi trạng thái và chính sách retry.             |
| **Bằng chứng & Quy trình vé**  | [`17-ticketbox-adapter-evidence.md`](17-ticketbox-adapter-evidence.md)<br>[`18-ticket-catalog-discovery.md`](18-ticket-catalog-discovery.md)<br>[`19-booking-journey-gap-report.md`](19-booking-journey-gap-report.md)<br>[`21-detailed-system-and-operation-guide.md`](21-detailed-system-and-operation-guide.md)<br>[`22-scoped-persistent-purchase.md`](22-scoped-persistent-purchase.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Bằng chứng khám phá thụ động (Records E-001 đến E-014), cấu trúc vé, ma trận Scoped Matrix và xử lý ghế Konva.    |
| **Hiệu năng & Độ trễ**         | [`18-performance-audit.md`](18-performance-audit.md)<br>[`19-performance-hotspots.md`](19-performance-hotspots.md)<br>[`20-performance-results.md`](20-performance-results.md)<br>[`21-runtime-latency-map.md`](21-runtime-latency-map.md)<br>[`22-event-to-reservation-audit.md`](22-event-to-reservation-audit.md)<br>[`23-real-runtime-performance-results.md`](23-real-runtime-performance-results.md)<br>[`../TIMING_REPORT.md`](../TIMING_REPORT.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Kiểm toán hiệu năng, phân bổ độ trễ thời gian chạy, benchmark mutation storm và báo cáo đo đạc đồng bộ giờ $T_0$. |
| **Quyết định kiến trúc (ADR)** | [`decisions/ADR-001-extension-first.md`](decisions/ADR-001-extension-first.md)<br>[`decisions/ADR-002-critical-path.md`](decisions/ADR-002-critical-path.md)<br>[`decisions/ADR-003-multi-profile-architecture.md`](decisions/ADR-003-multi-profile-architecture.md)<br>[`decisions/ADR-004-state-machine-single-source-of-truth.md`](decisions/ADR-004-state-machine-single-source-of-truth.md)<br>[`decisions/ADR-005-phase-3-security-and-privacy.md`](decisions/ADR-005-phase-3-security-and-privacy.md)<br>[`decisions/ADR-006-state-machine-invariants-and-audit.md`](decisions/ADR-006-state-machine-invariants-and-audit.md)<br>[`decisions/ADR-007-booking-journey-and-form-autofill-reliability.md`](decisions/ADR-007-booking-journey-and-form-autofill-reliability.md)<br>[`decisions/ADR-008-authoritative-service-worker-state.md`](decisions/ADR-008-authoritative-service-worker-state.md)<br>[`decisions/ADR-009-timing-synchronization-and-queue-safety.md`](decisions/ADR-009-timing-synchronization-and-queue-safety.md) | Toàn bộ 9 quyết định kiến trúc đã được phê duyệt và ghi nhận trong lịch sử phát triển.                            |
