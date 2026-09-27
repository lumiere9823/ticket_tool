# Ticketbox Adapter Evidence Log & Contract

**Document Reference:** `docs/ticketbox/17-ticketbox-adapter-evidence.md`  
**Status:** Active Discovery Record / Readiness Gate Hardened  
**Rule:** Never convert an assumption into an implementation fact. All endpoints and selectors remain TBD until recorded with verified runtime evidence. Discovery is strictly passive and does not authorize production automation.

---

## 1. Discovery Phase Boundary

The repository enforces a strict boundary between passive discovery and production automation:

```text
PHASE 8A: Passive Discovery
    ↓
PHASE 8B: Evidence Sanitization
    ↓
PHASE 8C: Evidence Review
    ↓
PHASE 8D: Contract Update
    ↓
PHASE 8E: Adapter Implementation
    ↓
PHASE 8F: Controlled Test
```

Discovery systems (`TicketboxDiscoveryAdapter`, Content Script discovery scanner) operate under read-only, non-mutating policies. Discovery observations can NEVER trigger purchase execution or state transitions.

---

## 2. Structured Evidence Format

Every technical observation must be logged using the following schema:

```text
Observation:               <What behavior or signal was observed>
Evidence:                  <Network request, status code, response body excerpt, or DOM snapshot>
Interpretation:            <What business meaning this signal represents>
Confidence:                <VERIFIED | OBSERVED | HYPOTHESIS | TBD>
Implementation consequence:<Exact impact on TicketboxPageAdapter or State Machine>
```

---

## Observation Evidence

What can be observed safely without mutating application or purchase state:

1. **Document & URL Metadata:**
   - Event URL structure (`https://ticketbox.vn/event/*`)
   - Document title (`document.title`)
   - Page URL (sanitized of sensitive query parameters)

2. **DOM Structure & Visible Elements:**
   - Standard HTML container presence (`main`, `article`, `header`)
   - Standard interactive element counts (number of visible `button` elements)
   - Visible ticket tier labels and displayed pricing text (read-only)
   - Visual seat-map presence indicators (read-only layout inspection)

3. **Observable Network Metadata:**
   - Sanitized request/response URLs, HTTP methods, status codes, and content types
   - Headers and payloads strictly sanitized of credentials, tokens, and cookies

**Constraint:** Observation of an element or network signal NEVER implies that inventory is reserved, held, or purchased.

---

## Reservation Evidence

What is sufficient to transition `RESERVING → HELD`:

1. **Authoritative Server Confirmation:**
   - The ticket platform's backend server has processed a hold request and responded with an authoritative server confirmation.
   - An unambiguous, non-empty server hold identifier: `reservationId` (or `holdId`).
   - Server-confirmed hold expiration timestamp (`expiresAt`), when provided by the server contract.
   - Server-confirmed checkout reference token (`checkoutReference`), when issued by the server response.

2. **Verification Requirement:**
   - The response must be verified directly from the authoritative server response payload.
   - Must be verified within the active execution context matching `profileId`, `accountId`, `eventId`, and `workflowId`.

---

## Confirmation Evidence

What is sufficient to transition `PAYMENT → CONFIRMED`:

1. **Authoritative Server Order Receipt:**
   - The server order processing system has recorded successful payment and issued an official order confirmation.
   - An unambiguous, non-empty server confirmation identifier: `orderId` or `confirmationReference`.
   - Optional server-issued `ticketId` or ticket barcode/QR reference confirmed by the backend.
   - Timestamp of server-confirmed transaction (`confirmedAt`).

2. **Verification Requirement:**
   - Confirmation must be derived from verified backend receipt data.
   - Must match the target `attemptId`, `eventId`, and `accountId`.

---

## Insufficient Evidence

What must **NEVER** be treated as reservation or confirmation success:

1. **Client & DOM Signals:**
   - Button clicked or click event dispatched successfully (`click() === true`)
   - Button disabled, style changed, or CSS class added/removed
   - Loading spinner or progress indicator disappeared
   - Success banner or text rendered in DOM without server payload verification
   - Form submitted event fired

2. **Navigation & Network Signals:**
   - Browser navigation or redirect occurred (e.g. redirect to `/checkout` or payment gateway)
   - URL change or hash change
   - HTTP request was created or dispatched
   - HTTP 200 OK returned on an endpoint that does NOT contain authoritative reservation/order confirmation fields
   - Client-side callback or postMessage event received
   - WebSocket connection opened or heartbeat received

