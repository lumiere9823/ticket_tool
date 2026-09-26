# Multi-Account Orchestration

**Version:** 0.1
**Status:** Architecture

---

# 1. Objective

Cho phép nhiều Chrome Profile chạy song song nhưng vẫn:

- cô lập session;
- có chiến lược riêng;
- có global coordination;
- có stop conditions;
- tránh session contamination.

---

# 2. Architecture

```text
Controller
    │
    ▼
Orchestrator
    │
    ├── Profile A
    │      └── Extension A
    │
    ├── Profile B
    │      └── Extension B
    │
    └── Profile C
           └── Extension C
```

---

# 3. Profile Isolation

Mỗi profile phải có:

```text
separate cookies
separate local storage
separate Ticketbox session
separate extension runtime state
```

Không dùng cookie switching.

---

# 4. Account Model

```text
Account
├── account_id
├── profile_id
├── display_name
├── status
├── event_assignment
└── strategy
```

Không lưu:

```text
password
OTP
CVV
session token
```

---

# 5. Strategy

Mỗi account có:

```text
ticket_priority
quantity
area_priority
fallback
```

Ví dụ:

```text
A:
VIP → CAT1 → CAT2

B:
CAT1 → CAT2

C:
CAT2
```

---

# 6. Global Policy

```text
ONE_SUCCESS
```

hoặc:

```text
MULTIPLE_SUCCESS_ALLOWED
```

Policy phải được cấu hình rõ.

---

# 7. ONE_SUCCESS

```text
A → HELD
```

Controller:

```text
GLOBAL_SUCCESS
```

Sau đó:

```text
B → STOP
C → STOP
```

---

# 8. Multiple Success

Nếu business scenario cho phép nhiều purchase hợp lệ:

```text
A → HELD
B → HELD
C → FAILED
```

Controller không stop B sau A.

---

# 9. Failure Coordination

Nếu:

```text
A → FAILED
```

thì không nhất thiết:

```text
GLOBAL_FAILED
```

Controller kiểm tra:

```text
B
C
...
```

Global failure chỉ xảy ra khi toàn bộ eligible accounts thất bại hoặc event kết thúc.

---

# 10. Account State

```text
NOT_READY
READY
ARMED
MONITORING
SELECTING
RESERVING
HELD
CHECKOUT
CONFIRMED
FAILED
STOPPED
```

---

# 11. Global State

```text
IDLE
ARMED
RUNNING
SUCCESS
STOPPING
STOPPED
FAILED
```

---

# 12. Coordination Events

Controller có event bus logic:

```text
ACCOUNT_READY
ACCOUNT_STARTED
ACCOUNT_FAILED
RESERVATION_CONFIRMED
CHECKOUT_READY
GLOBAL_SUCCESS
GLOBAL_STOP
```

---

# 13. Safety Conditions

Controller phải stop khi:

```text
rate-limit
authentication failure
session expired
platform error
user stop
event ended
```

Không retry vô hạn.

---

# 14. Critical Rule

Multi-account orchestration không được biến thành cơ chế:

```text
rate-limit bypass
queue bypass
anti-bot bypass
```

Nó chỉ quản lý các browser sessions hợp lệ mà user được phép sử dụng.

---

# 15. MVP Scope

Phase 1:

```text
1 profile
```

Phase 2:

```text
2–3 profiles
```

Phase 3:

```text
controller
```

Chỉ scale sau khi single-account flow ổn định.
