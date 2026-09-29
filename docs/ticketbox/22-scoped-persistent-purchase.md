# Scoped Persistent Purchase (Săn Vé Có Phạm Vi)

**Tài liệu:** `docs/ticketbox/22-scoped-persistent-purchase.md`  
**Dự án:** Ticketbox Purchase Assistant  
**Phiên bản:** 0.5.0 (Phase 2: Persistent Loop & Authoritative State Transitions)  
**Ngày cập nhật:** 29/09/2026

---

## 1. Mục Tiêu Nghiệp Vụ

Người dùng cấu hình ma trận phạm vi mục tiêu gồm (Suất diễn/Ngày × Hạng vé) được phép mua. Hệ thống kiên trì (có giới hạn định trước) dò quét và mua vé, tuyệt đối **KHÔNG BAO GIỜ** chọn bất kỳ vé nào ngoài danh sách whitelist. Quá trình dừng lại khi đạt `PAYMENT_GATE` với vé thuộc whitelist và có bằng chứng giữ chỗ từ máy chủ.

---

## 2. Business Rules (Không Vi Phạm)

- **BR-S01 Scope Guard Cứng:** Chỉ chọn cặp `(showingId, ticketTypeId)` nằm trong whitelist. Chỉ còn vé ngoài whitelist thì không mua, ở lại chờ (`WAITING_FOR_STOCK`). Khóa chính là `(showingId, ticketTypeId)`. Khớp tên chỉ được dùng trong cùng `showingId` khi tên là duy nhất; nếu trùng tên hoặc mơ hồ phải loại ứng viên với lý do `AMBIGUOUS_MATCH` (không đoán).
- **BR-S02 Whitelist Rỗng:** Không cho phép kích hoạt `ARM` khi danh sách mục tiêu rỗng hoặc không chọn vé nào. Không có chế độ "mua tất cả".
- **BR-S03 Giới Hạn Kiên Trì:** Phải có trần thời gian (`maxDurationMinutes`, mặc định 30), trần số lần thử (`maxAttempts`, mặc định 200), giãn cách poll tối thiểu (`pollIntervalMs`, sàn 1500ms) kèm tỷ lệ biến thiên (`jitterRatio`, mặc định 0.2). Mọi loop đệ quy dùng `setTimeout` với sàn bắt buộc `Math.max(1500, delay)`. Cấm dùng `setInterval`.
- **BR-S04 Bằng Chứng Máy Chủ:** `SELECTED ≠ RESERVED`. Chỉ ghi nhận giữ chỗ khi có bằng chứng phản hồi máy chủ.
- **BR-S05 Human Payment Gate:** Luôn dừng lại trước khâu thanh toán tiền cuối cùng (`PAYMENT_GATE`). Không tự thanh toán.
- **BR-S06 Thử Thách Bảo Mật:** Gặp CAPTCHA / Waiting Room / Queue-it / mất phiên đăng nhập thì chuyển `HUMAN_INTERVENTION_REQUIRED` và dừng tự động.
- **BR-S07 Ràng Buộc Số Lượng:** Số lượng $\le$ `maxQtyPerOrder` của hạng vé và $\le$ số người tham dự khai báo. Hỗ trợ cờ `allowPartialQuantity` khi số vé còn lại ít hơn mong muốn.
- **BR-S08 Dừng Sau Khi Giữ Vé:** Sau khi giữ được vé trong whitelist thành công, dừng săn ngay lập tức, không giữ thêm vé thứ hai.
- **BR-S09 Single Chokepoint:** Mọi hành động chọn vé, click lịch chọn suất, mở drawer và điều hướng trực tiếp `/bookings/{showingId}/select-ticket` đều phải đi qua chokepoint duy nhất `assertInScope(plan, showingId, ticketTypeId)`. Vi phạm ném `ScopeViolationError`.
- **BR-S10 Phân Biệt Attempt & Discovery:** Dò quét thụ động (pure discovery) KHÔNG tăng `attemptsCount`. Chỉ tăng `attemptsCount` khi bắt đầu thực thi chọn vé hoặc thử lại mục tiêu (`RETRYING_TARGET`).

---

## 3. Data Model

Được định nghĩa tại tầng Domain (`src/domain/entities/ScopedPurchasePlan.ts`):