3. **Human Intervention Resolution:**
   - User solving a CAPTCHA does NOT mean inventory is held or order is confirmed.
   - User completing OTP challenge does NOT mean payment is confirmed.
   - Session re-authentication completed does NOT mean user is on the event page or armed.

---

## Unknown Evidence

What remains **BLOCKED_BY_DISCOVERY**:

Until verified runtime evidence is captured, reviewed, and approved during Phase 8 discovery, the following Ticketbox interfaces remain strictly unmapped and blocked:

1. **Live Inventory Feed:**
   - Endpoint, protocol (WebSocket vs Polling vs SSE), and payload format remain **BLOCKED_BY_DISCOVERY** (Record E-002).
   - No blind polling or automated polling is permitted.

2. **Ticket Selection Mechanism:**
   - Specific ticket tier DOM selectors, quantity stepper controls, and seat-map coordinate interactions remain **BLOCKED_BY_DISCOVERY** (Record E-003).
   - No blind clicking or automated DOM selection is permitted.

3. **Reservation Hold Dispatch:**
   - Specific hold HTTP endpoint, request method, payload schema, and header requirements remain **BLOCKED_BY_DISCOVERY** (Record E-004).
   - `SafeStubAdapter` and `TicketboxDiscoveryAdapter` return `BLOCKED_BY_DISCOVERY`.

4. **Payment Confirmation Payload:**
   - Confirmation payload schema and receipt endpoint remain **BLOCKED_BY_DISCOVERY** (Record E-006).

---

## 3. Checkpoint Log

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
- **Implementation Consequence:** Under Rule 04 & 05, the state machine CANNOT transition to `HELD` until this server confirmation evidence is formally verified. `TicketboxPageAdapter.submitReservation()` must return `isConfirmed: false` with `BLOCKED_BY_DISCOVERY`.

---

### Record E-005 — Checkout & Order Transition

- **Observation:** Transition from held ticket to checkout/payment form.
- **Evidence:** `[TBD — Requires capturing navigation or redirect URL]`
- **Interpretation:** User is handed off to standard payment processing without credential harvesting.
- **Confidence:** **TBD**
- **Implementation Consequence:** Extension stops automation at checkout handoff; payment is user-driven.

---

### Record E-006 — Payment Confirmation Evidence

- **Observation:** Authoritative confirmation proving successful order payment.
- **Evidence:** `[TBD — Requires capturing server confirmation response payload or order receipt]`
- **Interpretation:** `PAYMENT → CONFIRMED` strictly requires authoritative server evidence (`orderId` or `confirmationReference`).
- **Confidence:** **TBD**
- **Implementation Consequence:** Guarded in `PurchaseStateMachine`; UI redirects or client-side success labels without server reference are rejected.

---

### Record E-007 — Event Title & Showing Discovery

- **Observation:** Target event page renders event headline and multi-showing date/time selectors.
- **Evidence:** Event title observed in `h1`, `.event-title`, `.event-name`, `[data-testid="event-title"]`. Showing options observed in `[data-showing-id]`, `.showing-item`, `input[name="showing"]`, `.showing-date`.
- **Interpretation:** Normalized `ShowingSnapshot` models showing date, time, status, and raw label.
- **Confidence:** **OBSERVED**
- **Implementation Consequence:** `TicketboxPageAdapter.discoverShowings()` extracts candidate showings.

---

### Record E-008 — Ticket Tier & Price Normalization

- **Observation:** Ticket tiers rendered with category names and formatted VND prices (e.g. `900.000 đ`, `1,200,000 VND`, `Miễn phí` / `0 đ`).
- **Evidence:** Tier containers `.ticket-item`, `.ticket-row`, `[data-ticket-id]`. Prices parsed with Unicode-aware currency regex normalizing thousand separators (`.` or `,`) to integer amount in minor units.
- **Interpretation:** Pure read-only extraction into `Money` value object (`VND`).
- **Confidence:** **OBSERVED**
- **Implementation Consequence:** `TicketboxPageAdapter.discoverTicketCatalog()` extracts parsed tiers without mutating DOM.

---

### Record E-009 — Ticket Availability Signals

