# ADR-008 — Migration to Authoritative Service Worker State & Observation-Only Content Script

**Status:** Proposed / Architectural Blueprint  
**Date:** 2026-10-02  
**Deciders:** Core Engineering Team  
**Consulted:** ADR-004, ADR-005, ADR-006, docs/ticketbox/04-state-machine.md, docs/ticketbox/15-architecture-baseline.md

---

## 1. Context & Problem Statement

Currently (under ADR-004), the **Ticketbox Purchase Assistant** implements a hybrid, partitioned state model:

1. **Content Script** acts as the primary owner of the booking journey state (`ticketbox_assistant_journey_state`), executing transitions inside `content.ts` and syncing outwards via `STATE_CHANGED` messages.
2. **Service Worker** manages high-level lifecycle states (`ticketbox_assistant_lifecycle_state`) and maintains an in-memory `mirroredJourneyContext` to reflect badge updates (`BUY`, `DONE`, `CAPT`) and reply to popup sync queries (`SYNC_STATE_REQUEST`).

### Challenges of the Current Architecture:

- **Dual State Machine Drift:** Both the Service Worker and Content Script instantiate independent `PurchaseStateMachine` domain objects.
- **Multi-Tab Race Conditions:** If a user opens two Ticketbox event tabs or duplicates a tab during an armed session, both content scripts could potentially invoke conflicting state transitions or overwrite storage if not strictly tab-locked.
- **Service Worker Lifecycle Invariants:** In Chrome MV3, the background service worker is terminated when idle. If the service worker restarts mid-journey, it relies on rehydrating storage while content script continues running.
- **Complex Bidirectional Sync:** Content script must notify SW of journey updates, and SW must broadcast ARM/STOP/CONFIG updates back to all active tabs.

---

## 2. Decision Options

### Option A: Retain Partitioned Ownership (Current ADR-004 Baseline)

- **Mechanism:** Content Script owns journey state (`TICKET_SELECTED`, `SEATS_SELECTED`, `PAYMENT_GATE`). Service Worker only mirrors state.
- **Pros:** Resilient against Service Worker termination during DOM manipulation; no cross-process RPC roundtrip latency per transition.
- **Cons:** Content script must maintain full domain state machine, risk of multi-tab state divergence.

### Option B: Authoritative Service Worker State (Observation-Only Content Script) — **SELECTED ARCHITECTURE**

- **Mechanism:** The **Service Worker** is the sole, authoritative owner of the domain `PurchaseStateMachine`. Content scripts NEVER transition state directly. Instead, Content scripts send strictly passive observation events (e.g. `OBSERVED_TICKETS_AVAILABLE`, `OBSERVED_SEATS_SELECTED`, `OBSERVED_SECURITY_CHALLENGE`, `OBSERVED_PAYMENT_GATE_REACHED`). The Service Worker processes these observations, evaluates guards, executes state machine transitions, persists authoritative state, and broadcasts canonical `STATE_UPDATE` to content scripts and popup.
- **Pros:**
  - Truly single source of truth: 1 instance of `PurchaseStateMachine` in the extension runtime.
  - Natural protection against multi-tab race conditions: SW serializes observation events, tab-locking is enforced at the central coordinator.
  - Zero domain state machine code needed in Content Script (reducing content script bundle size and DOM exposure).
- **Cons & Risks:**
  - MV3 Service Worker wake-up latency (~50-150ms) if the worker went idle.
  - If SW crashes/restarts between critical state transitions, a robust rehydration and fail-safe stop policy is mandatory.

---

## 3. Migration Plan & Safety Guarantees

To ensure 100% compliance with repository invariants without risking runtime regression, the migration follows a phased rollout:

### Phase 1: Rehydration & Multi-Tab Concurrency Hardening (Implemented in T5)

1. **Critical State Halt Invariant:**
   - If the Service Worker restarts while `getLifecycleState()` or `getJourneyState()` is in a critical flow state (`SELECTING`, `RESERVING`, `HELD`, `CHECKOUT`, `PAYMENT`), the assistant MUST NOT blindly resume or guess. It must halt cleanly to `STOPPED` with reason requiring state revalidation.
2. **Authoritative Evidence Invariants (Rule 06 / Invariant 3):**
   - Restoring to `CONFIRMED` without `orderId` or `confirmationReference` MUST throw `StateTransitionError`.
   - Restoring to `HELD` without `reservationId` MUST throw `StateTransitionError`.
3. **Multi-Tab Arming Conflict Prevention:**
   - When a tab requests `ARM`, the tab's ID is registered in persistent session/runtime storage. If a second tab attempts to arm while another tab is active, the coordinator rejects or transfers ownership with explicit user confirmation.
4. **Tab Reload Invariant:**
   - When a tab reloads while on `/payment` or `/checkout` or in `PAYMENT_GATE`, the state machine restores to `PAYMENT_GATE` and strictly refuses to auto-reset to `MONITORING`.

### Phase 2: Observation-Only Content Script Bridge (Scheduled in Future Release)

- Implement `ObservationDispatcher` in Content Script.
- Deprecate direct `stateMachine.transition()` inside `content.ts`.

---

## 4. Consequences

### Positive

- Strict alignment with Clean Architecture: Domain state machine lives exclusively in the background orchestration layer.
- Elimination of state desynchronization between tabs and popup.
- Centralized audit log of all state transitions and latency markers.

### Negative / Mitigations

- Service Worker must keep alive during active journeys via offscreen documents or active user ports, or rely on fast storage rehydration (< 5ms).
