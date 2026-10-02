# docs/ticketbox — Documentation Index

This is the authoritative table of contents for all Ticketbox Purchase Assistant
engineering documentation. For a one-page overview of architecture, states,
invariants, and the payment boundary, read **[SUMMARY.md](SUMMARY.md)** first.

> **Known issue:** document numbers `18` through `23` are each used twice for
> two unrelated documents (see "Numbering collisions" at the bottom). This is
> a pre-existing inconsistency, not fixed by renaming in this pass — renaming
> would require updating every cross-reference across `docs/`, `AGENTS.md`,
> and `README.md`. Flagged in `docs/CLEANUP_REPORT.md` for a deliberate
> decision rather than an automatic rename.

## Core Specification (00–13)

| #   | Document                                                               | Purpose                                                                                                     |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 00  | [00-project-overview.md](00-project-overview.md)                       | Product definition, goals, non-goals, core user journey                                                     |
| 01  | [01-product-requirements.md](01-product-requirements.md)               | Full product requirements                                                                                   |
| 02  | [02-technical-discovery.md](02-technical-discovery.md)                 | Technical discovery notes on Ticketbox platform behavior                                                    |
| 03  | [03-network-discovery.md](03-network-discovery.md)                     | Captured/observed network behavior                                                                          |
| 04  | [04-state-machine.md](04-state-machine.md)                             | **Authoritative** state machine specification (very long; has its own ToC)                                  |
| 05  | [05-reservation-boundary.md](05-reservation-boundary.md)               | `SELECTED ≠ RESERVED`, `RESERVING ≠ HELD` boundary rules                                                    |
| 06  | [06-multi-account-orchestration.md](06-multi-account-orchestration.md) | Multi-profile / multi-account design                                                                        |
| 07  | [07-extension-architecture.md](07-extension-architecture.md)           | Original extension architecture (superseded in part by `15-architecture-baseline.md`)                       |
| 08  | [08-security-and-compliance.md](08-security-and-compliance.md)         | **Authoritative** security & compliance specification (very long; has its own ToC)                          |
| 09  | [09-error-and-retry-matrix.md](09-error-and-retry-matrix.md)           | Error classification and retry/backoff matrix                                                               |
| 10  | [10-implementation-roadmap.md](10-implementation-roadmap.md)           | Phase-by-phase implementation roadmap and status                                                            |
| 11  | [11-technical-design.md](11-technical-design.md)                       | Technical design notes                                                                                      |
| 12  | [12-ai-engineering-rules.md](12-ai-engineering-rules.md)               | **Source of truth** for AI coding agent rules (`AI_ENGINEERING_RULES.md` at repo root is a pointer/summary) |
| 13  | [13-test-strategy.md](13-test-strategy.md)                             | Test pyramid and strategy                                                                                   |

## Baseline, Evidence & Technology (14–17)

| #   | Document                                                             | Purpose                                                                            |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 14  | [14-repository-audit.md](14-repository-audit.md)                     | Phase 0 audit of contradictions/risks/blockers                                     |
| 15  | [15-architecture-baseline.md](15-architecture-baseline.md)           | Frozen architecture baseline (layering, topology)                                  |
| 16  | [16-technology-stack.md](16-technology-stack.md)                     | Technology choices, Manifest V3 permissions strategy                               |
| 17  | [17-ticketbox-adapter-evidence.md](17-ticketbox-adapter-evidence.md) | Structured evidence log (`VERIFIED` / `OBSERVED` / `TBD` / `BLOCKED_BY_DISCOVERY`) |

## Numbers 18–23 (two unrelated tracks share each number — see note above)

**Catalog / journey / system-status track:**

