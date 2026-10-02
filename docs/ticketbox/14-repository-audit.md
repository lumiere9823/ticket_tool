# Ticketbox Purchase Assistant — Repository & Documentation Audit

**Audit Date:** 2026-09-26  
**Auditor:** Lead Software Architect, Senior TypeScript Engineer, Security Engineer, QA Engineer, Technical Product Engineer  
**Status:** Complete  
**Scope:** Complete repository audit of `docs/ticketbox/`, `docs/ticketbox/decisions/`, `.agents/skills/`, and implementation readiness.

---

## 1. Executive Summary & Current Repository State

The repository currently exists in a **documentation-first greenfield state**:

- **Source Code at the time of this audit:** The repository was documentation-first; the current production code now lives under `src/` (notably `src/extension/content/`).
- **Environment:** Node.js `v24.11.1`, npm `11.6.4`, Windows OS, PowerShell shell. Package manager `pnpm` is not installed; `npm` is the verified available package manager.
- **Git Repository:** Not yet initialized as a git repo (`fatal: not a git repository`).
- **Existing Documentation:** 14 documentation files under `docs/ticketbox/`, 3 Architecture Decision Records (ADRs) under `docs/ticketbox/decisions/`, and 8 agent skill definitions under `.agents/skills/`.

The documentation establishes sound foundational principles (Extension-First, Critical Path Isolation, Profile Isolation, Server-Confirmed Reservation Boundary, Platform-Safe Operation). However, our audit revealed **critical contradictions, structural inconsistencies, architectural layer violations, and premature assumptions** that must be resolved before scaffolding and implementing code.

---

## 2. Requirement Classification Matrix

Every requirement and assumption in the documentation has been evaluated and classified into four categories:

1. **VERIFIED:** Formally confirmed by project scope, platform architectural limits (e.g. Chrome MV3 specs), or accepted ADRs.
2. **DOCUMENTED ASSUMPTION:** An explicit design hypothesis documented as intentional direction, but subject to validation.
3. **TBD:** A recognized gap in the specification that has not yet been designed or determined.
4. **REQUIRES DISCOVERY:** An assumption about external Ticketbox platform behavior that cannot be confirmed without live runtime network/DOM evidence.

| Item / Requirement                               | Document Reference                                              | Classification            | Evidence / Rationalization                                                      |
| :----------------------------------------------- | :-------------------------------------------------------------- | :------------------------ | :------------------------------------------------------------------------------ |
| **Extension-First Architecture**                 | ADR-001, `00-project-overview.md`                               | **VERIFIED**              | Formally accepted in ADR-001. Best proximity to browser session.                |
| **Critical Path Isolation**                      | ADR-002, `07-extension-architecture.md`                         | **VERIFIED**              | Formally accepted in ADR-002. No backend in reservation path.                   |
| **Profile-Level Account Isolation**              | ADR-003, `06-multi-account-orchestration.md`                    | **VERIFIED**              | Formally accepted in ADR-003. No cookie switching; Chrome profile boundary.     |
| **No Credential / OTP / CVV Storage**            | `08-security-and-compliance.md`                                 | **VERIFIED**              | Non-negotiable security principle. Normal user login required.                  |
| **Server-Confirmed Reservation Boundary**        | `05-reservation-boundary.md`                                    | **VERIFIED**              | Rule: `SELECTED != RESERVED`, `RESERVING != HELD`. Server evidence mandatory.   |
| **Single Account MVP Scope**                     | `00-project-overview.md`, `10-implementation-roadmap.md`        | **VERIFIED**              | Multi-account and Desktop Controller deferred to Phase 2/3.                     |
| **Bounded Retry & Safe Unknown Failure**         | `04-state-machine.md`, `09-error-and-retry-matrix.md`           | **VERIFIED**              | No `while(true)`. Unhandled states trigger safe stop.                           |
| **Manifest V3 Runtime Constraints**              | `07-extension-architecture.md`                                  | **DOCUMENTED ASSUMPTION** | Service worker dormancy must be managed via storage persistence.                |
| **Multi-Account Domain Modeling**                | `06-multi-account-orchestration.md`                             | **DOCUMENTED ASSUMPTION** | Domain models (ProfileId, AccountProfile) needed for future extensibility.      |
| **T0..T5 Latency Measurement Model**             | `01-product-requirements.md`, `02-technical-discovery.md`       | **DOCUMENTED ASSUMPTION** | T0 (authoritative release timestamp) may not be available; marked as estimated. |
| **Ticketbox Page URLs and Routes**               | `02-technical-discovery.md`, `03-network-discovery.md`          | **REQUIRES DISCOVERY**    | Event URL structures, showing routes, and checkout redirects are unknown.       |
| **Ticketbox Inventory Delivery Mechanism**       | `03-network-discovery.md` §6-7                                  | **REQUIRES DISCOVERY**    | Unknown whether polling, WebSocket, SSE, or static page hydration.              |
| **Ticketbox DOM Hierarchy & Selectors**          | `07-extension-architecture.md`, `11-technical-design.md`        | **REQUIRES DISCOVERY**    | Zero selectors verified. No class names or DOM structures exist in evidence.    |
| **Ticketbox Reservation Request & Schema**       | `03-network-discovery.md`, `05-reservation-boundary.md`         | **REQUIRES DISCOVERY**    | Endpoint name, HTTP method, payload, headers, and tokens are unknown.           |
| **Ticketbox Hold Confirmation Evidence**         | `05-reservation-boundary.md` §4                                 | **REQUIRES DISCOVERY**    | Unknown whether server returns holdId, reservationId, countdown, or cookie.     |
| **Ticketbox Rate Limit & Anti-Bot Behavior**     | `08-security-and-compliance.md`, `09-error-and-retry-matrix.md` | **REQUIRES DISCOVERY**    | HTTP 429 vs 403 vs Cloudflare/custom challenge behaviors uncaptured.            |
| **Extension Storage Schema**                     | `11-technical-design.md` §12                                    | **TBD**                   | Exact persistent key schema for preferences and session state.                  |
| **IPC Mechanism between Controller & Extension** | `06-multi-account-orchestration.md`                             | **TBD**                   | Deferred until Controller phase.                                                |

