# Ticketbox Network Discovery

**Version:** 0.1
**Status:** Discovery Template
**Rule:** Không suy đoán endpoint. Chỉ ghi nhận evidence thực tế.

---

## 1. Objective

Xác định toàn bộ network activity liên quan đến:

```text
Event
  ↓
Inventory
  ↓
Selection
  ↓
Reservation
  ↓
Hold
  ↓
Checkout
  ↓
Payment
```

Mục tiêu cuối:

```text
NETWORK REQUEST
      ↓
BUSINESS MEANING
      ↓
STATE TRANSITION
```

---

## 2. Capture Environment

```text
Browser: Chrome
DevTools: Network

Preserve log: ON
Disable cache: ON

Capture:
- Fetch/XHR
- WebSocket
- EventStream/SSE
- Document
```

Discovery phải sử dụng tài khoản hợp lệ và normal Ticketbox flow.

---

## 3. Request Classification

Mỗi request được phân loại:

```text
EVENT
INVENTORY
SELECTION
RESERVATION
CHECKOUT
PAYMENT
AUTH
ANALYTICS
UNKNOWN
```

Không phân loại theo URL name đơn thuần.

---

## 4. Request Record

Mỗi request quan trọng phải có:

```text
Request ID:
Timestamp:
Category:
Method:
URL:
Query:
Request body:
Response status:
Response body summary:
Initiated by:
Duration:
State before:
State after:
Evidence:
Confidence:
```

---

## 5. Event Discovery

### Expected

```text
PAGE_OPEN
    ↓
EVENT_READY
```

### Capture

```text
Event identifier
Showing identifier
Sale start
Ticket types
Venue
Event status
```

### Status

```text
[TBD]
```

---

## 6. Inventory Discovery

Search request có semantic liên quan:

```text
availability
inventory
ticket
seat
showing
schedule
product
```

Nhưng URL/name không phải evidence cuối cùng.

### Questions

```text
Inventory endpoint:
[TBD]

Method:
[TBD]

Update mechanism:
[TBD]

Initial load:
[TBD]

Polling:
[TBD]

Push:
[TBD]

WebSocket:
[TBD]

SSE:
[TBD]
```

---

## 7. Inventory Update Mechanism

Phân loại:

### Model A — Polling

```text
Client
  ↓
GET inventory
  ↓
wait
  ↓
GET inventory
```

### Model B — Push

```text
Server
  ↓
WebSocket/SSE
  ↓
Client
```

### Model C — Hybrid

```text
Initial REST
+
Realtime push
```

### Result

```text
[TBD]
```

---

## 8. Selection Discovery

Action:

```text
User selects ticket
```

Capture:

```text
DOM mutation
Network request
Client state
Response
UI change
```

Determine:

```text
SELECTED
```

is:

```text
client-only
```

or:

```text
server-backed
```

---

## 9. Reservation Discovery

Critical sequence:

```text
SELECTED
    ↓
?
    ↓
HELD
```

Candidate request:

```text
[TBD]
```

Evidence:

```text
[TBD]
```

Server response:

```text
[TBD]
```

Reservation identifier:

```text
[TBD]
```

---

## 10. Reservation Evidence Requirements

A request may only be classified as reservation if evidence supports at least one meaningful server-side inventory transition.

Possible evidence:

```text
reservation ID
hold ID
checkout reference
server-confirmed ticket state
expiration timestamp
```

Exact evidence:

```text
[TBD]
```

---

## 11. Checkout Discovery

Determine:

```text
Does checkout require a reservation ID?
Does checkout create an order?
Does checkout receive a hold reference?
When does the countdown begin?
```

Result:

```text
[TBD]
```

---

## 12. Payment Discovery

Payment discovery only documents the normal flow.

Do not collect:

```text
password
OTP
CVV
payment credentials
```

Capture only:

```text
payment state
order state
success/failure transition
```

---

## 13. Network Timing

For every critical request:

```text
request_start
request_end
duration
```

Aggregate:

```text
Inventory detection
Selection
Reservation
Checkout
```

---

## 14. Final Network Map

| ID    | Category    | Request | Method | Response | State       | Confidence |
| ----- | ----------- | ------- | ------ | -------- | ----------- | ---------- |
| N-001 | EVENT       | TBD     | TBD    | TBD      | EVENT_READY | TBD        |
| N-002 | INVENTORY   | TBD     | TBD    | TBD      | AVAILABLE   | TBD        |
| N-003 | SELECTION   | TBD     | TBD    | TBD      | SELECTED    | TBD        |
| N-004 | RESERVATION | TBD     | TBD    | TBD      | HELD        | TBD        |
| N-005 | CHECKOUT    | TBD     | TBD    | TBD      | CHECKOUT    | TBD        |
| N-006 | PAYMENT     | TBD     | TBD    | TBD      | CONFIRMED   | TBD        |

---

## 15. Discovery Gate

Không được code request-level automation khi:

```text
N-004 = TBD
```

hoặc reservation semantics chưa được verified.

---

## 16. Golden Rule

> URL name is not business semantics.

Chỉ sau khi:

```text
Request
+
Response
+
Observed state transition
```

khớp nhau mới được đưa request vào architecture.
