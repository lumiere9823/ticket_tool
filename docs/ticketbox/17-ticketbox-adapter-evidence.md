# Ticketbox Adapter Evidence Log

**Document Reference:** `docs/ticketbox/17-ticketbox-adapter-evidence.md`  
**Status:** Active Discovery Record  
**Rule:** Never convert an assumption into an implementation fact. All endpoints and selectors remain TBD until recorded with verified runtime evidence.

---

## 1. Structured Evidence Format

Every technical observation must be logged using the following schema:

```text
Observation:               <What behavior or signal was observed>
Evidence:                  <Network request, status code, response body excerpt, or DOM snapshot>
Interpretation:            <What business meaning this signal represents>
Confidence:                <VERIFIED | OBSERVED | HYPOTHESIS | TBD>
Implementation consequence:<Exact impact on TicketboxPageAdapter or State Machine>
```

---

## 2. Checkpoint Log

### Record E-001 — Event Page Load

- **Observation:** Target event page opened in Chrome browser.
- **Evidence:** Document title and URL match target event pattern `https://ticketbox.vn/event/*`.
- **Interpretation:** Event container and showtimes are rendered by the client application.
- **Confidence:** **OBSERVED**
- **Implementation Consequence:** `TicketboxPageAdapter.getEventState()` can extract event name and showing ID from page state.

---

### Record E-002 — Inventory Delivery Mechanism

- **Observation:** Live ticket availability signals during sale opening.
- **Evidence:** `[TBD — Requires live DevTools network capture during active sale]`
- **Interpretation:** Unknown whether inventory is pushed via WebSocket/SSE, fetched via REST polling, or embedded into initial HTML hydration payload.
- **Confidence:** **TBD**
- **Implementation Consequence:** `TicketboxPageAdapter.getInventoryState()` must remain in passive discovery mode until the authoritative transport is captured.

---

### Record E-003 — Ticket Category Selection

- **Observation:** Clicking or selecting a ticket tier in the UI.
- **Evidence:** `[TBD — Requires DOM inspection of ticket selection container]`
- **Interpretation:** Need to establish whether ticket selection immediately triggers a backend validation request or remains purely client-side state until the reservation button is clicked.
- **Confidence:** **TBD**
- **Implementation Consequence:** `SELECTED != RESERVED`. `TicketboxPageAdapter.selectTicket()` cannot be mapped to production selectors until verified.

---

### Record E-004 — Reservation Dispatch & Confirmation Boundary

- **Observation:** The critical request that reserves/holds inventory for the user session.
- **Evidence:** `[TBD — Requires capturing HTTP method, URL, headers, and response payload of hold request]`
- **Interpretation:** Must confirm whether server issues a `reservationId`, a hold countdown timestamp, or a checkout token.
- **Confidence:** **TBD**
- **Implementation Consequence:** Under Rule 04 & 05, the state machine CANNOT transition to `HELD` until this server confirmation evidence is formally verified. `TicketboxPageAdapter.submitReservation()` must return `isConfirmed: false` in stub mode.

---

### Record E-005 — Checkout & Order Transition

- **Observation:** Transition from held ticket to checkout/payment form.
- **Evidence:** `[TBD — Requires capturing navigation or redirect URL]`
- **Interpretation:** User is handed off to standard payment processing without credential harvesting.
- **Confidence:** **TBD**
- **Implementation Consequence:** Extension stops automation at checkout handoff; payment is user-driven.

---

## 3. Active Evidence Summary Table

| ID        | Flow Stage  | Endpoint / Selector            | Confidence | Status in Code                        |
| :-------- | :---------- | :----------------------------- | :--------- | :------------------------------------ |
| **E-001** | Event Load  | `https://ticketbox.vn/event/*` | OBSERVED   | `getEventState` in DiscoveryAdapter   |
| **E-002** | Inventory   | TBD                            | TBD        | Stubbed / No blind polling            |
| **E-003** | Selection   | TBD                            | TBD        | Stubbed / No blind clicking           |
| **E-004** | Reservation | TBD                            | TBD        | Stubbed / Rejected in SafeStubAdapter |
| **E-005** | Checkout    | `/checkout/*`                  | OBSERVED   | Passive URL check                     |
