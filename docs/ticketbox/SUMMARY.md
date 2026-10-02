# Ticketbox Purchase Assistant — 1-Page Summary

> Full detail lives in `docs/ticketbox/04-state-machine.md` and
> `docs/ticketbox/08-security-and-compliance.md`. This page is a map, not a
> replacement.

## What this is

A Chrome Extension (Manifest V3) that helps a user prepare, monitor, and
execute a **normal** Ticketbox ticket purchase faster — it is explicitly **not**
an auto-buy bot. `SELECTED ≠ RESERVED` and `RESERVING ≠ HELD`: every
reservation-confirming state requires authoritative server evidence, never a
DOM click outcome alone.

## Architecture (implemented)

```
Presentation (popup/*)  →  Application (use-cases/*)  →  Domain (pure TS)
                                   ↑ implements
                         Infrastructure (Chrome storage, message bus,
                         SanitizedLogger, Ticketbox DOM/API adapters)
```

- Domain layer has zero Chrome/DOM dependency; runs under plain Node/Vitest.
- Content script (`src/extension/content/content.ts`) only observes the page
  and drives the use case; it does not contain business rules itself (Rule 04).
- Service worker mirrors content-script state for popup display and
  rehydration across worker restarts, per ADR-004 (**Accepted**, and this is
  the architecture actually implemented today). ADR-008 proposes moving to an
  authoritative-service-worker / observation-only-content-script model, but
  its status is **Proposed / Architectural Blueprint** — only its Phase 1
  (rehydration hardening) has landed; `content.ts` still transitions the
  state machine directly.

## Canonical state machine (implemented)

```
INIT → AUTH_CHECK → EVENT_CHECK → READY → ARMED → MONITORING
  → AVAILABLE_DETECTED → SELECTING → ... → RESERVING → HELD
  → CHECKOUT → PAYMENT_GATE (user-driven) → CONFIRMED
```

Human-intervention states (`CAPTCHA_REQUIRED`, `OTP_REQUIRED`,
`SESSION_REAUTH_REQUIRED`, `UNKNOWN_SECURITY_CHALLENGE`,
`HUMAN_INTERVENTION_REQUIRED`, `IN_QUEUE`) can be entered from almost any active state and
always pause automation. In `IN_QUEUE` (virtual waiting room), `ActionGuard` strictly restricts
actions to `OBSERVE` and `USER_ACTION`, and all automated page reloads (zoom-thrash and 404 recovery)
are suppressed to protect queue position. `STOPPED` / `STOPPED_LIMIT_REACHED` /
`STOPPED_NO_TARGET` are fail-safe terminal states.

## Hard invariants (never change without updating this file)

1. **No blind reservation claims.** `RESERVING → HELD` and
   `PAYMENT → CONFIRMED` require a server-issued `reservationId`/`holdId` or
   `orderId`/`confirmationReference`. Click success alone is never enough.
2. **Explicit arming.** Automation never starts from `READY`; the user must
   trigger `ARM`.
3. **Bounded automation.** Every retry/poll loop has a numeric ceiling.
   Confirmed in code: `MAX_RETRIES = 8` (journey use case),
   `pollIntervalMs` floor = **1500 ms** (`MIN_POLL_INTERVAL_MS`),
   `maxDurationMinutes` default **120** / hard ceiling **240**,
   `maxAttempts` default **1000** / hard ceiling **5000**
   (`DEFAULT_PERSISTENCE_POLICY` in `src/domain/entities/ScopedPurchasePlan.ts`).
   A value of `0` or invalid input for duration/attempts does **not** mean
   unlimited — it falls back to the bounded default (see `content.ts`
   `checkLimitsAndStopIfNeeded`, comment: "T1: no unlimited execution").
4. **Payment boundary.** Automation always stops at `/payment` and
   `/checkout` and at `CONSENT_REQUIRED`; the user completes payment manually.
5. **No bypass mechanisms.** CAPTCHA, OTP, waiting rooms, and rate limiting are
   never automated around; `CAPTCHA_REQUIRED`/`OTP_REQUIRED`/rate-limit states
   halt automation until the user resolves them.
6. **Zero credential persistence.** No passwords, OTPs, CVVs, cookies, or raw
   tokens are ever written to storage or logs (`SanitizedLogger` masks
   known-sensitive keys). PII (`userProfile`) has a **24-hour** retention
   ceiling (`PII_MAX_RETENTION_MS` in `ChromeStorageRepository.ts`) and is
   purged on `CONFIRMED` / `STOP_REQUESTED` / `RESET_CONFIG_REQUESTED`, or via
   the manual "Clear PII" button.
7. **Profile isolation.** Multi-account support uses separate Chrome browser
   profiles; no cookie swapping between accounts.

## Status legend used across docs/ticketbox

- **Implemented** — exists in `src/` today and is covered by at least one test.
- **Not implemented** — described in a spec/roadmap doc but has no code yet
  (e.g. Phase 8 Desktop Controller / Tauri, optional backend).
- **BLOCKED_BY_DISCOVERY** — production Ticketbox selectors/endpoints that
  cannot be implemented until live-sale evidence is captured
  (see `docs/ticketbox/17-ticketbox-adapter-evidence.md`). Never guess these.

## Known documentation/process gaps (see `docs/CLEANUP_REPORT.md`)

- Document numbers 18–23 are each reused for two unrelated documents.
- ADR-008 (authoritative service worker state) is still only a proposed
  blueprint; make sure code changes don't get reviewed against it as if it
  were already implemented.
