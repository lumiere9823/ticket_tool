# Ticketbox Purchase Assistant

## Test Strategy

---

# 1. Testing Pyramid

```text
             E2E
            /   \
       Integration
          /       \
       Domain     Adapter
          \       /
             Unit
```

---

# 2. Domain Tests

Test state transitions:

```text
INIT → AUTH_CHECK
AUTH_CHECK → EVENT_CHECK
EVENT_CHECK → READY
READY → ARMED
ARMED → MONITORING
MONITORING → AVAILABLE_DETECTED
AVAILABLE_DETECTED → SELECTING
SELECTING → RESERVING
RESERVING → HELD
```

---

# 3. Invalid Transition Tests

Examples:

```text
INIT → HELD
READY → CONFIRMED
MONITORING → CONFIRMED
```

must fail.

---

# 4. Selection Tests

Given:

```text
VIP unavailable
CAT1 available
CAT2 available
```

and:

```text
VIP → CAT1 → CAT2
```

expected candidate:

```text
CAT1
```

This tests policy logic only.

---

# 5. Reservation Tests

### Rejected

```text
reservation request
↓
server rejection
```

Expected:

```text
RESERVATION_FAILED
```

### Accepted

```text
reservation request
↓
server-confirmed evidence
```

Expected:

```text
HELD
```

### Ambiguous

```text
request completed
but confirmation unknown
```

Expected:

```text
UNKNOWN
```

Not:

```text
HELD
```

---

# 6. Retry Tests

Test:

```text
retryable failure
non-retryable failure
max attempts
stop signal
rate-limit
```

---

# 7. Multi-account Tests

```text
A → HELD
B → STOPPED
C → STOPPED
```

for ONE_SUCCESS.

Also:

```text
A → FAILED
B → HELD
C → STOPPED
```

---

# 8. Profile Isolation Tests

Verify:

```text
Profile A session
≠
Profile B session
```

No shared account state.

---

# 9. Recovery Tests

Simulate:

```text
extension restart
browser restart
session expiry
network interruption
unknown state
```

System must recover safely or stop.

---

# 10. Performance Tests

Measure:

```text
observer overhead
DOM scan duration
state processing duration
message latency
selection decision latency
```

Do not optimize based on assumptions; collect measurements.

---

# 11. Security Tests

Check:

```text
no credential persistence
no sensitive logs
profile isolation
storage permissions
extension permissions
```

---

# 12. Production Gate

MVP cannot be marked production-ready unless:

```text
✓ Unit tests
✓ Integration tests
✓ State machine tests
✓ Reservation boundary tests
✓ Error tests
✓ Profile isolation tests
✓ Security review
✓ Manual normal-flow test
```
