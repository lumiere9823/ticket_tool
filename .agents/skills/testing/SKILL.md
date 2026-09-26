# Testing Strategy Skill

## Purpose

Testing must make the architecture safe to change.

Most tests must not require a live Ticketbox session.

---

## 1. Test Pyramid

### Unit

Test:

- domain entities
- value objects
- state machine
- selection policies
- retry policy
- error classification
- message validation

### Integration

Test:

- extension messaging
- storage abstraction
- application use cases
- adapter contracts

### Browser / E2E

Use browser tests only where browser behavior is actually being tested.

Keep live-site dependencies isolated.

---

## 2. Domain Tests

Domain tests must not require:

- Chrome
- browser
- network
- Ticketbox
- real credentials

---

## 3. State Machine Tests

For every transition test:

- valid transition
- invalid transition
- failure transition
- unknown state
- stop behavior

---

## 4. Security Tests

Test:

- secret redaction
- invalid messages
- invalid transitions
- forbidden persistence
- permission assumptions where practical

---

## 5. Adapter Tests

Ticketbox adapter tests should use:

- fixtures
- mocks
- deterministic HTML
- deterministic responses

Do not make every test depend on live Ticketbox.

---

## 6. Timing Tests

Avoid arbitrary sleeps.

Prefer observable conditions.

Bad:

await sleep(3000);

Better:

await waitFor(() => state === EXPECTED_STATE);

---

## 7. Regression Tests

Every production bug should produce a regression test.

Bug:

"Reservation response was interpreted as confirmation."

Required response:

1. reproduce;
2. add regression test;
3. fix;
4. verify test;
5. document behavior.

---

## 8. Quality Gates

Before declaring a task complete:

- typecheck passes
- lint passes
- tests pass
- build passes
- relevant documentation is updated

---

## 9. Determinism

Tests must be reproducible.

Avoid:

- random external state
- live inventory
- live account
- uncontrolled timing
- arbitrary delays

unless the test explicitly exists to test those behaviors.

---

## 10. Definition of Done

A feature is not complete merely because the UI works.

It requires:

implementation
+
tests
+
quality gates
+
documentation
+
security review where applicable