---

## 3. Architecture Assessment & Contradictions Identified

### Contradiction 1: Layering & Content Script Responsibilities

- **The Conflict:**  
  In `07-extension-architecture.md` (lines 65–70 and 304–307), `selection-engine.ts` is explicitly placed inside the historical content-script directory, and the critical path diagram states: `Ticketbox -> Content Script -> Selection Engine -> Normal reservation interaction`.
  However, in `11-technical-design.md` (lines 38–46, 65–76) and AI Rule 04 (`12-ai-engineering-rules.md`), business rules, selection policies, retry policies, and state machine transitions are strictly forbidden from living in Content Scripts:
  > _"Avoid: content script ├── DOM ├── business rules ├── retry ├── account policy └── state machine. Instead: DOM Adapter ↓ Application ↓ Domain"_
- **Resolution:**  
  `07-extension-architecture.md` is in direct violation of the Clean Architecture and AI Engineering Rules.  
  **Correction:** The Content Script must act solely as an Infrastructure DOM/Page Adapter (`TicketboxDomAdapter`). The Selection Engine, Purchase State Machine, and Retry Policies belong to the **Domain** and **Application** layers (run within the Service Worker / Extension Application core, or shared domain modules).

### Contradiction 2: State Machine Lifecycle Discrepancies

- **The Conflict:**
  1. `01-product-requirements.md` (Section 9, FR-013) defines UI statuses: `NOT_READY`, `READY`, `ARMED`, `MONITORING`, `AVAILABLE`, `SELECTING`, `RESERVING`, `HELD`, `CHECKOUT`, `CONFIRMED`, `FAILED`, `STOPPED`.
  2. `04-state-machine.md` defines the lifecycle states as: `INIT`, `AUTH_CHECK`, `EVENT_CHECK`, `READY`, `ARMED`, `MONITORING`, `AVAILABLE_DETECTED`, `SELECTING`, `RESERVING`, `HELD`, `CHECKOUT`, `PAYMENT`, `CONFIRMED`.
  3. `06-multi-account-orchestration.md` and `07-extension-architecture.md` define account status as: `NOT_READY`, `READY`, `ARMED`, `MONITORING`, `SELECTING`, `RESERVING`, `HELD`, `CHECKOUT`, `CONFIRMED`, `FAILED`, `STOPPED` (omitting `INIT`, `AUTH_CHECK`, `EVENT_CHECK`, `AVAILABLE_DETECTED`, and `PAYMENT`).
  4. In `04-state-machine.md`, Section 4 mentions intermediate states `READY_FOR_EVENT`, `NOT_AUTHENTICATED`, `SESSION_EXPIRED` inside `AUTH_CHECK`, and Section 5 mentions `EVENT_NOT_FOUND`, `EVENT_NOT_OPEN`, `EVENT_READY`, `EVENT_ENDED`. But the canonical transition table only shows `INIT -> AUTH_CHECK -> EVENT_CHECK -> READY`.
- **Resolution:**  
  Establish a single canonical, strongly typed State Machine representation.
  - Lifecycle States: `INIT`, `AUTH_CHECK`, `EVENT_CHECK`, `READY`, `ARMED`, `MONITORING`, `AVAILABLE_DETECTED`, `SELECTING`, `RESERVING`, `HELD`, `CHECKOUT`, `PAYMENT`, `CONFIRMED`, `STOPPED`, `FAILED`.
  - Terminal/Failure states must be explicitly typed with structured error reasons (`FailureReason`: `SOLD_OUT`, `SESSION_EXPIRED`, `RATE_LIMITED`, `RESERVATION_FAILED`, `PAYMENT_FAILED`, `UNKNOWN`).

### Contradiction 3: Premature Tech Stack Dependencies (React/Vite vs Minimal Extension)

- **The Conflict:**  
  `07-extension-architecture.md` specifies `React` and `Vite` for the Popup, while `11-technical-design.md` warns that the critical path must avoid unnecessary React rendering and large bundles. The user instructions explicitly mandate:
  > _"Do NOT install unnecessary dependencies... evaluate current environment... strict TypeScript, modern frontend tooling... pnpm or npm."_
