# ADR-006 — State Machine Invariant Hardening & Audit Logging

**Status:** Accepted  
**Date:** 2026-10-01

## Context

Tài liệu thiết kế kiến trúc `docs/ticketbox/04-state-machine.md` quy định máy trạng thái (`PurchaseStateMachine`) là **nguồn sự thật duy nhất (Single Source of Truth)** cho toàn bộ quy trình mua vé trên Ticketbox. Để đạt chuẩn sản phẩm hoàn chỉnh và an toàn tuyệt đối:

1. **Yêu cầu Nhật ký Chuyển dịch Trạng thái (Section 57):** Mỗi lần chuyển dịch trạng thái phải tạo ra một sự kiện kiểm toán bất biến (immutable audit event) lưu lại các thông tin `fromState`, `event`, `toState`, `timestamp`, `attemptId`, `workflowId`, `evidence`, `failureReason`.
2. **Xác minh Bất biến Miền Chặt chẽ (Invariants 1 - 9):**
   - Không được phép tự động bắt đầu quy trình mua nếu chưa có `ARM` tường minh từ người dùng (Invariant 1).
   - Không được phép chuyển sang `HELD` nếu thiếu mã giữ chỗ từ máy chủ `reservationId` (Invariant 2).
   - Không được phép chuyển sang `CONFIRMED` nếu thiếu bằng chứng thanh toán có thẩm quyền `orderId` hoặc `confirmationReference` (Invariant 3).
   - Không được phép tự động thực hiện thanh toán tại cổng thanh toán `PAYMENT_GATE` (Invariant 4).
   - Tự động hóa phải đóng băng hoàn toàn khi gặp các thách thức can thiệp người dùng (CAPTCHA, OTP, Re-auth, Payment Action) (Invariant 5).
   - Bước tái thẩm định `STATE_RECHECK` tuyệt đối không được tự ý cấp quyền trực tiếp cho các trạng thái nhạy cảm (`HELD`, `CONFIRMED`, `PAYMENT`, `CHECKOUT`, `RESERVING`, `PAYMENT_GATE`) (Invariant 6).
   - Các trạng thái kết thúc (`CONFIRMED`, `STOPPED`, `FAILED`) phải có tính bất biến fail-closed, không thể bị ghi đè bởi các sự kiện lỗi hoặc dừng trễ (Invariant 7).
   - Phục hồi ngữ cảnh (`restore`) phải kiểm tra toàn vẹn dữ liệu trước khi nạp lại trạng thái (Invariant 8).

---

## Decisions

1. **State Transition Audit Log:**
   - Định nghĩa `StateTransitionAuditEvent` với cấu trúc bất biến chuẩn hóa.
   - Bổ sung bộ đệm kiểm toán `_auditLog` vào `PurchaseStateMachine` với dung lượng giới hạn `MAX_AUDIT_LOG_SIZE = 100` áp dụng cơ chế đào thải FIFO (First-In, First-Out) để ngăn ngừa tràn bộ nhớ.
   - Cung cấp API `getAuditLog(): readonly StateTransitionAuditEvent[]` phục vụ telemetry và chẩn đoán lỗi.

2. **Khóa Bất biến Cổng Thanh toán & Can thiệp Người:**
   - Tích hợp và kiểm chứng chặt chẽ với `ActionGuard.canExecuteAction`: từ chối mọi hành động mua vé tự động (`SELECT`, `RESERVE`, `CHECKOUT`, `PAYMENT`) khi máy trạng thái nằm trong nhóm `isHumanInterventionState` hoặc `PAYMENT_GATE`.

3. **Kiểm thử Toàn diện (Exhaustive Test Suite):**
   - Xây dựng bộ kiểm thử chuyên sâu `tests/unit/domain/StateMachineExhaustiveInvariants.test.ts` (24 bài kiểm thử) bao phủ toàn bộ 9 bất biến kiến trúc, đảm bảo không có bất kỳ đường rẽ nhánh nào phá vỡ quy tắc bảo vệ ranh giới vé.

---

## Consequences

### Positive

- Hệ thống có khả năng truy vết hoàn chỉnh (full observability) về từng bước chuyển đổi trạng thái trong suốt phiên làm việc.
- Ranh giới thanh toán và giữ chỗ được bảo vệ đa tầng (State Machine level + Action Guard level).
- Không có rủi ro máy trạng thái bị kẹt ở trạng thái bất hợp lệ hoặc bị lợi dụng để tự động thanh toán.

### Negative

- Bộ nhớ duy trì một mảng nhỏ chứa tối đa 100 sự kiện kiểm toán gần nhất trong suốt vòng đời của `PurchaseStateMachine`.
