# Ticketbox Purchase Assistant — Architecture Baseline (Freeze)

**Document Reference:** `docs/ticketbox/15-architecture-baseline.md`  
**Status:** Frozen  
**Date:** 2026-09-26  
**Supersedes / Corrects:** Contradictory layering statements in `07-extension-architecture.md`

---

## 1. Architectural Principles

1. **Extension-First (ADR-001):** The primary execution client is a Chrome Extension (Manifest V3) executing within the user's authenticated browser context.
2. **Critical Path Isolation (ADR-002):** The reservation critical path is strictly local: `Ticketbox Web Page ↔ Chrome Extension`. No intermediate backend servers, message queues, or cloud workers may exist in the critical path.
3. **Profile-Level Account Isolation (ADR-003):** Each Ticketbox account operates within an independent Chrome Profile. No cookie manipulation, session extraction, or in-memory credential switching is permitted.
4. **Clean Domain Boundary:** Pure domain logic (entities, state machine, selection policies, retry policies) has zero dependencies on Chrome APIs (`chrome.*`) or browser DOM APIs (`window`, `document`).
5. **Adapter Isolation:** All Ticketbox-specific interactions (DOM querying, network discovery, mutation observation) are isolated behind strict port interfaces (`TicketboxPageAdapter`).

---

## 2. System Topology

```text
┌────────────────────────────────────────────────────────────────────────┐
│ USER WORKSTATION (Operating System)                                    │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Chrome Browser Instance (Profile: Default or Profile N)             │ │
│ │                                                                    │ │
│ │  ┌───────────────────────────┐    ┌─────────────────────────────┐  │ │
│ │  │ Ticketbox Web Application │    │ Chrome Extension (MV3)      │  │ │
│ │  │                           │    │                             │  │ │
│ │  │ - Event Page              │◄───┤ - Presentation (Popup UI)   │  │ │
│ │  │ - Ticket Selection Area   │    │ - Application (Use Cases)   │  │ │
│ │  │ - Reservation Flow        │───►│ - Domain (Core Rules)       │  │ │
│ │  │ - Checkout Stage          │    │ - Infrastructure            │  │ │
│ │  │                           │    │   (Chrome APIs, Storage,    │  │ │
│ │  │                           │    │    Ticketbox Page Adapter)  │  │ │
│ │  └─────────────┬─────────────┘    └──────────────┬──────────────┘  │ │
│ └────────────────┼─────────────────────────────────┼─────────────────┘ │
└──────────────────┼─────────────────────────────────┼───────────────────┘
                   │ HTTPS                           │
                   ▼                                 ▼ (Future/Optional)
        ┌──────────────────────┐          ┌───────────────────────┐
        │ Ticketbox API Server │          │ Internal Backend      │
        │                      │          │ (Out of Critical Path)│
        │ - Inventory Engine   │          │ - Remote Settings     │
        │ - Reservation Hold   │          │ - Non-sensitive Logs  │
        │ - Order Confirmation │          │ - Analytics           │
        └──────────────────────┘          └───────────────────────┘
```

---

## 3. Layered Extension Architecture

The Chrome Extension is structured strictly into concentric architectural layers:

```text
                          ┌──────────────────────────┐
                          │   Presentation Layer     │
                          │   (Popup UI / Views)     │
                          └────────────┬─────────────┘
                                       │ calls
                                       ▼
                          ┌──────────────────────────┐
                          │    Application Layer     │
                          │ (Use Cases, Coord, Ports)│
                          └──────┬────────────┬──────┘
                                 │ uses       │ implements
                                 ▼            ▼
      ┌──────────────────────────────┐    ┌──────────────────────────────┐
      │         Domain Layer         │    │    Infrastructure Layer      │
      │ (Entities, Value Objects,    │    │ (Chrome Storage, MessageBus, │
      │  State Machine, Policies)    │    │  Ticketbox Page Adapter,     │
      │  * NO CHROME / DOM APIS *    │    │  Sanitized Logger)           │
      └──────────────────────────────┘    └──────────────────────────────┘
```

### 3.1 Domain Layer (`src/domain/`)

- **Purity:** Completely independent of browser or framework dependencies.
- **Responsibilities:**
  - `PurchaseState` and the authoritative State Machine (`PurchaseStateMachine`).
  - Entities: `Event`, `TicketPreference`, `CandidateTicket`, `Reservation`, `PurchaseAttempt`.
  - Value Objects: `AttemptId`, `ProfileId`, `Money`, `Quantity`.
  - Policies: `SelectionStrategy` (deterministic ranking & fallback), `RetryPolicy` (bounded retry limits and backoff), `ErrorClassifier`.
  - Errors: Domain-specific typed failure models (`DomainError`, `SecurityError`, `StateTransitionError`).

### 3.2 Application Layer (`src/application/`)

- **Responsibilities:**
  - Coordinates domain models with ports.
  - Ports (interfaces):
    - `TicketboxPageAdapter`: Interface for page queries and actions.
    - `StorageRepository`: Persistence for configuration and current state.
    - `EventBus`: Typed event emission across components.
    - `LoggerPort`: Structured, sanitized logging interface.
  - Use Cases:
    - `ArmAssistantUseCase`
    - `StartMonitoringUseCase`
    - `EvaluateSelectionUseCase`
    - `ExecuteReservationUseCase`
    - `ConfirmReservationUseCase`
    - `StopAssistantUseCase`
    - `HandleFailureUseCase`

