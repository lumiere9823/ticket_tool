# Ticketbox Discovery Skill

## Purpose

This skill governs all technical discovery involving Ticketbox.

The objective is to determine actual browser, page, DOM, network, and reservation behavior from evidence before implementation.

The agent MUST NOT guess undocumented behavior.

---

## 1. Core Principle

The discovery hierarchy is:

Observation
    ↓
Evidence
    ↓
Interpretation
    ↓
Confidence
    ↓
Architecture Decision
    ↓
Implementation

Never:

Assumption
    ↓
Code
    ↓
Treat assumption as fact

---

## 2. Evidence Classification

Every discovered fact MUST have one of these classifications:

### VERIFIED

Directly observed from the actual application behavior.

### DOCUMENTED

Explicitly stated in project documentation but not independently verified.

### ASSUMPTION

A plausible interpretation that has not been verified.

### TBD

Insufficient information exists.

### BLOCKED

Implementation cannot safely continue until additional evidence is available.

Never silently upgrade:

ASSUMPTION → VERIFIED

or:

DOCUMENTED → VERIFIED

---

## 3. Discovery Workflow

When investigating unknown Ticketbox behavior:

1. Read the existing documentation.
2. Identify the exact unknown.
3. Define what evidence would resolve it.
4. Observe the normal browser flow.
5. Capture only relevant information.
6. Sanitize sensitive information.
7. Document the evidence.
8. Assign confidence.
9. Determine implementation consequences.
10. Only then implement.

---

## 4. Do Not Invent Ticketbox APIs

Never invent:

- API endpoints
- HTTP methods
- request bodies
- response schemas
- headers
- authentication mechanisms
- WebSocket behavior
- GraphQL operations
- internal identifiers

If an endpoint has not been observed or documented, mark it TBD.

---

## 5. DOM Discovery

Never invent selectors.

Prefer selectors based on:

1. stable semantic attributes
2. accessible labels
3. explicit data attributes
4. stable IDs
5. stable structural relationships

Avoid depending on:

- generated CSS class names
- framework-generated identifiers
- random hashes
- fragile DOM positions

Every production selector must have evidence.

---

## 6. Reservation Semantics

The following states are fundamentally different:

CLICKED
!=
SELECTED
!=
RESERVING
!=
RESERVED
!=
HELD
!=
CONFIRMED

A successful click does not mean a ticket is reserved.

A successful HTTP request does not automatically mean a ticket is reserved.

A visible UI change does not automatically mean a ticket is reserved.

Reservation success requires authoritative evidence from the normal application flow.

---

## 7. Network Discovery

When network behavior is investigated, document:

- request method
- hostname
- path
- status code
- timing
- request purpose
- response purpose
- correlation with UI state

Do NOT collect or persist:

- passwords
- OTP
- CVV
- payment credentials
- authorization tokens
- session tokens
- raw cookies
- unnecessary personal information

---

## 8. Timing Discovery

When timing is relevant, distinguish:

T0 = authoritative availability event

T1 = local observation

T2 = local processing

T3 = selection initiation

T4 = reservation initiation

T5 = reservation response

T6 = server-confirmed result

If T0 cannot be established, explicitly mark it as estimated or unavailable.

Never present local observation time as authoritative server availability time.

---

## 9. Evidence Document

Important discoveries MUST be recorded using:

### Observation

What was observed.

### Evidence

What directly supports the observation.

### Interpretation

What the observation appears to mean.

### Confidence

One of:

- VERIFIED
- DOCUMENTED
- ASSUMPTION
- TBD
- BLOCKED

### Implementation Consequence

What code can safely depend on.

---

## 10. Discovery Safety

Stop or pause discovery when:

- authentication expires
- rate limiting appears
- anti-abuse behavior appears
- CAPTCHA is presented
- state becomes ambiguous
- sensitive information would need to be captured

Do not bypass these controls.

Do not attempt to defeat:

- CAPTCHA
- rate limits
- authentication
- anti-bot controls
- queue controls
- access controls

---

## 11. Discovery Output

Discovery should produce:

docs/ticketbox/17-ticketbox-adapter-evidence.md

and, when necessary:

- additional ADRs
- updated technical design
- updated network discovery
- updated state machine

Never hide discoveries only inside source code.

---

## 12. Final Rule

When uncertain:

DO NOT GUESS.

Document the uncertainty.

Create an interface.

Continue with work that does not depend on the missing evidence.