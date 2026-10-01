# ADR-004 — State Machine Single Source of Truth & Storage Isolation

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Trong kiến trúc Chrome Extension MV3:

1. **Content Script** chạy trong ngữ cảnh DOM của trang Ticketbox và tương tác trực tiếp với quá trình chọn vé, chọn ghế, xử lý question form và ranh giới thanh toán.
2. **Background Service Worker** là một tiến trình ngắn hạn (transient), có thể bị trình duyệt ngắt bất kỳ lúc nào để tiết kiệm tài nguyên.
3. Trước đây, cả Content Script và Service Worker đều duy trì một phiên bản `PurchaseStateMachine` độc lập và cùng ghi đè lên storage key `ticketbox_assistant_last_state`.
4. Service Worker không xử lý thông điệp `STATE_CHANGED` từ Content Script, dẫn đến việc badge extension (`BUY`, `DONE`, `CAPT`) không bao giờ được cập nhật trong suốt hành trình đặt vé.
5. Mỗi khi reload trang hoặc chuyển hướng URL, Content Script tự động tạo máy trạng thái mới ở `MONITORING`, làm mất trạng thái thực tế của người dùng (ví dụ `HELD`, `PAYMENT_GATE`, `HUMAN_INTERVENTION_REQUIRED`).

## Decision

1. **Content Script là nguồn sự thật duy nhất (Single Source of Truth)** đối với trạng thái hành trình đặt vé (`ticketbox_assistant_journey_state`).
2. **Service Worker chỉ quản lý vòng đời cấp cao** (`ticketbox_assistant_lifecycle_state`: INIT, READY, ARMED, SCHEDULED, STOPPED) và đóng vai trò **phản chiếu (mirror)** trạng thái hành trình nhận được qua thông điệp `STATE_CHANGED`.
3. **Xác thực người gửi thông điệp:** Service Worker xác thực thông điệp `STATE_CHANGED` (chỉ chấp nhận từ extension runtime nội bộ và frameId = 0 của top-level window) trước khi cập nhật phản chiếu và hiển thị badge.
4. **Phản chiếu Extension Badge:** Service Worker phản chiếu trạng thái hành trình lên extension badge ngay khi nhận `STATE_CHANGED`:
   - `SELECTING / RESERVING / CHECKOUT / PAYMENT_GATE` → `BUY` (màu hồng `#ec4899`).
   - `CONFIRMED` → `DONE` (màu xanh lá `#10b981`).
   - `HUMAN_INTERVENTION_REQUIRED / CAPTCHA / OTP` → `CAPT` (màu đỏ `#ef4444`).
5. **Tách biệt Storage Keys:**
   - `ticketbox_assistant_journey_state`: chỉ được ghi và sở hữu bởi Content Script.
   - `ticketbox_assistant_lifecycle_state`: chỉ được ghi và sở hữu bởi Service Worker.
   - Tuyệt đối không để hai bên ghi đè chung một key.
6. **Khôi phục an toàn (Safe Rehydration):**
   - Cung cấp API `PurchaseStateMachine.prototype.restore(context)` và static `PurchaseStateMachine.restore(context)`.
   - API này kiểm tra nghiêm ngặt các bất biến miền (Rule 06 & Invariant 3):
     - Chuyển/khôi phục về `CONFIRMED` bắt buộc phải có bằng chứng thanh toán có thẩm quyền (`orderId` hoặc `confirmationReference`).
     - Chuyển/khôi phục về `HELD` bắt buộc phải có bằng chứng giữ chỗ (`reservationId`).
     - Trạng thái mục tiêu phải thuộc enum `PurchaseState`.
   - Khi Content Script khởi động lại / tải lại trang, nó đọc `getJourneyState()` và khôi phục trạng thái. Nếu trạng thái là `HELD`, `PAYMENT_GATE`, `CONFIRMED`, `HUMAN_INTERVENTION_REQUIRED`, hệ thống bảo toàn trạng thái và không tự động quay về `MONITORING`.

## Consequences

### Positive

- Loại bỏ hoàn toàn xung đột ghi đè trạng thái giữa Service Worker và Content Script.
- Badge extension phản ánh chính xác trạng thái thực tế theo thời gian thực.
- Người dùng không bị mất trạng thái đơn hàng khi reload trang ở bước thanh toán hay giữ chỗ.
- Đảm bảo triệt để nguyên tắc fail-closed và bất biến bảo vệ ranh giới thanh toán.

### Negative

- Service Worker cần duy trì bộ đệm phản chiếu (`mirroredJourneyContext`) trong bộ nhớ để phản hồi `SYNC_STATE_REQUEST` cho Popup khi Popup được mở.
