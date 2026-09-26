# Greenfield Implementation Skill

## Purpose

This skill defines how the AI agent must implement the project from zero.

---

## 1. Mandatory Workflow

Always follow:

INSPECT
  ↓
PLAN
  ↓
IMPLEMENT
  ↓
TEST
  ↓
VERIFY
  ↓
DOCUMENT
  ↓
REVIEW

Never jump directly into large-scale implementation.

---

## 2. Before Coding

Confirm:

- requirements
- architecture
- dependencies
- state machine
- security boundary
- test strategy
- unresolved TBDs

If a critical fact is unknown:

DO NOT GUESS.

Create an interface or adapter boundary.

---

## 3. TypeScript

Use strict TypeScript.

Prefer:

- explicit types
- discriminated unions
- immutable value objects where appropriate
- small modules
- cohesive responsibilities

Avoid:

- unnecessary any
- hidden global state
- magic strings
- duplicated business rules

---

## 4. Domain Isolation

Domain must not depend on:

- Chrome
- DOM
- Ticketbox
- fetch
- browser storage

Domain logic must remain independently testable.

---

## 5. Ticketbox Isolation

Ticketbox-specific code belongs behind adapters.

Do not spread:

- selectors
- endpoint paths
- response parsing
- Ticketbox error mappings

through generic application code.

---

## 6. Error Handling

Never swallow errors.

Bad:

try {
    ...
} catch {
    return true;
}

Unknown errors must never become success.

Errors should be classified.

---

## 7. Retry

No infinite retry.

Every retry requires:

- reason
- maximum attempts
- stop condition
- delay/backoff where appropriate

---

## 8. Dependencies

Install a dependency only when:

1. it solves a real requirement;
2. it fits the architecture;
3. it is maintained;
4. it does not introduce unnecessary complexity.

Do not install libraries "just in case".

---

## 9. Critical Path

Do not add unnecessary operations to time-sensitive paths.

Avoid unnecessary:

- network calls
- logging
- serialization
- storage writes
- UI updates

inside critical operations.

---

## 10. Small Changes

Prefer incremental implementation.

After meaningful changes:

typecheck
→ lint
→ test
→ build

Do not accumulate a large unverified implementation.

---

## 11. Definition of Done

A task is complete only when:

- code exists;
- tests exist;
- tests pass;
- typecheck passes;
- lint passes;
- build passes;
- documentation is updated;
- security boundaries are respected.

---

## 12. Blocked Work

When blocked by missing external evidence:

1. document the blocker;
2. identify required evidence;
3. implement safe scaffolding;
4. create interfaces;
5. continue independent work.

Never fabricate missing behavior.

---

## 13. Refactoring

Before refactoring:

- understand current behavior;
- read relevant tests;
- identify architectural boundary;
- preserve documented behavior.

Do not perform broad rewrites merely to make the code "look cleaner".

---

## 14. Agent Autonomy

The agent should continue automatically through well-defined work.

It should stop only when:

- a destructive decision requires approval;
- a critical external fact is missing;
- security implications are unclear;
- architecture conflicts cannot be resolved from existing documentation.

When stopping, explain the exact blocker and the evidence required.

---

## 15. Final Principle

Build the smallest correct system first.

Do not build speculative infrastructure.

Do not optimize unknown behavior.

Do not implement undocumented Ticketbox behavior.

Evidence first.

Architecture second.

Implementation third.

Verification always.