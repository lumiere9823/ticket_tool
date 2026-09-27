# Ticketbox Purchase Assistant

## Implementation Roadmap

---

## Status Legend

- `[ ]` Not started
- `[-]` In progress
- `[x]` Complete
- `[?]` Blocked / requires discovery

---

# Phase 0 — Discovery & Architecture Freeze

**Deliverables:**

- `[x]` `00-project-overview.md`
- `[x]` `01-product-requirements.md`
- `[x]` `02-technical-discovery.md`
- `[x]` `03-network-discovery.md`
- `[x]` `04-state-machine.md`
- `[x]` `05-reservation-boundary.md`
- `[x]` `14-repository-audit.md` (Audit of contradictions, risks, and blockers)
- `[x]` `15-architecture-baseline.md` (Clean architecture freeze & content script boundary)
- `[x]` `16-technology-stack.md` (TypeScript + Vite + Vitest + npm decision)
- `[x]` `17-ticketbox-adapter-evidence.md` (Structured evidence schema & observation log)

**Gate:**

```text
AVAILABLE → HELD
```

`[?]` Live server-confirmed hold evidence requires live sale runtime observation.

---

# Phase 1 — Extension Skeleton & Core Foundation

- `[x]` Chrome Extension Manifest V3 (`public/manifest.json`)
- `[x]` Strict TypeScript configuration (`tsconfig.json`)
- `[x]` Multi-entry Vite bundler (`vite.config.ts`)
- `[x]` Service Worker (`src/extension/background/service-worker.ts`)
- `[x]` Content Script (`src/extension/content/content.ts`)
- `[x]` Native DOM Popup UI (`src/extension/popup/`)
- `[x]` Typed Message Bus (`src/extension/shared/messages.ts`, `ChromeMessageBus.ts`)
- `[x]` Storage Abstraction with Test Fallback (`ChromeStorageRepository.ts`)

---

# Phase 2 — State Observation & Pure State Machine

- `[x]` Authoritative Domain State Machine (`PurchaseStateMachine.ts`)
- `[x]` Full canonical lifecycle states:
  `INIT → AUTH_CHECK → EVENT_CHECK → READY → ARMED → MONITORING → AVAILABLE_DETECTED → SELECTING → RESERVING → HELD → CHECKOUT → PAYMENT → CONFIRMED`
- `[x]` Selection sub-states: `TICKET_TYPE_SELECTION`, `QUANTITY_SELECTION`, `SEAT_SELECTION`
- `[x]` Human Intervention first-class states: `CAPTCHA_REQUIRED`, `OTP_REQUIRED`, `PAYMENT_ACTION_REQUIRED`, `SESSION_REAUTH_REQUIRED`, `UNKNOWN_SECURITY_CHALLENGE`
- `[x]` Transitional verification state: `STATE_RECHECK` (prevents blind resume without verified page state)
- `[x]` Explicit failure & safe states (`SOLD_OUT`, `INVALID_SELECTION`, `SESSION_EXPIRED`, `RATE_LIMITED`, `RESERVATION_FAILED`, `CHECKOUT_FAILED`, `PAYMENT_FAILED`, `AUTH_FAILURE`, `UNKNOWN`)
- `[x]` Fail-safe `STOPPED` transitions from any active state
- `[x]` Action Guard policy (`ActionGuard.ts`) preventing unauthorized actions, context mismatches, or automation during security challenges
- `[x]` Strict server-confirmation evidence enforcement for `RESERVING → HELD` and `PAYMENT → CONFIRMED`
- `[x]` Human intervention persistence (`HumanInterventionRecord.ts`, `ChromeStorageRepository.ts`)
- `[x]` Service Worker rehydration safety across all critical states (`RESERVING`, `HELD`, `CHECKOUT`, `PAYMENT`)

---

# Phase 3 — Selection Engine

- `[x]` Pure domain entity `TicketPreference` (Priority list, quantity, fallback toggle)
- `[x]` Value objects: `Quantity`, `Money`, `AttemptId`, `ProfileId`
- `[x]` Deterministic policy `SelectionStrategy` (Priority matching, secondary price sort, fallback gating)
- `[x]` Comprehensive unit tests covering selection policies without DOM dependencies

---

# Phase 4 — Reservation Monitor (Critical Path)

- `[?] Blocked / requires discovery`
  - `[x]` Domain entities (`Reservation.ts`, `CandidateTicket.ts`, `HumanInterventionRecord.ts`)
  - `[x]` Reservation use case (`ExecuteReservationUseCase.ts`) with strict server-confirmation rule and `ActionGuard`
  - `[x]` Safe stub adapter (`SafeStubAdapter.ts`) that rejects unverified blind actions
  - `[?]` Live Ticketbox reservation endpoint, payload schema, and authoritative hold ID capture (Pending live sale DevTools session)

---

# Phase 5 — Checkout Handoff

- `[-] In progress`
  - `[x]` Checkout state detection in DiscoveryAdapter (`/checkout`, `/payment`)
  - `[x]` Transition from `HELD` to `CHECKOUT`
  - `[x]` Authoritative confirmation evidence guard for `PAYMENT → CONFIRMED`
  - `[ ]` Live checkout form verification on Ticketbox production

---

# Phase 6 — Observability & Telemetry

- `[x]` Structured Logging (`SanitizedLogger.ts`, `LoggerPort.ts`)
- `[x]` Automatic credential/token/cookie/CVV sanitization
- `[x]` Storage credential leak prevention in `ChromeStorageRepository.ts`
- `[x]` $T_0 \dots T_5$ Latency Tracker service (`LatencyTracker.ts`)
- `[x]` Attempt correlation tracking (`AttemptId`)
- `[x]` Error classification policy (`ErrorClassifier.ts`)

---

# Phase 7 — Multi-Profile Domain Preparation

- `[x]` Profile isolation entity (`AccountProfile.ts`)
- `[x]` Context & event assignment models (`AccountContext`, `EventAssignment`)
- `[x]` Context validation in `ActionGuard` (Mismatched Profile/Account/Event rejected)
- `[x]` Execution policies (`ONE_SUCCESS` vs `MULTIPLE_SUCCESS`)
- `[x]` Global stop policy (`GlobalStopPolicy.ts` with instant rate-limit broadcast)
- `[ ]` Multi-profile runtime runner (Deferred to Phase 2 per ADR-001)

---

# Phase 8 — Desktop Controller (Tauri)

- `[ ] Not started` (Deferred until single-account extension flow is verified on live events)

---

# Phase 9 — Optional Backend

- `[ ] Not started` (Strictly out of critical path per ADR-002)

---

# Phase 10 — Production Hardening & CI Quality Gates

- `[x]` Unit test suite passing 100% (66/66 tests in Vitest across 12 test suites)
- `[x]` Static typing (Zero TypeScript errors with `strict: true`)
- `[x]` Code style & linting (ESLint + Prettier checks passing)
- `[x]` Automated build pipeline (`npm run build` -> `dist/`)
- `[x]` CI script (`npm run ci`)
