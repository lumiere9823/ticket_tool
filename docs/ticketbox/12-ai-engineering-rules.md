# AI Engineering Rules

## Ticketbox Purchase Assistant

**Purpose:** Source of truth for Codex/AI coding agents.

---

# Rule 01 — Read Documentation First

Before modifying code, read:

```text
docs/ticketbox/00-project-overview.md
docs/ticketbox/02-technical-discovery.md
docs/ticketbox/03-network-discovery.md
docs/ticketbox/04-state-machine.md
docs/ticketbox/05-reservation-boundary.md
docs/ticketbox/11-technical-design.md
```

---

# Rule 02 — Never Invent Ticketbox APIs

Never create:

```text
/api/reserve
/api/tickets
/api/inventory
```

based on naming assumptions.

If endpoint is not discovered:

```text
TBD
```

---

# Rule 03 — Evidence Before Implementation

Before implementing a Ticketbox-specific behavior, require:

```text
observed behavior
+
captured evidence
+
documented interpretation
```

---

# Rule 04 — No Business Logic in DOM Code

Avoid:

```text
content script
 ├── DOM
 ├── business rules
 ├── retry
 ├── account policy
 └── state machine
```

Instead:

```text
DOM Adapter
    ↓
Application
    ↓
Domain
```

---

# Rule 05 — State Machine Is Authoritative

Do not infer:

```text
HELD
```

from:

```text
button text
CSS
URL
screen appearance
```

unless the state transition specification explicitly permits it.

---

# Rule 06 — Server Confirmation

Never emit:

```text
RESERVATION_CONFIRMED
```

because:

```text
click()
```

returned successfully.

---

# Rule 07 — No Infinite Automation

Forbidden:

```text
while (true)
```

for purchase/retry logic.

Every retry requires:

```text
maximum
condition
stop condition
```

---

# Rule 08 — Safe Unknown State

If:

```text
state === UNKNOWN
```

then:

```text
STOP
LOG
NOTIFY
```

unless an explicit recovery policy exists.

---

# Rule 09 — Credentials

Never store:

```text
password
OTP
CVV
payment credentials
```

in project storage.

---

# Rule 10 — Network Logging

Never log raw:

```text
Cookie
Authorization
Set-Cookie
```

or sensitive request bodies.

---

# Rule 11 — No Platform Security Bypass

Do not implement mechanisms intended to bypass:

```text
CAPTCHA
queue
rate limiting
anti-bot
authentication
access controls
```

---

# Rule 12 — Profile Isolation

Never switch accounts by manipulating cookies.

Use isolated Chrome profiles.

---

# Rule 13 — Typed Messages

All cross-component messages must use a typed schema.

Example:

```text
type Message =
    | InventoryAvailable
    | ReservationStarted
    | ReservationConfirmed
    | ReservationFailed
    | StopRequested;
```

---

# Rule 14 — Correlation

Every purchase attempt has an `attemptId`.

Logs and events must preserve it.

---

# Rule 15 — Test Before Refactor

Before modifying state-machine code:

```text
run tests
```

After modifying:

```text
run tests
```

---

# Rule 16 — Small Commits

Prefer:

```text
feat(extension): add inventory observer

feat(domain): add reservation state

test(domain): cover reservation transitions
```

rather than giant commits.

---

# Rule 17 — No Speculative Abstraction

Do not create abstractions for hypothetical future Ticketbox behavior.

Implement verified requirements first.

---

# Rule 18 — TBD Means STOP

If a requirement says:

```text
TBD
```

the agent must not silently fill it with an assumption.

Instead:

```text
document assumption
or
request discovery evidence
```

---

# Rule 19 — Critical Path Protection

No change may introduce:

```text
backend dependency
remote API dependency
unnecessary network hop
blocking operation
```

into the reservation critical path without an ADR.

---

# Rule 20 — Documentation Is Code

If implementation changes architecture/state:

```text
update docs
```

before marking task complete.

---

# Definition of Done

A feature is complete only when:

```text
implementation
+
tests
+
documentation
+
error handling
```

are all complete.
