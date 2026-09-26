# Ticketbox Purchase Assistant

## Error & Retry Matrix

---

# 1. Purpose

Phân biệt:

```text
retryable
non-retryable
user-action-required
global-stop
```

---

# 2. Error Categories

| Error                | Category    | Default Action    |
| -------------------- | ----------- | ----------------- |
| No inventory         | Business    | Monitor           |
| Invalid selection    | Business    | Re-select         |
| Reservation rejected | Business    | Apply policy      |
| Session expired      | Auth        | Stop / user login |
| Event not open       | Timing      | Wait              |
| Event ended          | Terminal    | Stop              |
| Rate limited         | Platform    | Stop              |
| Checkout error       | Transaction | Controlled retry  |
| Payment failed       | Payment     | User action       |
| Unknown              | Unknown     | Stop safely       |

---

# 3. Retry Rule

Không dùng:

```text
while(true)
```

Mỗi retry phải có:

```text
max_attempts
retryable_condition
stop_condition
```

---

# 4. Business Failure

Ví dụ:

```text
VIP unavailable
```

có thể:

```text
fallback → CAT1
```

nếu user đã cấu hình.

---

# 5. Rate Limit

Nếu nhận signal tương ứng:

```text
RATE_LIMITED
```

thì:

```text
STOP
```

Không tìm cách bypass.

---

# 6. Session Expiration

```text
SESSION_EXPIRED
```

→ không tự nhập credential.

UI:

```text
"Ticketbox session expired. Please log in again."
```

---

# 7. Unknown Error

```text
UNKNOWN
```

Default:

```text
STOP
LOG
NOTIFY
```

Không retry mù quáng.

---

# 8. Logging

Mỗi failure:

```text
timestamp
account
event
state
error category
request correlation if available
action
```

Không log:

```text
password
OTP
payment credentials
raw session tokens
```

---

# 9. Retry Acceptance Criteria

Một retry phải:

```text
bounded
observable
cancelable
classified
```

Không được tạo uncontrolled traffic.
