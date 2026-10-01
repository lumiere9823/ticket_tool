# ADR-007 — Booking Journey Reliability, Form Autofill & Collision Recovery

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Trong hành trình mua vé thực tế trên Ticketbox, các trở ngại kỹ thuật phổ biến nhất đối với browser extension bao gồm:

1. **React Controlled Inputs & Input Masking:**
   - Ticketbox sử dụng React và Ant Design Form. Khi can thiệp điền form thông thường bằng cách gán `input.value = ...`, React không nhận diện thay đổi do React ghi đè setter `value` trên `HTMLInputElement.prototype` và lưu vết giá trị trước đó trong `_valueTracker`.
   - Các trường thông tin người tham dự (Họ tên, SĐT, Email, CCCD, Năm sinh, Địa chỉ) yêu cầu kích hoạt đầy đủ chuỗi sự kiện tổng hợp (`focus`, `beforeinput`, `input`, `change`, `blur`).
   - Các trường dạng `<textarea>` và `<select>` cần áp dụng đúng prototype setter và sự kiện tương ứng (`input` + `change`).
   - Các ô chọn dạng `checkbox` hoặc `radio` có thể bọc trong các thẻ cha của Ant Design (`.ant-checkbox-wrapper`, `.ant-radio-wrapper`) đòi hỏi cả việc gán thuộc tính `checked` lẫn kích hoạt click trên wrapper.

2. **Cổng Đồng thuận Người dùng (Consent Gate) & Cổng Thanh toán (Payment Gate):**
   - Khi form khảo sát có điều khoản/chính sách, extension tuyệt đối không được tự ý đồng ý thay người dùng nếu người dùng chưa đánh dấu chấp thuận tường minh (`agreeToTerms: false`).
   - Tại cổng thanh toán (`PAYMENT_GATE`), extension phải dừng lại hoàn toàn và nhường quyền kiểm soát cho người dùng. `ActionGuard` phải từ chối mọi hành động thanh toán tự động hoặc can thiệp giữ vé trái phép.

3. **Xử lý Xung đột Ghế và Khu vực (Collision Recovery & Retry Bounds):**
   - Lỗi ghế bị giữ trước bởi người khác (mã lỗi `-1242`) cần được phát hiện ngay từ popup thông báo, tự động đưa ghế lỗi vào danh sách đen (`blacklistSeat`), và chọn lại ghế liền kề khả dụng khác.
   - Khi một khu vực (Area/Zone) liên tục gặp xung đột ghế vượt ngưỡng (`MAX_AREA_COLLISIONS = 2`), khu vực đó phải được đánh dấu là kiệt vé để chuyển sang khu vực khả dụng tiếp theo của cùng hạng vé.
   - Khi vượt quá giới hạn thử lại (`MAX_RETRIES = 8`) trong khuôn khổ kế hoạch mua vé có phạm vi (`ScopedPurchasePlan`), hệ thống phải chuyển dịch êm ái sang `WAITING_FOR_STOCK` để tiếp tục chờ đợt mở bán hoặc ghế nhả ra thay vì thất bại vĩnh viễn (`FAILURE_OCCURRED`).

---

## Decisions

1. **Hoàn thiện Bộ Điền Form Tương thích React & Ant Design:**
   - Trong `TicketboxJourneyAdapter.fillAttendeeForm`, trích xuất và gọi trực tiếp prototype setter descriptor (`Object.getOwnPropertyDescriptor(proto, 'value')?.set`) tương ứng với loại phần tử (`HTMLInputElement` hoặc `HTMLTextAreaElement`).
   - Đặt lại bộ theo dõi giá trị nội bộ của React (`_valueTracker.setValue('')` hoặc `_valueTracker.setValue('false')`) trước khi kích hoạt sự kiện để đảm bảo React State luôn cập nhật giá trị mới.
   - Kích hoạt đầy đủ chuỗi sự kiện: `focus` -> `input` -> `change` -> `blur` cho ô nhập văn bản và `change` + `input` cho thẻ `<select>`.
   - Đối với `checkbox` / `radio`, đồng bộ kích hoạt click trên phần tử hoặc wrapper ngoài cùng (`closest('label, .ant-radio-wrapper, .ant-checkbox-wrapper, ...')`).

2. **Chuẩn hóa Truy cập URL qua Cổng `TicketboxPageAdapter.getPageUrl()`:**
   - Bổ sung phương thức `getPageUrl(): string` vào cổng `TicketboxPageAdapter` và sử dụng trong toàn bộ `ExecuteBookingJourneyUseCase` thay vì truy cập trực tiếp `window.location.href`. Điều này cho phép điều hướng và xác minh luồng an toàn, khả kiểm thử trong môi trường Node.js mà không cần phụ thuộc vào biến toàn cục của trình duyệt.

3. **Nâng cấp Bảng Chuyển dịch Trạng thái của `PurchaseStateMachine`:**
   - Bổ sung các quy tắc chuyển dịch `WAITING` và `WAITING_FOR_STOCK` từ các trạng thái lựa chọn trung gian (`BOOKING_MODE_DETECTED`, `QUANTITY_SELECTION`, `SELECTING_QUANTITY`, `AREA_SELECTION_REQUIRED`, `SELECTING_AREA`, `SEAT_MAP_DETECTED`, `SEAT_SELECTION`, `SELECTING_SEATS`, `SEATS_SELECTED`).
   - Cho phép `READY` và `ARMED` chuyển sang `PAYMENT_GATE` khi trang hiện tại đã nằm ở bước thanh toán của Ticketbox.

4. **Kiểm thử Hồi quy Toàn diện:**
   - Xây dựng bộ kiểm thử `tests/unit/infrastructure/FormAutofillJourney.test.ts` (9 bài kiểm thử) bao phủ toàn diện:
     - Gọi descriptor setter và reset React `_valueTracker` cho SĐT / CCCD.
     - Điền `<textarea>` địa chỉ và dropdown `<select>`.
     - Kích hoạt checkbox điều khoản và wrapper Ant Design.
     - Dừng đúng ranh giới `CONSENT_REQUIRED` khi `agreeToTerms: false`.
     - Dừng đúng ranh giới `PAYMENT_GATE` và xác minh `ActionGuard` từ chối thanh toán tự động.
     - Chuyển đổi khu vực khi đạt ngưỡng va chạm khu vực (`MAX_AREA_COLLISIONS = 2`).
     - Bắt lỗi `-1242`, blacklist ghế và chọn lại ghế thay thế.
     - Chuyển sang `WAITING_FOR_STOCK` khi vượt quá `MAX_RETRIES` dưới Scoped Purchase Plan.

---

## Consequences

### Positive

- Tăng cường độ tin cậy khi điền form khảo sát người tham dự trên mọi cấu trúc DOM của Ticketbox.
- Bảo vệ tuyệt đối quyền đồng thuận điều khoản và sự kiểm soát tài chính của người dùng (dừng trước mọi cổng thanh toán).
- Khả năng tự phục hồi khi có tranh chấp ghế hoặc nghẽn khu vực trong các đợt mở bán vé cao điểm.
- 100% kiểm thử đi qua (562 tests passing, 0 type errors, 0 lint warnings).

### Negative

- Đòi hỏi duy trì logic tương thích React `_valueTracker` trong trường hợp React thay đổi cấu trúc quản lý state nội bộ trong các phiên bản tương lai.
