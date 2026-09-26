# Ticketbox Purchase Assistant

## Product Requirements Document (PRD)

**Version:** 1.0
**Status:** Draft for Technical Discovery
**Product Type:** Browser-based purchase assistant
**Primary Client:** Chrome Extension
**Optional Client:** Desktop Controller
**Target Platform:** Ticketbox Web

---

# 1. Document Purpose

Tài liệu này định nghĩa:

- vấn đề sản phẩm;
- người dùng mục tiêu;
- product scope;
- functional requirements;
- non-functional requirements;
- user journeys;
- business rules;
- success criteria;
- MVP boundary.

Tài liệu này là nguồn tham chiếu cho BA, Developer, QA và AI Agent.

---

# 2. Product Definition

Ticketbox Purchase Assistant là công cụ hỗ trợ người dùng chuẩn bị và thực hiện quy trình mua vé trên Ticketbox thông qua browser session hợp lệ của người dùng.

Mục tiêu cốt lõi:

> Giảm thời gian và số thao tác cần thiết trong critical purchase flow, đồng thời giữ nguyên các bước xác thực và kiểm soát của nền tảng.

Product không được định nghĩa là:

- bot bypass;
- CAPTCHA solver;
- queue bypass;
- anti-bot bypass;
- credential automation;
- request flooding tool.

---

# 3. Problem Statement

Trong các event có nhu cầu cao, nhiều người dùng phải thực hiện liên tiếp:

```text
Open event
    ↓
Wait
    ↓
Detect availability
    ↓
Choose ticket
    ↓
Choose quantity
    ↓
Reserve
    ↓
Checkout
```

Thời gian phản ứng của người dùng và số lượng thao tác thủ công có thể ảnh hưởng đến khả năng hoàn thành normal purchase flow.

Product giải quyết phần:

```text
Preparation
+
Observation
+
Decision
+
Normal interaction
+
Result detection
```

---

# 4. Target Users

## 4.1 Individual User

Người dùng mua vé cho chính mình.

Needs:

```text
event preparation
ticket preferences
automatic state observation
quick selection
reservation status
```

---

## 4.2 Power User

Người dùng thường xuyên tham gia các event mở bán nhanh.

Needs:

```text
multiple configurations
multiple browser profiles
predefined preferences
detailed logs
latency information
```

---

## 4.3 Multi-account Operator

Người dùng hợp pháp quản lý nhiều account/browser profiles.

Needs:

```text
profile management
account status
event assignment
global start
global stop
reservation status
```

---

# 5. Product Goals

## G-01 — Preparation

User có thể chuẩn bị event và preference trước thời điểm mở bán.

## G-02 — Observation

System phát hiện các state thay đổi có liên quan đến purchase flow.

## G-03 — Decision

System áp dụng preference đã được user cấu hình.

## G-04 — Execution

System thực hiện các interaction nằm trong normal browser purchase flow.

## G-05 — Confirmation

System phân biệt rõ:

```text
selected
```

với:

```text
server-confirmed reservation
```

## G-06 — Multi-profile

System có thể quản lý các browser profiles độc lập.

## G-07 — Observability

System cung cấp lifecycle và latency information.

---

# 6. Non-Goals

Product không bao gồm:

```text
CAPTCHA solving
Queue bypass
Rate-limit bypass
Anti-bot bypass
Authentication bypass
Session theft
Credential harvesting
Payment credential automation
Unlimited request retry
```

Không xây dựng logic nhằm làm suy yếu security/control mechanisms của Ticketbox.

---

# 7. User Journey

## Journey A — Single Account

```text
INSTALL
   ↓
OPEN CHROME
   ↓
LOGIN TO TICKETBOX
   ↓
OPEN EVENT
   ↓
CONFIGURE PREFERENCES
   ↓
ARM
   ↓
MONITOR
   ↓
AVAILABILITY
   ↓
SELECT
   ↓
RESERVE
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

# 8. User Journey — Multi Account

```text
Controller
    ↓
Load Profiles
    ↓
Check Status
    ↓
Assign Event
    ↓
Assign Strategy
    ↓
ARM
    ↓
┌──────────────┬──────────────┬──────────────┐
│ Profile A    │ Profile B    │ Profile C    │
│              │              │              │
│ Monitoring   │ Monitoring   │ Monitoring   │
└──────┬───────┴──────┬───────┴──────┬───────┘
       │               │              │
       ▼               ▼              ▼
    Attempt         Attempt        Attempt
       │               │              │
       └───────────────┼──────────────┘
                       ↓
                Global Coordinator