- **Observation:** Tiers display availability text badges (`Hết vé`, `Sold out`, `Sắp mở bán`, `Đã kết thúc`, `Đang bán`) and DOM state (`disabled`, `aria-disabled="true"`).
- **Evidence:** Passive signal extraction; `AvailabilityEvaluator` maps signals strictly to `AVAILABLE`, `SOLD_OUT`, `NOT_STARTED`, `CLOSED`, or `UNKNOWN`.
- **Interpretation:** Ambiguous, missing, or contradictory signals MUST resolve to `UNKNOWN`. Under domain invariant rules, `UNKNOWN` is NEVER converted into `AVAILABLE`.
- **Confidence:** **OBSERVED**
- **Implementation Consequence:** `TicketCandidateSelector` rejects non-`AVAILABLE` tiers.

---

### Record E-010 — Seated vs Standing Classification & Seat-Map Invariants

- **Observation:** Events have standing zones (free standing) or seated zones with visual interactive seat maps.
- **Evidence:** Presence of `[data-seat-map]`, `.seat-map`, `canvas`, `svg.seatmap`, seat coordinate grids, or seat selection buttons.
- **Interpretation:** The presence of a seat map container does NOT indicate seat availability. If a seated zone has zero available seats, availability evaluates to `SOLD_OUT`. Automating seat clicks or coordinate selection remains **BLOCKED_BY_DISCOVERY**.
- **Confidence:** **OBSERVED** (Layout) / **BLOCKED_BY_DISCOVERY** (Seat selection)
- **Implementation Consequence:** `TicketboxPageAdapter.detectSeatMap()` detects presence; `selectSeats()` returns `false` with `BLOCKED_BY_DISCOVERY`.

---

### Record E-011 — Quantity Stepper & Selection Bounds Detection

- **Observation:** Quantity input controls (`input[type="number"]`, stepper buttons `+`/`-`, or `<select>` dropdowns).
- **Evidence:** Observed attributes `min`, `max`, and dropdown options. When unobservable, `minQuantity = null` and `maxQuantity = null`.
- **Interpretation:** Invariants prohibit inventing arbitrary quantity caps (e.g. assuming max is 4). If observable `maxQuantity < desiredQuantity`, selection is rejected or capped according to user policy. Mutating quantity steppers remains **BLOCKED_BY_DISCOVERY**.
- **Confidence:** **OBSERVED** (Input bounds) / **BLOCKED_BY_DISCOVERY** (Stepper mutation)
- **Implementation Consequence:** `TicketCandidateSelector` checks quantity bounds; `TicketboxPageAdapter.selectQuantity()` returns `false` with `BLOCKED_BY_DISCOVERY`.

---

## 4. Active Evidence Summary Table

| ID        | Flow Stage    | Endpoint / Selector                  | Confidence                            | Status in Code                                             |
| :-------- | :------------ | :----------------------------------- | :------------------------------------ | :--------------------------------------------------------- |
| **E-001** | Event Load    | `https://ticketbox.vn/event/*`       | OBSERVED                              | `getEventState` in DiscoveryAdapter                        |
| **E-002** | Inventory     | TBD                                  | TBD                                   | BLOCKED_BY_DISCOVERY / No blind polling                    |
| **E-003** | Selection     | TBD                                  | TBD                                   | BLOCKED_BY_DISCOVERY / No blind clicking                   |
| **E-004** | Reservation   | TBD                                  | TBD                                   | BLOCKED_BY_DISCOVERY in SafeStubAdapter & DiscoveryAdapter |
| **E-005** | Checkout      | `/checkout/*`                        | OBSERVED                              | Passive URL check                                          |
| **E-006** | Confirmation  | TBD                                  | TBD                                   | BLOCKED_BY_DISCOVERY / Guarded in State Machine boundary   |
| **E-007** | Showings      | `.showing-item`, `[data-showing-id]` | OBSERVED                              | `discoverShowings()` in TicketboxDiscoveryAdapter          |
| **E-008** | Catalog/Price | `.ticket-item`, VND text             | OBSERVED                              | `discoverTicketCatalog()` in TicketboxDiscoveryAdapter     |
| **E-009** | Availability  | Text badges, disabled state          | OBSERVED                              | `AvailabilityEvaluator` with UNKNOWN fail-safe             |
| **E-010** | Seated/Map    | `canvas`, `svg.seatmap`, `.seat-map` | OBSERVED (layout) / BLOCKED (actions) | `detectSeatMap()` observed; `selectSeats()` BLOCKED        |
| **E-011** | Quantity      | Steppers, `min`/`max` attrs          | OBSERVED (bounds) / BLOCKED (actions) | Evaluator bounds check; `selectQuantity()` BLOCKED         |
