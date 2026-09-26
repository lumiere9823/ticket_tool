# Ticketbox Purchase Assistant

## Technical Design v1

**Status:** Draft
**Depends on:** Technical Discovery

---

# 1. System Boundary

System gồm:

```text
┌─────────────────────────────────────────┐
│             User Machine                │
│                                         │
│  ┌───────────────┐                      │
│  │ Chrome        │                      │
│  │               │                      │
│  │ Ticketbox     │                      │
│  │      +        │                      │
│  │ Extension     │                      │
│  └───────────────┘                      │
│                                         │
│  ┌─────────────────────┐                │
│  │ Desktop Controller  │ optional       │
│  └─────────────────────┘                │
└─────────────────────────────────────────┘
```

Backend là optional external component.

---

# 2. Extension Layers

```text
Presentation
    ↓
Application
    ↓
Domain
    ↓
Infrastructure
```

---

# 3. Presentation Layer

Responsible for:

```text
Popup
Status
Configuration
Notifications
```

Không chứa business logic.

---

# 4. Application Layer

Use cases:

```text
ArmAssistant
StopAssistant
StartMonitoring
ApplySelectionStrategy
ProcessReservationResult
HandleFailure
```

---

# 5. Domain Layer

Core concepts:

```text
Event
TicketPreference
SelectionStrategy
Reservation
AccountSession
PurchaseState
Failure
```

Domain layer không biết Chrome DOM.

---

# 6. Infrastructure

Adapters:

```text
ChromeStorage
ChromeMessaging
DOMObserver
TicketboxPageAdapter
BrowserNotification
Logger
```

---

# 7. Ticketbox Adapter

Không để business code gọi DOM trực tiếp.

Sai:

```text
if (document.querySelector(...)) {
    ...
}
```

được rải khắp project.

Đúng:

```text
TicketboxPageAdapter
        ↓
Application/Domain
```

---

# 8. Adapter Responsibilities

```text
TicketboxPageAdapter
├── getEventState()
├── getInventoryState()
├── getSelectionState()
├── selectTicket()
├── submitReservation()
├── getReservationState()
└── getCheckoutState()
```

Các method trên chỉ là interface thiết kế.

Implementation chỉ được hoàn thiện sau Network Discovery.

---

# 9. State Machine

State machine là authoritative state.

Không sử dụng:

```text
button text
CSS class
URL
```

như state machine độc lập.

Các tín hiệu này chỉ là input.

---

# 10. Message Bus

Extension components giao tiếp bằng typed messages.

Ví dụ:

```text
STATE_CHANGED
INVENTORY_AVAILABLE
SELECTION_STARTED
RESERVATION_STARTED
RESERVATION_CONFIRMED
RESERVATION_FAILED
STOP_REQUESTED
```

Message:

```text
{
  type,
  timestamp,
  correlationId,
  payload
}
```

---

# 11. Correlation ID

Mỗi purchase attempt có:

```text
attempt_id
```

Ví dụ:

```text
attempt_01J...
```

Mọi event liên quan cùng attempt phải dùng cùng correlation ID.

---

# 12. Storage

Local storage chứa:

```text
user preferences
event configuration
assistant state
non-sensitive logs
```

Không chứa:

```text
password
OTP
CVV
raw authentication token
```

---

# 13. Logging

Log schema:

```text
timestamp
level
account_id
event_id
attempt_id
state
event
duration
error_code
```

---

# 14. Sensitive Data

Logger phải sanitize:

```text
Authorization
Cookie
Set-Cookie
OTP
Password
Payment credentials
```

Không dump toàn bộ network response vào production logs.

---

# 15. Error Handling

Mọi error phải thuộc:

```text
BUSINESS
AUTH
PLATFORM
NETWORK
CHECKOUT
PAYMENT
UNKNOWN
```

Unknown error phải fail safely.

---

# 16. Retry

Retry phải được policy-driven.

```text
RetryPolicy
├── isRetryable()
├── maxAttempts()
├── backoff()
└── shouldStop()
```

Không hard-code retry loop trong UI/content script.

---

# 17. Clock

Không dùng local clock để quyết định server reservation expiration nếu Ticketbox cung cấp authoritative timestamp.

Nếu cần countdown:

```text
server_expires_at
+
observed_server_time_offset
```

thay vì đơn giản:

```text
Date.now() + 15 minutes
```

---

# 18. Performance

Critical path phải tránh:

```text
unnecessary React render
large DOM scans
excessive polling
large logging payload
backend round-trip
```

DOM observation phải targeted.

---

# 19. Recovery

Extension restart:

```text
INIT
 ↓
RESTORE_SAFE_STATE
 ↓
AUTH_CHECK
```

Không tự resume reservation action một cách mù quáng.

Nếu state không xác định:

```text
UNKNOWN
 ↓
SAFE STOP
```

---

# 20. Core Principle

> Unknown state must fail safely rather than trigger another purchase action.