```

---

# 9. Functional Requirements

## FR-001 — Event Configuration

User MUST be able to configure target event.

Minimum:

```text
event
event URL/reference
```

---

## FR-002 — Ticket Quantity

User MUST be able to configure desired quantity.

System MUST validate configured quantity against constraints exposed by the normal Ticketbox flow.

---

## FR-003 — Ticket Preference

User MUST be able to define ticket preference.

Example:

```text
Priority 1 → VIP
Priority 2 → CAT1
Priority 3 → CAT2
```

---

## FR-004 — Fallback Strategy

User MAY configure fallback:

```text
VIP unavailable
    ↓
CAT1
    ↓
CAT2
```

Fallback MUST stop when no valid candidate remains.

---

## FR-005 — Availability Observation

System MUST observe relevant availability signals exposed through the normal application.

System MUST NOT assume an inventory endpoint without discovery evidence.

---

## FR-006 — Selection

System MUST select according to configured policy.

Selection policy MUST be deterministic for the same:

```text
input
+
inventory
+
configuration
```

---

## FR-007 — Reservation Attempt

System MAY initiate the normal reservation interaction after a valid candidate is identified.

Reservation implementation depends on verified technical discovery.

---

## FR-008 — Reservation Confirmation

System MUST distinguish:

```text
reservation_attempted
```

from:

```text
reservation_confirmed
```

`reservation_confirmed` requires server-side evidence.

---

## FR-009 — Hold State

System MUST expose:

```text
HELD
```

only when reservation confirmation criteria are satisfied.

---

## FR-010 — Checkout

After successful reservation, system MUST identify when checkout becomes available.

---

## FR-011 — Payment

MVP MUST NOT store or collect payment credentials.

Payment MAY remain user-driven.

---

## FR-012 — Stop

User MUST be able to stop the assistant.

Stop must propagate to all active execution components within the supported architecture.

---

## FR-013 — Status

User MUST be able to see:

```text
NOT_READY
READY
ARMED
MONITORING
AVAILABLE
SELECTING
RESERVING
HELD
CHECKOUT
CONFIRMED
FAILED
STOPPED
```

---

## FR-014 — Logging

System MUST log non-sensitive lifecycle events.

Example:

```text
23:00:01 MONITORING
23:00:04 AVAILABLE_DETECTED
23:00:04 SELECTING
23:00:04 RESERVING
23:00:05 RESERVATION_CONFIRMED
```

---

# 10. Multi-account Requirements

## FR-020 — Profile Isolation

Each account MUST run in its own browser profile.

```text
Account A → Profile A
Account B → Profile B
```

---

## FR-021 — Profile Status

Controller MUST show:

```text
READY
NOT_READY
SESSION_EXPIRED
RUNNING
HELD
FAILED
STOPPED
```

---

## FR-022 — Event Assignment

Each profile MAY have an independent event/strategy assignment.

---

## FR-023 — Global Start

Controller MAY start all configured profiles.

---

## FR-024 — Global Stop

Controller MUST support global stop.

---

## FR-025 — Success Policy

Controller MUST support an explicit global policy.

Example:

```text
ONE_SUCCESS
```

or:

```text
MULTIPLE_SUCCESS
```

The policy must be configured before execution.

---

# 11. State Requirements

System MUST maintain explicit state.

Canonical lifecycle:

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
 ↓
HELD
 ↓
CHECKOUT
 ↓
PAYMENT
 ↓
CONFIRMED
```

Failure:

```text
FAILURE
├── SOLD_OUT
├── INVALID_SELECTION
├── SESSION_EXPIRED
├── RATE_LIMITED
├── RESERVATION_FAILED
├── CHECKOUT_FAILED
├── PAYMENT_FAILED
└── UNKNOWN
```

---

# 12. Business Rules

## BR-001

`SELECTED` does not mean `RESERVED`.

## BR-002

`RESERVING` does not mean `HELD`.

## BR-003

`HELD` requires server-confirmed evidence.

## BR-004

Unknown state MUST NOT trigger another purchase action automatically.

## BR-005

Retry MUST be bounded.

## BR-006

Rate-limit signals MUST NOT trigger bypass behavior.

