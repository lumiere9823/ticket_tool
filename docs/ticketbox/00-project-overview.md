# Ticketbox Purchase Assistant

## Project Overview & Product Requirements

**Version:** 0.1
**Status:** Pre-Implementation
**Primary Client:** Chrome Extension
**Target:** Ticketbox Web

---

# 1. Product Definition

Ticketbox Purchase Assistant là một công cụ hỗ trợ người dùng chuẩn bị và thực hiện quy trình mua vé Ticketbox thông qua trình duyệt, tập trung vào:

- giảm thao tác thủ công;
- chuẩn bị trước các lựa chọn mua;
- phát hiện trạng thái bán vé;
- thực hiện flow mua vé bình thường của website;
- xác nhận kết quả reservation;
- hỗ trợ quản lý nhiều browser profile/account.

Sản phẩm **không được định nghĩa là một công cụ "auto click"**.

Định nghĩa chính xác hơn:

> A browser-based purchase assistant that minimizes user interaction latency while preserving the normal Ticketbox purchase flow.

---

# 2. Core Product Problem

Trong event có nhu cầu cao:

```text
Ticket available
       ↓
Many users react
       ↓
Users select tickets
       ↓
Server receives reservation attempts
       ↓
Server decides inventory allocation
```

Do đó:

```text
Seeing ticket
        ≠
Selecting ticket
        ≠
Reservation
        ≠
Confirmed order
```

Product phải tập trung vào boundary:

```text
AVAILABLE
    ↓
SERVER-CONFIRMED RESERVATION
    ↓
HELD
```

---

# 3. Product Goals

## G-01 — Preparation

Cho phép user chuẩn bị toàn bộ preference trước thời điểm mở bán.

## G-02 — Detection

Phát hiện relevant state của Ticketbox trong thời gian thực trong phạm vi browser cho phép.

## G-03 — Selection

Áp dụng preference đã cấu hình mà không yêu cầu user ra quyết định mới trong critical moment.

## G-04 — Reservation

Thực hiện normal purchase interaction và xác định chính xác reservation có thành công hay không.

## G-05 — Multi-account Management

Cho phép quản lý nhiều Chrome Profile/session hợp lệ.

## G-06 — Observability

Ghi nhận lifecycle và latency để có thể đo:

```text
availability
→ detection
→ selection
→ reservation
→ hold
→ checkout
```

---

# 4. Non-Goals

Project không có mục tiêu:

- bypass CAPTCHA;
- bypass queue/waiting room;
- bypass rate limiting;
- bypass anti-bot;
- đánh cắp session/cookie;
- thu thập password/OTP;
- flood request;
- giả mạo authentication;
- can thiệp payment credentials;
- đảm bảo user luôn mua được vé.

---

# 5. Core User Journey

```text
INSTALL
   ↓
LOGIN TO TICKETBOX NORMALLY
   ↓
OPEN EVENT
   ↓
CONFIGURE PREFERENCES
   ↓
ARM ASSISTANT
   ↓
WAIT
   ↓
EVENT / INVENTORY AVAILABLE
   ↓
SELECT
   ↓
RESERVATION
   ↓
SERVER CONFIRMED
   ↓
HELD
   ↓
CHECKOUT
   ↓
PAYMENT
   ↓
CONFIRMED
```

---

# 6. User Configuration

User có thể cấu hình:

```text
Event
Quantity
Ticket category priority
Area priority
Seat preference
Fallback strategy
Account assignment
```

Ví dụ:

```text
Priority:

1. VIP
2. CAT 1
3. CAT 2
4. ANY
```

---

# 7. Multi-account Model

Mỗi account được gắn với một browser profile:

```text
Profile A → Account A
Profile B → Account B
Profile C → Account C
```

Không lưu password/OTP trong tool.

Account phải đăng nhập thông qua flow bình thường của Ticketbox.

---

# 8. Success Definition

Product success không phải:

```text
button clicked
```

Không phải:

```text
ticket selected
```

Không phải:

```text
checkout opened
```

Success tối thiểu là:

```text
Ticketbox server
        ↓
accepts reservation
        ↓
inventory held for user/session
```

Evidence chính xác phải được xác định trong Technical Discovery.

---

# 9. Primary KPI

Metric chính:

```text
Acquisition Latency

=
Server-confirmed hold timestamp
-
Inventory-available timestamp
```

Các metric phụ:

```text
Detection latency
Selection latency
Action latency
Reservation response latency
Checkout transition latency
```

---

# 10. MVP

## Included

```text
Chrome Extension MV3
Event configuration
Ticket preference
Quantity
State observation
Selection engine
Reservation result detection
Checkout handoff
Status UI
Local logging
Chrome Profile support
```

## Deferred

```text
Desktop Controller
Multi-account orchestration
Backend
Web dashboard
Remote configuration
Analytics service
```

---

# 11. Product Principle

> **Do not optimize clicks. Optimize the path to server-confirmed reservation.**

Đây là nguyên tắc xuyên suốt toàn bộ project.
