# Purchase State Machine Skill

## Purpose

This skill governs the purchase lifecycle.

The state machine must be explicit, deterministic, testable, and safe.

---

## 1. Canonical Lifecycle

The conceptual lifecycle is:

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

---

## 2. Failure States

Potential failure states include:

- SOLD_OUT
- INVALID_SELECTION
- SESSION_EXPIRED
- RATE_LIMITED
- RESERVATION_FAILED
- CHECKOUT_FAILED
- PAYMENT_FAILED
- STOPPED
- UNKNOWN

Only use states that are actually defined by the project's state model.

---

## 3. Critical Semantic Rules

The following are NOT equivalent:

SELECTED != RESERVED

RESERVING != HELD

HELD != CONFIRMED

CHECKOUT != PAYMENT

PAYMENT_INITIATED != PAYMENT_CONFIRMED

A UI event must never automatically be interpreted as server confirmation.

---

## 4. Transition Requirements

Every transition requires:

- source state
- target state
- event
- validation
- evidence
- side-effect policy

Example:

MONITORING
    +
AvailabilityDetected
    ↓
AVAILABLE_DETECTED

---

## 5. Invalid Transitions

Invalid transitions must be rejected.

Example:

INIT → CONFIRMED

must not be allowed.

Another example:

MONITORING → CONFIRMED

must not be allowed unless the documented state model explicitly supports it.

---

## 6. Unknown State

UNKNOWN means:

"The system cannot safely determine the current state."

UNKNOWN must not be treated as success.

UNKNOWN must not automatically trigger another irreversible action.

---

## 7. Stop

STOPPED means no new automation actions should begin.

Stopping local automation does not imply:

- reservation cancelled
- payment cancelled
- server-side action reversed

The system must communicate this distinction clearly.

---

## 8. Retry

Retries must be governed by explicit policy.

Never create:

while (true) {
    retry();
}

Every retry needs:

- reason
- limit
- stop condition
- error classification

---

## 9. Idempotency

Every attempt must have:

attemptId

For potentially irreversible operations, ambiguous responses must not automatically cause duplicate operations.

---

## 10. Testing

Every state transition must have tests.

Minimum:

- valid transition
- invalid transition
- failure transition
- unknown state
- stop behavior
- retry boundary

---

## 11. Logging

State transitions should be observable.

Example:

{
  "attemptId": "...",
  "from": "SELECTING",
  "to": "RESERVING",
  "event": "ReservationRequested",
  "timestamp": "..."
}

Never include secrets.

---

## 12. Final Rule

If the system cannot prove that a state transition occurred, do not pretend it occurred.