## BR-007

Session expiration MUST NOT trigger credential harvesting or automated credential entry.

## BR-008

Payment credentials are outside MVP storage.

## BR-009

One profile represents one isolated authenticated browser context.

## BR-010

Backend services MUST NOT be inserted into the reservation critical path without an architecture decision.

---

# 13. Non-Functional Requirements

## NFR-001 — Responsiveness

Extension processing should introduce minimal unnecessary delay in the critical path.

Performance must be measured rather than assumed.

---

## NFR-002 — Reliability

Unknown application state must fail safely.

---

## NFR-003 — Recoverability

Browser/extension restart must not automatically trigger uncontrolled purchase actions.

---

## NFR-004 — Security

Sensitive credentials and authentication material MUST NOT be persisted by the product.

---

## NFR-005 — Observability

Every critical state transition should have:

```text
timestamp
state
event
attempt ID
```

---

## NFR-006 — Maintainability

Ticketbox-specific DOM/network logic MUST be isolated behind adapters.

---

## NFR-007 — Testability

Domain rules MUST be testable without requiring a live Ticketbox session.

---

# 14. Performance Model

Measure:

```text
T0 = authoritative availability signal
T1 = local detection
T2 = selection decision
T3 = reservation initiation
T4 = reservation response
T5 = server-confirmed hold
```

Metrics:

```text
Detection latency = T1 - T0

Decision latency = T2 - T1

Action latency = T3 - T2

Reservation latency = T4 - T3

Confirmation latency = T5 - T4

Total critical latency = T5 - T0
```

Where Ticketbox does not expose an authoritative `T0`, use the best observable signal and mark the metric accordingly.

---

# 15. Success Criteria

MVP succeeds when a user can:

```text
1. Login normally
2. Configure an event
3. Configure ticket preferences
4. Arm assistant
5. Observe availability
6. Apply selection policy
7. Enter reservation flow
8. Detect server-confirmed reservation
9. Reach checkout
10. Stop safely
```

Multi-account milestone succeeds when:

```text
1. Profiles are isolated
2. Profiles can be configured independently
3. Controller can monitor all profiles
4. Global stop works
5. Global success policy works
6. No credentials are exposed
```

---

# 16. Acceptance Criteria

## AC-001

Given an authenticated Ticketbox session:

```text
WHEN
event is configured

THEN
assistant enters READY state.
```

## AC-002

Given valid ticket inventory:

```text
WHEN
availability is detected

THEN
selection policy is evaluated.
```

## AC-003

Given selection succeeds:

```text
WHEN
reservation is attempted

THEN
state becomes RESERVING.
```

## AC-004

Given server rejects reservation:

```text
THEN
state becomes RESERVATION_FAILED.
```

## AC-005

Given server confirms reservation:

```text
THEN
state becomes HELD.
```

## AC-006

Given UI changes but server confirmation is absent:

```text
THEN
state MUST NOT become HELD.
```

## AC-007

Given user presses STOP:

```text
THEN
new purchase actions MUST NOT be initiated.
```

## AC-008

Given rate limiting is detected:

```text
THEN
system stops according to platform-safe policy.
```

---

# 17. MVP Scope

### Included

```text
Chrome Extension
Event configuration
Ticket preferences
Availability observation
Selection engine
Reservation state detection
Checkout handoff
Local status
Local non-sensitive logging
Single account
```

### Phase 2

```text
Multiple Chrome profiles
Desktop Controller
Global coordination
```

### Phase 3

```text
Optional backend
Analytics
Remote configuration
Team features
```

---

# 18. Out of Scope

```text
Payment credential storage
CAPTCHA solving
Queue bypass
Anti-bot bypass
Rate-limit bypass
Credential extraction
Session theft
Unlimited retry
Undocumented private API dependency
```

---

# 19. Product Principles

### P-001

> Preparation before execution.

### P-002

> Server-confirmed reservation is the meaningful purchase boundary.

### P-003

> Evidence before automation.

### P-004

> User controls ARM and STOP.

### P-005

> Unknown state fails safely.

### P-006

> Multi-account is orchestration, not security-control bypass.

### P-007

> Critical path should remain as short as practical.

---

# 20. Definition of Done

Product requirement is considered implemented only when:

```text
Requirement
+
Implementation
+
Test
+
Documentation
```

all exist.

No feature is complete solely because the UI appears to work.
