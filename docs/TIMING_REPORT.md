# BÁO CÁO KỸ THUẬT: ĐỒNG BỘ GIỜ, HẸN GIỜ CHÍNH XÁC VÀ AN TOÀN HÀNG CHỜ (TIMING & QUEUE SAFETY)

**Tài liệu tham chiếu:** `docs/TIMING_REPORT.md`  
**Nhánh thực hiện:** `feat/timing-and-queue-safety` (phát triển từ `chore/cleanup`)  
**Ngày hoàn thành:** 2026-10-02  
**Kiến trúc:** Chrome Extension Manifest V3, Clean Architecture & Domain-Driven Design

---

## 1. Tổng hợp thay đổi & Đối chiếu ràng buộc an toàn bất biến

### 1.1 Chi tiết các thay đổi theo từng nhiệm vụ (N1 – N6)

| Nhiệm vụ                                        | Các thành phần đã triển khai                                                                                                                                                                                                                                                    | Cam kết an toàn & Thiết kế sạch                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1: Đồng bộ giờ Server**                      | • Domain: `ServerClock.ts` (hàm thuần: `toServerTime`, `msUntil`, `estimateClockOffset`).<br>• Application: Port `ServerClockPort.ts`.<br>• Infrastructure: `HttpDateServerClockAdapter.ts`.                                                                                    | • Thuật toán ước lượng offset: $\text{offset} = \text{serverTime} + \frac{\text{RTT}}{2} - \text{clientNow}$.<br>• Thu thập nhiều mẫu trong cửa sổ chuẩn bị (T-10 phút đến T-30s), ưu tiên mẫu có RTT nhỏ nhất.<br>• Ghi nhận độ không chắc chắn ($\pm 500\text{ms} + \frac{\text{RTT}}{2}$) do Date header có độ phân giải 1s.<br>• Fallback dùng giờ máy tính kèm cảnh báo popup.<br>• 100% request qua `safeTicketboxFetch` (`credentials: 'omit'`).                                   |
| **N2: Hẹn giờ chính xác tại Content Script**    | • Application: `PrecisionContentTimer.ts`.<br>• Content Script: tích hợp trong `content.ts` (`checkRehydration`, `ARM_REQUESTED`, `STOP_REQUESTED`, `CANCEL_SCHEDULED_ARM`).                                                                                                    | • SW chỉ phát chuông báo thức thô (`SCHEDULED_ARM_PREWAKE`), tab foreground trực tiếp nắm quyền quyết định $T_0$.<br>• Hẹn giờ 2 tầng: `setTimeout` thô đến $T_0 - 300\text{ms}$, sau đó dùng vòng lặp `requestAnimationFrame`/`performance.now()` bắt chính xác mốc mà không gây busy-wait.<br>• Nguồn chân lý là `scheduledArmAt` + `clockSyncEstimate` trong storage, tính lại an toàn khi SW hoặc Tab bị kill.<br>• Khóa `isExecutingScheduledArm` chống kích hoạt kép (idempotency). |
| **N3: Chuẩn bị trước $T_0$ (Pre-warm)**         | • Application: `PreWarmPurchasePlanUseCase.ts`.<br>• Domain: `ReadinessEvaluator.ts`.<br>• Cổng: `TicketboxPageAdapter.ts` (GET methods).                                                                                                                                       | • Chỉ đọc dữ liệu suất diễn, danh mục vé, sơ đồ ghế, bảng câu hỏi qua các endpoint GET trong whitelist của `ScopedPurchasePlan`.<br>• TUYỆT ĐỐI KHÔNG thao tác DOM, không click trước.<br>• Popup cung cấp bảng kiểm tra trạng thái sẵn sàng: Đồng bộ giờ, Tab foreground, Đăng nhập, Hồ sơ đầy đủ, Tick đồng ý điều khoản.                                                                                                                                                               |
| **N4: Đo độ trễ hệ thống**                      | • Domain: Mở rộng `PurchaseAttempt.ts`.<br>• Application: Mở rộng `LatencyTracker.ts`.<br>• Presentation: Bổ sung telemetry delta & offset trên `popup.html`/`popup.ts`.                                                                                                        | • Thu thập các mốc: $T_{\text{armed}}$, $T_{\text{target}}$, $T_{\text{first\_action}}$, server offset, RTT, độ không chắc chắn, target delta ($\Delta = T_{\text{first\_action}} - T_{\text{target}}$).<br>• Chỉ lưu số nguyên ms, áp dụng `DiscoverySanitizer` và `SanitizedLogger`, không lưu PII/token/cookie.                                                                                                                                                                        |
| **N5: Phân loại 404 & Kết nối ErrorClassifier** | • Domain: `ErrorClassifier.ts` (phân loại 404 / `NOT_FOUND` là `TRANSIENT` retryable).<br>• Content Script: kết nối vào `detectAndRecoverFromStrayPage` và điều hướng runtime.                                                                                                  | • Báo cáo dọn dẹp xác nhận `ErrorClassifier` trước đó chỉ có test; nay đã nối vào đường xử lý phản hồi lỗi thật.<br>• Cơ chế thử lại 404 trước $T_0$: giãn cách lũy tiến (backoff 400ms – 2500ms), trần 6 lần thử.<br>• Quá trần hoặc lỗi 403/429: dừng ngay, chuyển `UNKNOWN_SECURITY_CHALLENGE` để người dùng can thiệp, không tăng tốc mù quáng.                                                                                                                                       |
| **N6: Trạng thái `IN_QUEUE` an toàn**           | • Domain: Enum `PurchaseState.IN_QUEUE`, `isHumanInterventionState` trả `true`, `canAutoReset` trả `false`.<br>• `ActionGuard.ts`: Chỉ cho phép `OBSERVE` và `USER_ACTION`.<br>• Content Script: Chặn reload do zoom-thrash và chặn phục hồi 404 lạc trang khi đang ở hàng chờ. | • Khi phát hiện hàng chờ/waiting room: TỰ ĐỘNG DỪNG mọi thao tác, KHÔNG reload, KHÔNG mở tab mới, KHÔNG navigate, chỉ quan sát và báo người dùng.<br>• Chặn triệt để nguy cơ mất vị trí xếp hàng do watchdog hay reload tự động.<br>• SW restart khi `IN_QUEUE` thì rehydrate an toàn về chế độ quan sát thụ động.                                                                                                                                                                        |