- **Resolution:**  
  For an extension popup with 3 views (Configuration, Monitoring/Armed, Held/Status), heavy React dependencies introduce bundle weight, extra build steps, and potential DOM reconciliation latency. Modern standard TypeScript with native component rendering or minimal typed reactive state is lighter, faster, and has zero runtime vulnerability surface.

### Contradiction 4: Premature Desktop Controller Assumptions

- **The Conflict:**  
  Several sections in `01-product-requirements.md` (FR-021..FR-025), `06-multi-account-orchestration.md`, and `07-extension-architecture.md` describe Controller IPC and global coordination as if active in MVP, while ADR-001, ADR-003, and `10-implementation-roadmap.md` expressly state that MVP is **Single Account Extension Only** and Desktop Controller is deferred to Phase 2/3.
- **Resolution:**  
  Freeze architecture: Desktop Controller is an optional future component. In MVP, multi-account is limited to domain abstractions (`ProfileId`, `AccountProfile`, `AccountContext`, `ExecutionPolicy`, `GlobalStopPolicy`) so the core domain is multi-profile ready without implementing the Tauri/desktop process.

---

## 4. Documentation Consistency & Quality Assessment

1. **Rule Enforcement Consistency:**  
   The golden rules ("Never invent Ticketbox APIs", "Server-confirmed reservation is the meaningful boundary", "Safe unknown failure", "Bounded retries") are uniformly stated across all files. This is a major architectural strength.
2. **Duplication of Concepts:**  
   The state transition sequence and multi-account diagrams are repeated almost verbatim across `00`, `01`, `04`, `06`, `07`, `10`, and `11`. While reinforcing alignment, this introduces maintenance drag when states are updated.
3. **Evidence Rigor:**  
   Documents `02-technical-discovery.md`, `03-network-discovery.md`, and `05-reservation-boundary.md` correctly mark all Ticketbox endpoints as `TBD`. No hallucinated endpoints or selectors exist in the markdown documentation.

---

## 5. Risks & Implementation Blockers

### Blocker 1: Absence of Real Ticketbox Network & DOM Discovery

- **Risk:** Any attempt to write DOM scraping or automated fetch requests for Ticketbox will violate Rule 2 ("Never invent Ticketbox APIs") and Rule 3 ("Never invent selectors").
- **Mitigation:** The application layer must interface exclusively with abstract ports (`TicketboxPageAdapter`, `InventoryObserverPort`, `ReservationPort`). Concrete implementations must default to `DiscoveryAdapter` / `TbdAdapter` which safely logs state without performing blind mutations until real evidence is collected.

### Blocker 2: Manifest V3 Service Worker Lifecycle

- **Risk:** Chrome Manifest V3 service workers terminate after ~30 seconds of inactivity. If state is stored solely in memory in the background script, state will be lost during `MONITORING` or `ARMED` phases.
- **Mitigation:** Background state machine must serialize state transitions to `chrome.storage.session` (or `chrome.storage.local` with in-memory caching) with an explicit rehydration lifecycle on worker wake-up.

### Blocker 3: Sensitive Data in Debug/Discovery Mode

- **Risk:** When developers inspect Ticketbox traffic in discovery mode, cookies (`tb_session`, JWTs) and personal payment data could leak into logs or committed files.
- **Mitigation:** Strict log sanitization layer with token masking, zero credential persistence, and structured redaction before any log is output or stored.

---

## 6. Recommended Corrections & Plan of Record

1. **Establish Strict Clean Architecture:**
   - `src/domain/`: Pure TypeScript entities, value objects, state machine, selection policies, retry policies. Zero dependencies on `chrome.*` or `window.document`. 100% testable in Vitest.
   - `src/application/`: Use cases (`ArmAssistantUseCase`, `StartMonitoringUseCase`, `SelectTicketUseCase`, `SubmitReservationUseCase`, `StopAssistantUseCase`) and port interfaces.
   - `src/infrastructure/`: Implementations of ports: `ChromeStorageRepository`, `ChromeMessageBus`, `SanitizedLogger`, `TicketboxAdapter` (stubbed with discovery/safe mode).
   - `src/extension/`: MV3 Service Worker entry, Content Script entry, Popup UI entry.
2. **Unify State Machine Enums:**
   - Define one authoritative `PurchaseState` enum across domain, application, and UI.
3. **Technology Selection:**
   - Standard TypeScript with strict compiler options.
   - Vite for fast, clean, deterministic MV3 bundling (using `@crxjs/vite-plugin` or clean multi-input Vite rollup).
   - Vitest for blazingly fast unit testing.
   - ESLint and Prettier for strict static code quality.
   - Standard npm package manager (since pnpm is not installed).

---

## 7. Audit Conclusion & Gate Approval

The documentation is conceptually sound and provides clear boundary discipline. With the identified contradictions resolved, the project is cleared to proceed to **Phase 1 (Architecture Baseline)** and **Phase 2 (Technology Decision)**.