### 3.3 Infrastructure Layer (`src/infrastructure/`)

- **Responsibilities:**
  - Adapters implementing Application Ports.
  - `ChromeStorageRepository`: Implements `StorageRepository` via `chrome.storage.local` / `chrome.storage.session`.
  - `ChromeMessageBus`: Implements `EventBus` via `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.
  - `SanitizedLogger`: Implements `LoggerPort` with automatic masking of tokens, passwords, OTPs, CVVs, and sensitive headers.
  - `TicketboxDomAdapter`: Concrete DOM-interacting adapter deployed in Content Script, translating DOM events to normalized application data.
  - `TicketboxDiscoveryAdapter`: Discovery-mode adapter that passively observes network and DOM metadata without mutating the page.

### 3.4 Extension Runtime Components (`src/extension/`)

- **`background/` (Service Worker):**
  - Manages extension lifecycle, configuration state, and orchestrates use cases.
  - Handles service worker wake-up and restores state safely from persistent storage.
- **`content/` (Content Script):**
  - Instantiates `TicketboxDomAdapter` / `TicketboxDiscoveryAdapter`.
  - Listens for DOM mutations and transmits normalized domain events (`INVENTORY_DETECTED`, etc.) to the background service worker.
  - **Rule:** Contains NO state-machine logic, selection policy, or retry logic.
- **`popup/` (User Interface):**
  - Renders user preferences (ticket priorities, quantity, fallback).
  - Displays authoritative state, attempt IDs, elapsed latency metrics, and clear Arm / Stop controls.
  - Communicates exclusively via typed messages to the Service Worker.

---

## 4. Canonical State Machine

```text
┌──────┐
│ INIT │
└──┬───┘
   │ extension_ready
   ▼
┌────────────┐
│ AUTH_CHECK │──────► [NOT_AUTHENTICATED / SESSION_EXPIRED] ──► FAILED (Safe Stop)
└──────┬─────┘
   │ authenticated
   ▼
┌─────────────┐
│ EVENT_CHECK │─────► [EVENT_NOT_FOUND / EVENT_ENDED] ────────► FAILED (Safe Stop)
└──────┬──────┘
   │ event_ready
   ▼
┌───────┐
│ READY │◄────────────────────────────────┐ (Reset / Reconfigure)
└───┬───┘                                 │
    │ arm                                 │
    ▼                                     │
┌───────┐                                 │
│ ARMED │                                 │
└───┬───┘                                 │
    │ monitoring_started                  │
    ▼                                     │
┌────────────┐                            │
│ MONITORING │◄────────────────────────┐  │
└─────┬──────┘                         │  │
    │ inventory_available              │  │
    ▼                                  │  │
┌────────────────────┐                 │  │
│ AVAILABLE_DETECTED │                 │  │
└─────┬──────────────┘                 │  │
    │ candidate_found                  │  │ (Retryable fallback)
    ▼                                  │  │
┌───────────┐                          │  │
│ SELECTING │                          │  │
└─────┬─────┘                          │  │
    │ action_started                   │  │
    ▼                                  │  │
┌───────────┐                          │  │
│ RESERVING │                          │  │
└─────┬─────┘                          │  │
    │                                  │  │
    ├──────────────────────┐           │  │
    │ server_confirmed     │ rejected  │  │
    ▼                      ▼           │  │
┌──────┐             ┌───────────┐     │  │
│ HELD │             │  FAILURE  ├─────┘  │
└───┬──┘             └─────┬─────┘        │
    │ checkout_opened      │ non-retryable│
    ▼                      ▼              │
┌──────────┐         ┌───────────┐        │
│ CHECKOUT │         │  STOPPED  ├────────┘
└───┬──────┘         └───────────┘
    │ payment_started
    ▼
┌─────────┐
│ PAYMENT │ (User-driven payment)
└───┬─────┘
    │ payment_confirmed
    ▼
┌───────────┐
│ CONFIRMED │ (Terminal Success)
└───────────┘
```

**Non-negotiable State Rules:**

1. `SELECTED != RESERVED`
2. `RESERVING != HELD`
3. `HELD` requires verified server-confirmed evidence (reservation ID, hold expiration timestamp, server-confirmed hold state).
4. `UNKNOWN` state unconditionally halts further automated purchase actions and enters safe stop.

---

## 5. Multi-Account Extensibility Model (Future Roadmap)

While the Desktop Controller is deferred to Phase 2/3, the domain model must natively support multi-profile orchestration:

```text
┌────────────────────────────────────────────────────────┐
│ Desktop Controller (Phase 2/3)                         │
│                                                        │
│ - Account Registry (AccountProfile, ProfileId)         │
│ - Event Assignment (EventAssignment)                   │
│ - Execution Policy (ONE_SUCCESS vs MULTIPLE_SUCCESS)   │
│ - Global Stop Policy (Fail-Safe Broadcast)             │
└──────────────────────────┬─────────────────────────────┘
                           │ Launches / Coordinates
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ┌─────────────┐┌─────────────┐┌─────────────┐
     │Chrome Prof A││Chrome Prof B││Chrome Prof C│
     │ Account A   ││ Account B   ││ Account C   │
     │ Extension A ││ Extension B ││ Extension C │
     └─────────────┘└─────────────┘└─────────────┘
```

**Security Mandate:** Multi-account coordination orchestrates independent Chrome profiles. It never extracts cookies, never bypasses platform concurrency controls, and never shares session credentials across profiles.