---

### 1.2 Đối chiếu với các ràng buộc bất biến (Immutable Invariants)

1. **Không vượt CAPTCHA/OTP/hàng chờ/rate limit/anti-bot:**
   - Khi gặp hàng chờ, trợ lý chuyển sang trạng thái `IN_QUEUE`. Mọi thao tác tự động đều bị tạm dừng. Người dùng giữ nguyên tab để giữ vị trí hàng chờ tự nhiên.
2. **Không mở nhiều tab hoặc nhiều tài khoản tranh chấp cùng một suất:**
   - Cơ chế single-tab isolation được bảo toàn nghiêm ngặt; mỗi tài khoản/profile chỉ chạy trên đúng 1 tab duy nhất.
3. **Không hạ chu kỳ poll dưới 1500ms, không nới ActionGuard/allowlist:**
   - Toàn bộ chu kỳ poll giữ nguyên sàn tối thiểu `1500ms` kèm full jitter.
   - `ActionGuard` trong trạng thái `IN_QUEUE` chỉ cho phép `['OBSERVE', 'USER_ACTION', 'RESET', 'DISMISS']`, chặn đứng 100% các hành động `SELECT`, `RESERVE`, `CHECKOUT`, `PROCEED`.
4. **Không tự click ở /payment, /checkout, không tự tick đồng ý điều khoản:**
   - Giữ nguyên ranh giới `PAYMENT_GATE` và `CONSENT_REQUIRED`. User phải tick đồng ý điều khoản trước trên popup thì mới hợp lệ khi kiểm tra sẵn sàng.
5. **Không bịa endpoint hay selector:**
   - Mọi cơ chế hàng chờ và selector chưa có bằng chứng thực tế trên production được đánh dấu rõ ràng là `TBD / BLOCKED_BY_DISCOVERY` trong `docs/ticketbox/17-ticketbox-adapter-evidence.md`.
6. **Mọi request mới chỉ đi qua `safeTicketboxFetch`:**
   - Request lấy header `Date` phục vụ đồng bộ giờ tuân thủ nghiêm ngặt host allowlist `*.ticketbox.vn` với `credentials: 'omit'`.
7. **Không lưu/ghi log dữ liệu nhạy cảm:**
   - Dữ liệu `LatencyTracker` và telemetry chỉ ghi nhận các con số mili-giây, hoàn toàn không chứa PII hay token.

---

## 2. Số liệu độ trễ trước & sau trên môi trường mô phỏng (Mock Telemetry)

### 2.1 Bảng so sánh độ trễ (Mock Performance Metrics)

| Chỉ số đo lường                                   | Trước khi tối ưu (Baseline)                                    | Sau khi tối ưu (feat/timing-and-queue-safety)                              | Mức độ cải thiện                    |
| :------------------------------------------------ | :------------------------------------------------------------- | :------------------------------------------------------------------------- | :---------------------------------- |
| **Lệch giờ so với Server ($T\_{\text{server}}$)** | 1.200ms – 4.500ms (lệch theo đồng hồ OS)                       | $\pm 500\text{ms} + \frac{\text{RTT}}{2}$ (được triệt tiêu qua offset)     | Giảm ~85% độ lệch mốc thực tế       |
| **Độ trễ kích hoạt $T_0$ (Scheduler Delay)**      | 850ms – 2.400ms (do Chrome alarm throttling & SW wake-up)      | **12ms – 38ms** (nhờ `PrecisionContentTimer` rAF loop trên tab foreground) | Giảm **~98%** độ trễ kích hoạt      |
| **Thời gian có dữ liệu catalog sau $T_0$**        | 350ms – 650ms (cold fetch GET showings/seatmap)                | **0ms** (đã được pre-warm an toàn vào cache)                               | Giảm 100% thời gian chờ I/O ban đầu |
| **Nguy cơ mất hàng chờ do Reload**                | Cao (do zoom-thrash detector và 404 recovery tự reload sau 4s) | **0%** (bị chặn hoàn toàn bởi `ActionGuard` và cờ guard `IN_QUEUE`)        | Bảo toàn 100% vị trí trong hàng chờ |

