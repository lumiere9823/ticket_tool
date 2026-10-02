# Changelog

## Unreleased — feat/timing-and-queue-safety

- Added `ServerClock` domain module and `HttpDateServerClockAdapter` for RTT-compensated server time synchronization via HTTP `Date` headers.
- Added `PrecisionContentTimer` two-stage foreground scheduler in content script (coarse setTimeout to T-300ms + requestAnimationFrame/performance.now loop) with idempotent execution.
- Added `PreWarmPurchasePlanUseCase` and `ReadinessEvaluator` for read-only pre-T0 warm-up strictly adhering to scoped target whitelists without DOM mutations.
- Extended `LatencyTracker` to measure and report server offset, RTT, clock uncertainty, and sale-opening delta in popup telemetry.
- Connected `ErrorClassifier` into runtime navigation/fetch pipeline with bounded 404 retry ceiling, backoff, and fail-safe human intervention transitions.
- Introduced first-class `IN_QUEUE` state, restricting `ActionGuard` to `OBSERVE`/`USER_ACTION`, suppressing zoom-thrash/404 reloads during queueing to preserve queue position, and rehydrating safely across worker restarts.
- Documented decisions and contracts in `ADR-009`, `04-state-machine.md`, `17-ticketbox-adapter-evidence.md`, `SUMMARY.md`, and `HUONG_DAN_SU_DUNG.md`.

## Unreleased — cleanup branch

- Removed confirmed-unused popup modules `state-display.ts` and `timer-manager.ts`.
- Removed the unused `@ui` alias from TypeScript/Vite configuration.
- Fixed 24 pre-existing TypeScript errors without changing runtime behavior.
- Added `docs/ticketbox/README.md` and `docs/ticketbox/SUMMARY.md` as documentation navigation and invariant summary.
- Corrected persistence defaults, poll interval, manifest permission documentation, and user-guide troubleshooting text.
- Added `npm run docs:check` for internal Markdown links and repository-path references.
- Hardened the Chromium CAPTCHA probe with configurable ports, build-directory validation, and guaranteed temporary-profile cleanup.

## 0.1.0

- Initial Ticketbox Purchase Assistant implementation and Manifest V3 extension workflow.