| #   | Document                                                                               | Purpose                                                                    |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 18  | [18-ticket-catalog-discovery.md](18-ticket-catalog-discovery.md)                       | Ticket catalog, availability & quantity discovery (implemented)            |
| 19  | [19-booking-journey-gap-report.md](19-booking-journey-gap-report.md)                   | Gap analysis: booking journey & selection architecture                     |
| 20  | [20-system-status-and-open-challenges.md](20-system-status-and-open-challenges.md)     | System status snapshot and open technical challenges                       |
| 21  | [21-detailed-system-and-operation-guide.md](21-detailed-system-and-operation-guide.md) | Full technical + operations guide (Vietnamese)                             |
| 22  | [22-scoped-persistent-purchase.md](22-scoped-persistent-purchase.md)                   | Scoped Purchase Plan / persistent-purchase business rules (BR-S01..BR-S10) |
| 23  | [23-remediation-report.md](23-remediation-report.md)                                   | Remediation & verification report                                          |

**Performance / latency track (`TB-PERF-0xx` document IDs):**

| #   | Document                                                                         | Purpose                                          |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| 18  | [18-performance-audit.md](18-performance-audit.md)                               | Performance audit baseline                       |
| 19  | [19-performance-hotspots.md](19-performance-hotspots.md)                         | Hotspot/bottleneck ranking                       |
| 20  | [20-performance-results.md](20-performance-results.md)                           | Performance results & critical-path optimization |
| 21  | [21-runtime-latency-map.md](21-runtime-latency-map.md)                           | Full runtime latency/timer/IPC inventory         |
| 22  | [22-event-to-reservation-audit.md](22-event-to-reservation-audit.md)             | `T_EVENT → T_RESERVATION` pipeline audit         |
| 23  | [23-real-runtime-performance-results.md](23-real-runtime-performance-results.md) | Real browser-runtime measured results            |

## Architecture Decision Records

| ADR                                                                           | Title                                                                | Status                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](decisions/ADR-001-extension-first.md)                               | Extension-first execution client                                     | Accepted                                                                                                                                                                                                                                    |
| [ADR-002](decisions/ADR-002-critical-path.md)                                 | Local-only critical reservation path                                 | Accepted                                                                                                                                                                                                                                    |
| [ADR-003](decisions/ADR-003-multi-profile-architecture.md)                    | Multi-profile account isolation                                      | Accepted                                                                                                                                                                                                                                    |
| [ADR-004](decisions/ADR-004-state-machine-single-source-of-truth.md)          | State machine single source of truth                                 | Accepted — matches current implementation (content script owns the journey state machine; service worker mirrors it)                                                                                                                        |
| [ADR-005](decisions/ADR-005-phase-3-security-and-privacy.md)                  | Phase 3 security & privacy hardening                                 | Accepted                                                                                                                                                                                                                                    |
| [ADR-006](decisions/ADR-006-state-machine-invariants-and-audit.md)            | State machine invariants & audit                                     | Accepted                                                                                                                                                                                                                                    |
| [ADR-007](decisions/ADR-007-booking-journey-and-form-autofill-reliability.md) | Booking journey & form-autofill reliability                          | Accepted                                                                                                                                                                                                                                    |
| [ADR-008](decisions/ADR-008-authoritative-service-worker-state.md)            | Authoritative service worker state (observation-only content script) | **Proposed / Architectural Blueprint — NOT implemented.** `content.ts` still calls `stateMachine.transition()` directly today (ADR-004 / Option A remains the actual baseline); only Phase 1 (rehydration hardening) of ADR-008 has landed. |

## Root-level documents

- [`/README.md`](../../README.md) — repository overview, setup, dev workflow.
- [`/HUONG_DAN_SU_DUNG.md`](../../HUONG_DAN_SU_DUNG.md) — Vietnamese end-user guide for the popup UI.
- [`/AGENTS.md`](../../AGENTS.md) — agent operating context and pointers to this directory.
- [`/AI_ENGINEERING_RULES.md`](../../AI_ENGINEERING_RULES.md) — summary that points to `12-ai-engineering-rules.md`.
- [`/CHANGELOG.md`](../../CHANGELOG.md) — notable changes, including this cleanup pass.
- [`/docs/CLEANUP_REPORT.md`](../CLEANUP_REPORT.md) — report for the `chore/cleanup` branch.
