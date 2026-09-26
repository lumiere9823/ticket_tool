# Ticketbox Reservation Boundary

**Version:** 0.1
**Status:** Critical Design Gate

---

# 1. Purpose

Tài liệu này định nghĩa chính xác:

> Khi nào hệ thống được phép nói "vé đã được giữ".

---

# 2. Incorrect Definitions

Các trạng thái sau KHÔNG đủ để xác nhận reservation:

```text
Page loaded
Ticket visible
Ticket selected
Button clicked
Request sent
Checkout opened
```

---

# 3. Required Definition

Canonical success:

```text
CLIENT ACTION
     ↓
TICKETBOX SERVER
     ↓
SERVER ACCEPTS INVENTORY ALLOCATION
     ↓
HELD
```

---

# 4. Reservation Evidence

Evidence được phân cấp.

## Level 1 — Strong

```text
Server-issued reservation/hold identifier
```

## Level 2 — Strong

```text
Server-confirmed checkout state tied to inventory
```

## Level 3 — Supporting

```text
Server-provided expiration timestamp
```

## Level 4 — Weak

```text
UI changed
Button changed
Countdown appeared
```

Level 4 không được sử dụng độc lập để đánh dấu `HELD`.

---

# 5. Boundary

Tạm thời:

```text
AVAILABLE
    ↓
[RESERVATION REQUEST — TBD]
    ↓
[SERVER CONFIRMATION — TBD]
    ↓
HELD
```

Hai phần `TBD` phải được thay bằng evidence thực tế.

---

# 6. Reservation Record

Canonical internal representation:

```text
Reservation
├── id
├── account_id
├── event_id
├── inventory_reference
├── status
├── created_at
├── expires_at
└── checkout_reference
```

Các field trên là internal domain model của tool, không phải claim về Ticketbox database.

---

# 7. Reservation Status

```text
PENDING
CONFIRMED
EXPIRED
FAILED
CANCELLED
```

---

# 8. Success Event

Extension phát:

```text
RESERVATION_CONFIRMED
```

chỉ sau khi evidence đạt acceptance criteria.

---

# 9. Global Success

Nếu multi-account mode là:

```text
ONE_SUCCESS
```

thì:

```text
Account A
    ↓
RESERVATION_CONFIRMED
    ↓
GLOBAL_SUCCESS
    ↓
STOP OTHER ATTEMPTS
```

---

# 10. Reservation Expiration

Nếu server cung cấp:

```text
expires_at
```

thì sử dụng giá trị đó.

Không tự giả định duration.

---

# 11. Reservation Boundary Acceptance Test

Test phải chứng minh:

### Case A

```text
Ticket selected
but reservation rejected
```

Expected:

```text
NOT HELD
```

### Case B

```text
Reservation accepted
```

Expected:

```text
HELD
```

### Case C

```text
Reservation expires
```

Expected:

```text
EXPIRED
```

---

# 12. Design Gate

Implementation không được coi là production-ready nếu:

```text
Reservation request = TBD
OR
Success evidence = TBD
```

---

# 13. Core Principle

> **A reservation is a server-side business state, not a browser interaction.**
