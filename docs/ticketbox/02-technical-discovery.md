# Ticketbox Technical Discovery

## Inventory → Selection → Reservation → Hold → Checkout

**Version:** 0.1
**Status:** Discovery
**Rule:** Evidence first, no assumed endpoint

---

# 1. Discovery Objective

Xác định chính xác flow thực tế:

```text
EVENT
  ↓
INVENTORY
  ↓
SELECTION
  ↓
RESERVATION
  ↓
HOLD
  ↓
CHECKOUT
  ↓
PAYMENT
  ↓
CONFIRMED
```

Đặc biệt phải xác định:

```text
AVAILABLE
    ↓
     ?
    ↓
HELD
```

Dấu `?` phải được thay bằng request/state transition có evidence thực tế.

---

# 2. Evidence Levels

Mỗi phát hiện phải được đánh dấu:

### VERIFIED

Đã quan sát trực tiếp trên browser hoặc có source chính thức.

### OBSERVED

Đã capture từ DevTools nhưng chưa hiểu đầy đủ semantics.

### HYPOTHESIS

Giả thuyết cần kiểm chứng.

### TBD

Chưa có đủ dữ liệu.

Không được biến:

```text
HYPOTHESIS
```

thành:

```text
FACT
```

trong architecture.

---

# 3. Discovery Environment

```text
Browser:
Chrome

Tools:
Chrome DevTools

Network:
Fetch/XHR
WebSocket
SSE
Document

DevTools:
Preserve log = ON
Disable cache = ON
```

Discovery phải thực hiện bằng account hợp lệ và normal Ticketbox flow.

---

# 4. Checkpoint A — Event

Action:

```text
Open Event
```

Capture:

```text
URL
Event ID
Showing ID
Event metadata
Sale start
Ticket categories
Quantity limits
```

Network:

```text
Document
Fetch/XHR
GraphQL
WebSocket
SSE
```

Result:

```text
EVENT_READY
```

---

# 5. Checkpoint B — Inventory

Sau khi event load:

Tìm request liên quan:

```text
inventory
availability
ticket
seat
showing
schedule
product
```

Không kết luận chỉ dựa trên endpoint name.

Phải capture:

```text
Method
URL
Headers relevant to application flow
Query
Body
Status
Response
Timing
```

---

# 6. Inventory Questions

Phải trả lời:

```text
Q1. Inventory load khi nào?

Q2. Inventory có polling không?

Q3. Inventory có push không?

Q4. Có WebSocket không?

Q5. Có SSE không?

Q6. Seat-level availability có tồn tại không?

Q7. Ticket-category availability có tồn tại không?

Q8. Availability response có TTL không?
```

---

# 7. Checkpoint C — Selection

Thực hiện selection bằng UI bình thường.

Capture:

```text
Before click
Click
Network
After click
UI state
```

Có hai khả năng.

### Case A — Client-only

```text
Click
 ↓
No network
 ↓
Local UI state
```

Kết luận:

```text
SELECTED ≠ RESERVED
```

### Case B — Server interaction

```text
Click
 ↓
Request
 ↓
Response
 ↓
State change
```

Phải xác định request đó là:

```text
validation
availability check
selection
reservation
```

không được tự gọi nó là reservation.

---

# 8. Checkpoint D — Reservation

Đây là critical checkpoint.

Cần tìm:

```text
Selection
    ↓
Request
    ↓
Response
    ↓
Inventory state changes
    ↓
Hold / checkout state
```

Reservation request phải được chứng minh bằng nhiều evidence.

Một request có tên:

```text
/reserve
```

không tự động có nghĩa nó tạo reservation.

---

# 9. Reservation Evidence

Evidence có thể bao gồm:

```text
Reservation ID
Hold ID
Order ID
Checkout reference
Server-confirmed state
Expiration timestamp
Countdown based on server state
```

Exact evidence:

```text
TBD
```

cho đến khi capture thực tế.

---

# 10. Reservation Boundary

Canonical model:

```text
AVAILABLE
    │
    │ reservation operation
    ▼
┌─────────────────────┐
│ SERVER ACCEPTS      │
│ INVENTORY HOLD      │
└──────────┬──────────┘
           │
           ▼
         HELD
```

Boundary này phải được ghi vào:

```text
docs/ticketbox/05-reservation-boundary.md
```

sau khi verified.

---

# 11. Hold

Một số Ticketbox event công bố thời gian giữ vé, nhưng không được hard-code một duration global.

Canonical model:

```text
HELD
 ├── reservation_id
 ├── expires_at
 └── checkout_reference
```

Nếu server cung cấp:

```text
expires_at
```

thì dùng server value.

Không tự suy diễn:

```text
expires_at = local_now + 15 minutes
```

---

# 12. Checkpoint E — Checkout

Sau khi hold được xác nhận:

```text
HELD
 ↓
CHECKOUT
```

Capture:

```text
URL
Request
Response
Order reference
Reservation reference
Expiration
```

Phải xác định:

```text
Order created before payment?
```

hay:

```text
Order created after payment?
```

---

# 13. Checkpoint F — Payment

Không tự động hóa payment credentials trong MVP.

Chỉ cần xác định:

```text
PAYMENT_STARTED
       ↓
PAYMENT_SUCCESS
       ↓
ORDER_CONFIRMED
```

---

# 14. Latency Instrumentation

Mỗi flow phải ghi:

```text
T0 = availability detected / authoritative availability timestamp if available
T1 = extension detects state
T2 = selection decision
T3 = reservation action
T4 = reservation response
T5 = server-confirmed hold
T6 = checkout ready
```

Metrics:

```text
Detection = T1 - T0
Decision = T2 - T1
Action = T3 - T2
Reservation = T4 - T3
Confirmation = T5 - T4
Total = T5 - T0
```

---

# 15. Network Map Template

| Step | Action     | Request | Method | Response | State       | Status |
| ---- | ---------- | ------- | ------ | -------- | ----------- | ------ |
| A    | Event load | TBD     | TBD    | TBD      | EVENT_READY | TBD    |
| B    | Inventory  | TBD     | TBD    | TBD      | AVAILABLE   | TBD    |
| C    | Select     | TBD     | TBD    | TBD      | SELECTED    | TBD    |
| D    | Reserve    | TBD     | TBD    | TBD      | HELD        | TBD    |
| E    | Checkout   | TBD     | TBD    | TBD      | CHECKOUT    | TBD    |
| F    | Payment    | TBD     | TBD    | TBD      | CONFIRMED   | TBD    |

Không điền guessed endpoint.

---

# 16. Failure Discovery

Capture responses cho:

```text
Sold out
Invalid selection
Session expired
Reservation failed
Checkout failed
Payment failed
Rate limited
Unknown error
```

Mỗi failure cần:

```text
Request
HTTP status
Response code
UI message
State transition
Retryable?
```

---

# 17. Discovery Completion Criteria

Discovery chỉ complete khi xác định được:

```text
✓ Inventory source
✓ Inventory update mechanism
✓ Selection mechanism
✓ Reservation request
✓ Reservation success evidence
✓ Hold expiration source
✓ Checkout transition
✓ Failure states
✓ Rate-limit behavior
✓ Critical latency
```

Đặc biệt:

```text
AVAILABLE
    ↓
RESERVATION REQUEST
    ↓
SERVER RESPONSE
    ↓
HELD
```

phải có evidence.

---

# 18. Golden Rule

Không code automation dựa trên:

```text
URL guessing
Endpoint guessing
DOM guessing
Response guessing
```

Chỉ code dựa trên:

```text
Observed behavior
+
Captured evidence
+
Documented state transition
```