```typescript
export type PriorityStrategy = 'BY_TARGET_ORDER' | 'SHOWING_FIRST' | 'TIER_FIRST';

export interface ScopedTarget {
  showingId: string;
  ticketTypeIds: string[];
  rank: number;
}

export interface PersistencePolicy {
  maxDurationMinutes: number; // Mặc định 30
  maxAttempts: number; // Mặc định 200
  pollIntervalMs: number; // Mặc định 2000, sàn tối thiểu 1500
  jitterRatio: number; // Mặc định 0.2
  stopAt?: string; // ISO timestamp string tùy chọn
}

export interface ScopedPurchasePlan {
  eventId: string;
  targets: ScopedTarget[];
  quantity: number;
  strategy: PriorityStrategy; // 'BY_TARGET_ORDER' | 'SHOWING_FIRST' | 'TIER_FIRST'
  persistence: PersistencePolicy;
  allowPartialQuantity?: boolean; // Mặc định false
}
```

State Machine Mở Rộng:

- `WAITING_FOR_STOCK`: Dò quét không có vé trong whitelist còn hàng.
- `RETRYING_TARGET`: Đổi sang mục tiêu tiếp theo trong whitelist khi mục tiêu trước đó unselectable/hết vé.
- `STOPPED_LIMIT_REACHED`: Dừng do vượt quá `maxDurationMinutes`, `maxAttempts`, hoặc `stopAt`.
- `STOPPED_NO_TARGET`: Dừng do không còn mục tiêu khả dụng nào trong whitelist.
- `HUMAN_INTERVENTION_REQUIRED`: Dừng khi phát hiện CAPTCHA, Cloudflare challenge, hoặc mất phiên đăng nhập.

Mọi trạng thái mới đều có thể đảo ngược về `READY` thông qua sự kiện `RESET_REQUESTED`, hoặc về `STOPPED` qua `STOP_REQUESTED`.

---

## 4. Cơ Chế Target Cycling & Strategy Engine (`pickTarget`)

Hàm thuần túy `pickTarget(candidates, plan)` tại Domain:

1. `BY_TARGET_ORDER`: Ưu tiên tuyệt đối theo thứ tự mảng `plan.targets`, sau đó theo thứ tự mảng `target.ticketTypeIds`.
2. `SHOWING_FIRST`: Gom nhóm theo suất diễn ưu tiên cao nhất (`target.rank`), chọn vé khả dụng đầu tiên trong suất đó.
3. `TIER_FIRST`: Gom nhóm theo hạng vé, ưu tiên các suất diễn có mở bán hạng vé mong muốn.

Khi một target thất bại trong quá trình execute:

- Đưa key `${showingId}_${ticketTypeId}` vào tập đã thử trong chu kỳ (`triedCandidateKeysInCycle`).
- Chuyển trạng thái sang `RETRYING_TARGET`, tăng `attemptsCount`.
- Tiếp tục gọi `pickTarget` với các candidate còn lại chưa thử trong chu kỳ.
- Khi toàn bộ candidate trong whitelist của chu kỳ đều thất bại:
  - Reset `triedCandidateKeysInCycle`.
  - Chuyển trạng thái sang `WAITING_FOR_STOCK`.
  - Chờ nhịp poll tiếp theo.

---

## 5. MV3 Service Worker & Content Script Lifecycle

- **Heartbeat Alarm:** MV3 Service Worker kích hoạt alarm `PERSISTENT_PURCHASE_HEARTBEAT` định kỳ (~30 giây) để kiểm tra timeout, `stopAt`, và `maxAttempts`, bảo đảm giám sát không bị Chrome kill tiến trình âm thầm.
- **Rehydration Safety:** Khi Worker khởi động lại hoặc Tab reload, `initializeWorker()` và `content.ts` nạp lại `PersistentExecutionState` từ `chrome.storage.local` mà **KHÔNG** đặt lại `attemptsCount = 0` hay `startedAt = now`.
- **Page Visibility Tracking:** Lắng nghe sự kiện `visibilitychange`. Khi `document.hidden === true`, lưu cờ cảnh báo `tabHiddenWarning = true` và hiển thị banner nhắc nhở người dùng giữ tab Ticketbox ở foreground để tránh browser throttling.
