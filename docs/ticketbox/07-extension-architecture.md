# Ticketbox Purchase Assistant

## System Architecture & Implementation Plan

**Version:** 0.1
**Status:** Architecture Proposal

---

# 1. Architecture Decision

Kiến trúc chính:

```text
Chrome Extension
       +
Chrome Profiles
       +
Optional Desktop Controller
       +
Optional Backend
```

Không đưa backend vào reservation critical path.

---

# 2. Target Architecture

```text
                 ┌───────────────────────┐
                 │   Desktop Controller  │
                 │   Optional in MVP     │
                 └───────────┬───────────┘
                             │
                      Orchestrator
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
     Chrome Profile A   Chrome Profile B   Chrome Profile C
          │                  │                  │
     Extension A        Extension B        Extension C
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                             ▼
                         Ticketbox
                             │
                             ▼
                  Server-confirmed Hold
```

---

# 3. Extension Architecture

```text
extension/
├── manifest.json
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   │
│   ├── content/
│   │   ├── page-observer.ts
│   │   ├── inventory-observer.ts
│   │   ├── selection-engine.ts
│   │   └── reservation-monitor.ts
│   │
│   ├── popup/
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── domain/
│   │   ├── states.ts
│   │   ├── preferences.ts
│   │   └── policies.ts
│   │
│   ├── storage/
│   │   └── storage.ts
│   │
│   └── messaging/
│       └── messages.ts
└── tests/
```

---

# 4. Components

## Content Script

Responsible for:

```text
Observe page
Detect state
Read supported UI state
Execute normal page interaction
Report result
```

---

## Service Worker

Responsible for:

```text
Lifecycle
Messaging
Configuration
Notifications
State coordination
```

---

## Popup

Responsible for:

```text
Event configuration
Preferences
Arm/Stop
Status
Logs
```

---

# 5. Domain State Machine

```text
INIT
 ↓
AUTH_CHECK
 ↓
EVENT_CHECK
 ↓
READY
 ↓
ARMED
 ↓
MONITORING
 ↓
AVAILABLE_DETECTED
 ↓
SELECTING
 ↓
RESERVING
 ├── SUCCESS → HELD
 └── FAILURE → FAILURE_POLICY
                  │
                  ├── RETRY
                  └── STOP

HELD
 ↓
CHECKOUT
 ↓
PAYMENT
 ↓
CONFIRMED
```

---

# 6. Multi-account Architecture

Mỗi account tương ứng với browser profile:

```text
Account A → Chrome Profile A
Account B → Chrome Profile B
Account C → Chrome Profile C
```

Không thiết kế:

```text
One browser
+
manual cookie switching
```

vì dễ gây session contamination.

---

# 7. Account Registry

Controller có logical model:

```text
Account
├── id
├── display_name
├── profile_id
├── event_assignment
├── priority
└── status
```

Status:

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

# 8. Event Assignment

Mỗi account có thể được gán strategy:

```text
Account A
VIP → CAT1 → CAT2

Account B
CAT1 → CAT2

Account C
CAT2
```

Mục tiêu là tránh việc mọi session thực hiện cùng một hành động một cách mù quáng.

---

# 9. Multi-account Coordination

Controller có global state:

```text
GLOBAL
├── ARMED
├── RUNNING
├── SUCCESS
└── STOPPED
```

Ví dụ:

```text
A → HELD
```

thì controller phát:

```text
GLOBAL_SUCCESS
```

Các account khác:

```text
B → STOP
C → STOP
```

nếu policy yêu cầu chỉ cần một reservation thành công.

---

# 10. Stop Conditions

Một session phải dừng khi:

```text
Reservation confirmed
User manually stops
Event closed
Session expired
Rate-limit signal
Non-retryable error
Global success
```

Không có infinite retry.

---

# 11. Critical Path

Critical path:

```text
Ticketbox
    ↓
Content Script
    ↓
Selection Engine
    ↓
Normal reservation interaction
    ↓
Ticketbox server
    ↓
Reservation confirmation
```

Không:

```text
Ticketbox
    ↓
Backend
    ↓
Queue
    ↓
Worker
    ↓
Ticketbox
```

Backend chỉ phục vụ:

```text
configuration
analytics
account metadata
logs
subscription
```

---

# 12. Desktop Controller

Desktop Controller chỉ được thêm khi MVP extension đã chứng minh được flow.