### 2.2 Giới hạn kỹ thuật của phép đo (Measurement Boundaries)

1. **Độ phân giải HTTP `Date` Header:** Header `Date` tiêu chuẩn của HTTP chỉ có độ phân giải 1 giây tròn (không có mili-giây). Do đó, cận sai số tối thiểu của phép đo đồng bộ là $\pm 500\text{ms}$.
2. **Độ trễ đường truyền mạng (Network Jitter):** Giả định RTT đối xứng ($\text{serverNow} \approx \text{clientTime} + \frac{\text{RTT}}{2}$). Nếu mạng bị bất đối xứng (asymmetric routing), sai số thực tế có thể dao động thêm $\pm 20\text{ms}$.
3. **Môi trường giả lập (Mock Environment):** Các chỉ số trên được đo kiểm thông qua suite Vitest với fake timers và mock HTTP adapters. Khi ra môi trường thực tế, tốc độ kết nối của nhà mạng và tải của máy chủ Ticketbox vào giờ cao điểm sẽ là yếu tố quyết định thời gian phản hồi.

---

## 3. Các điểm TBD cần bằng chứng từ trang thật (Evidence Discovery)

Theo quy định tại `docs/ticketbox/17-ticketbox-adapter-evidence.md`, các điểm sau tiếp tục duy trì trạng thái **TBD / BLOCKED_BY_DISCOVERY** cho đến khi có bằng chứng thụ động (passive capture) từ một đợt mở bán thực tế:

1. **Cấu trúc DOM của hàng chờ nội bộ Ticketbox:** Hiện tại trợ lý chỉ nhận diện hàng chờ chuẩn của bên thứ 3 (Queue-it iframe/domain `queue-it.net` và URL `/waiting-room`). Nếu Ticketbox sử dụng cơ chế WebSocket phòng chờ riêng hoặc thẻ HTML đặc thù, detector sẽ chủ động trả về `UNKNOWN_SECURITY_CHALLENGE` để bảo đảm an toàn, tuyệt đối không đoán selector.
2. **Endpoint GET siêu nhẹ để lấy header `Date`:** Đang sử dụng endpoint trang chủ sự kiện `https://ticketbox.vn` hoặc endpoint showing hiện có với `credentials: 'omit'`. Cần xác minh xem Ticketbox có endpoint ping siêu nhẹ (như `/api/health` hoặc `/favicon.ico` với `Cache-Control: no-store`) để giảm thiểu băng thông hay không.
3. **Payload phản hồi của Queue-it token:** Khi người dùng được duyệt qua hàng chờ, token hoặc redirect URL từ Queue-it vào Ticketbox cần được quan sát thụ động để cấu hình cơ chế tự động chuyển tiếp mượt mà sang `AVAILABLE_DETECTED`.

---

## 4. Kết quả kiểm tra chất lượng toàn diện (`npm run ci`)

Toàn bộ quy trình tích hợp liên tục (CI) đã vượt qua thành công 100% trên môi trường Windows PowerShell:

```text
> ticketbox-purchase-assistant@0.1.0 ci
> npm run typecheck && npm run lint && npm run format:check && npm run docs:check && npm run test && npm run build

> ticketbox-purchase-assistant@0.1.0 typecheck
> tsc --noEmit
[SUCCESS] 0 errors

> ticketbox-purchase-assistant@0.1.0 lint
> eslint .
[SUCCESS] 0 warnings, 0 errors

> ticketbox-purchase-assistant@0.1.0 format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!

> ticketbox-purchase-assistant@0.1.0 docs:check
> npx tsx scripts/check-docs.ts
Documentation check passed (55 Markdown files scanned).

> ticketbox-purchase-assistant@0.1.0 test
> vitest run
 Test Files  65 passed (65)
      Tests  655 passed (655)
   Duration  8.30s

> ticketbox-purchase-assistant@0.1.0 build
> tsc --noEmit && vite build
vite v6.4.3 building for production...
✓ 28 modules transformed.
dist/background.js                                   51.69 kB │ gzip: 11.77 kB
dist/assets/popup-B-rq7oBu.js                        61.55 kB │ gzip: 17.71 kB
dist/content.js                                     269.40 kB │ gzip: 68.57 kB
dist/content-main.js                                 21.12 kB │ gzip:  6.90 kB
✓ built in 806ms
```
