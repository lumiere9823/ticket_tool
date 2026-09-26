# Multi-Account Orchestration Skill

## Purpose

This skill governs multiple legitimate user-controlled browser profiles.

The objective is account isolation and reliable orchestration.

---

## 1. Core Model

AccountProfile
    ↓
Chrome Profile
    ↓
Event Assignment
    ↓
Execution Policy
    ↓
Purchase Attempt

Each execution must retain its profile context.

---

## 2. Account Isolation

Each account should map to an isolated browser profile.

Do not share:

- cookies
- authentication sessions
- raw tokens
- credentials

between profiles.

---

## 3. Forbidden Account Switching

Do not implement account switching through:

- cookie replacement
- session extraction
- token injection
- credential copying

The preferred model is browser-profile isolation.

---

## 4. Profile Identity

Every profile should have an internal identifier.

Example:

Profile A
Profile B
Profile C

Never expose unnecessary personal information in logs.

---

## 5. Event Assignment

An event assignment should explicitly identify:

- profile
- event
- configuration
- execution policy

Example:

Profile A → Event X
Profile B → Event X
Profile C → Event X

---

## 6. Execution Policy

Policies must be explicit.

Examples:

ONE_SUCCESS

MULTIPLE_SUCCESS

Do not invent policy behavior.

---

## 7. Global Stop

A global stop operation must prevent new local automation actions.

It does not necessarily mean:

- reservation cancelled
- checkout cancelled
- payment reversed

Do not falsely report cancellation.

---

## 8. Concurrency

Concurrency must be:

- bounded
- configurable
- observable

Never increase concurrency simply because the system is slow.

Never use concurrency to bypass:

- queue controls
- rate limits
- anti-abuse mechanisms

---

## 9. Wrong Profile Protection

Before starting an attempt, validate:

- profile ID
- event assignment
- configuration
- readiness
- current browser context

A wrong-profile operation is a critical error.

---

## 10. Future Desktop Controller

A desktop controller may eventually manage:

- Chrome profiles
- extension instances
- assignments
- global state
- start/stop commands

But it is NOT part of the initial MVP unless explicitly approved.

---

## 11. IPC

If a desktop controller is introduced:

Prefer local IPC.

Do not expose an unauthenticated control API on the network.

---

## 12. Observability

Per profile expose:

- profile ID
- event assignment
- state
- attempt ID
- last error
- readiness

Never expose:

- password
- OTP
- cookies
- tokens
- payment credentials