Nhiệm vụ:

```text
Profile management
Account status
Event assignment
Arm all
Stop all
Global state
Logs
```

Nó không trực tiếp xử lý Ticketbox DOM.

---

# 13. Technology Stack

## Extension

```text
Manifest V3
TypeScript
Vite
React
```

## Desktop

```text
Tauri
TypeScript
React
Rust
```

## Backend — optional

```text
Laravel
PostgreSQL
```

Backend không thuộc critical reservation path.

---

# 14. Security Model

Không lưu:

```text
Password
OTP
CVV
Payment credentials
Raw session tokens
```

Authentication:

```text
User
 ↓
Ticketbox normal login
 ↓
Chrome profile session
 ↓
Extension observes usable session state
```

---

# 15. Development Phases

## Phase 0 — Documentation

```text
Product requirements
Technical discovery
Network map
State machine
Reservation boundary
Architecture
Security
```

---

## Phase 1 — Single Account Extension

Mục tiêu:

```text
One profile
One account
One event
```

Chứng minh:

```text
AVAILABLE
 ↓
SELECT
 ↓
RESERVE
 ↓
HELD
```

---

## Phase 2 — Observability

Thêm:

```text
State logging
Timestamp logging
Latency metrics
Error classification
```

---

## Phase 3 — Selection Engine

Implement:

```text
Ticket priority
Quantity
Area
Seat
Fallback
```

---

## Phase 4 — Multi-profile

```text
Profile A
Profile B
Profile C
```

Mỗi profile chạy extension độc lập.

---

## Phase 5 — Controller

Thêm:

```text
Account registry
Profile status
Arm all
Stop all
Global success
```

---

## Phase 6 — Backend

Chỉ triển khai khi có business requirement:

```text
Remote config
Analytics
Subscription
Team management
```

---

# 16. Testing Strategy

## Unit Tests

Test:

```text
Selection Engine
Preference ranking
Fallback policy
State machine
Retry policy
Stop conditions
```

## Integration Tests

Test:

```text
Extension ↔ Content Script
Content Script ↔ Page
Controller ↔ Profiles
```

## Manual Discovery Tests

Test:

```text
Normal event
Low inventory
Sold out
Session expired
Reservation failure
Checkout failure
```

Không test bằng cách spam request.

---

# 17. Implementation Gate

Không được chuyển sang automation implementation nếu chưa có:

```text
[ ] Inventory mechanism verified
[ ] Selection mechanism verified
[ ] Reservation request verified
[ ] Reservation success evidence verified
[ ] Hold expiration verified
[ ] Checkout transition verified
[ ] Failure matrix verified
```

Nếu một mục còn `TBD`:

```text
STOP IMPLEMENTATION
```

và quay lại Discovery.

---

# 18. Architecture Principles

### Principle 1

**Extension-first**

### Principle 2

**Evidence before implementation**

### Principle 3

**Server-confirmed reservation is the success boundary**

### Principle 4

**Backend is outside critical path**

### Principle 5

**Browser profiles isolate authenticated sessions**

### Principle 6

**No infinite retry**

### Principle 7

**No credential storage**

### Principle 8

**No bypass of platform security/anti-abuse controls**

---

# 19. Definition of Done

Project MVP hoàn thành khi:

```text
✓ Extension installed
✓ User logged in normally
✓ Event detected
✓ Preferences configured
✓ Inventory state detected
✓ Selection performed
✓ Reservation result detected
✓ HELD state verified
✓ Checkout handoff works
✓ Errors classified
✓ Latency measured
```

Multi-account chỉ được coi là hoàn thành khi:

```text
✓ Multiple profiles isolated
✓ Each profile independently authenticated
✓ Controller knows profile status
✓ Global stop works
✓ Global success works
✓ No session contamination
```

---

# 20. Final Architecture Decision

```text
MVP

Chrome Extension
       │
       ▼
Single Chrome Profile
       │
       ▼
Ticketbox

V2

Desktop Controller
       │
       ├── Profile A + Extension
       ├── Profile B + Extension
       └── Profile C + Extension

V3

Optional Backend
       │
       └── configuration / analytics / business features
```

Không đảo ngược thứ tự này.

**Trước hết phải chứng minh một account có thể đi qua normal purchase flow và xác định chính xác `AVAILABLE → HELD`. Sau đó mới nhân bản architecture cho nhiều profile/account.**
