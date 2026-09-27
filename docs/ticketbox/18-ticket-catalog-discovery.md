# Ticketbox Ticket Catalog, Availability & Quantity Discovery

**Document Reference:** `docs/ticketbox/18-ticket-catalog-discovery.md`  
**Status:** Implemented & Verified (Readiness Gate Architecture)  
**Rule:** Passive discovery only. The assistant observes and normalizes ticket catalog data from the Ticketbox event DOM without clicking, selecting seats, mutating quantities, or invoking reservation endpoints. All mutative actions remain `BLOCKED_BY_DISCOVERY`.

---

## 1. Architectural Boundary & Information Flow

The discovery architecture strictly decouples raw DOM inspection from purchase decision-making. No CSS selector, HTML attribute, or DOM manipulation logic exists within the domain state machine or use cases.

```text
┌─────────────────────────────────────────────────────────────┐
│                 Ticketbox Page DOM                          │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Passive Read-Only Inspection)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 DOMElementLike Interface                    │
│   (wrapBrowserElement in live content script /              │
│    parseHtmlToDOMElementLike in test fixtures)              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 TicketboxCatalogParser                      │
│   (Page type, Event metadata, Showings, Raw Tiers,          │
│    VND Prices, Stepper bounds, Seat-map layout)             │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Produces normalized EventCatalog)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 AvailabilityEvaluator                       │
│   (Classifies signals: AVAILABLE | SOLD_OUT |               │
│    NOT_STARTED | CLOSED | UNKNOWN)                          │
│   * INVARIANT: UNKNOWN is NEVER converted to AVAILABLE      │
│   * Seated Rule: Map presence != Seat availability          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                TicketCandidateSelector                      │
│   (Matches user preferences, preserves priority order,       │
│    enforces allowFallback, validates quantity bounds)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Yields selected TicketCandidate)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 PurchaseStateMachine                        │
│   (SELECTING -> HELD strictly requires authoritative        │
│    server confirmation evidence; no DOM assumptions)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Domain Model & Entities

The catalog discovery layer introduces explicit typed entities and value objects under `src/domain/entities/EventCatalog.ts`:

- **`TicketAvailability`**: Union type `'AVAILABLE' | 'SOLD_OUT' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN'`.
- **`TicketMode`**: `'STANDING' | 'SEATED' | 'UNKNOWN'`.
- **`TicketType`**: Normalized ticket tier containing:
  - `id`: Unique identifier derived from DOM attributes (`data-ticket-id`, `id`) or slugified name.
  - `name`: Cleaned ticket category name (e.g. `VIP 1`, `GA Standing`, `CAT 2`).
  - `rawName`: Raw textual label from the DOM.
  - `price`: `Money` value object (`VND` currency).
  - `availability`: Evaluated `TicketAvailability`.
  - `mode`: Evaluated `TicketMode`.
  - `minQuantity` & `maxQuantity`: Observable bounds (`number | null`).
  - `isSelectable`: Boolean indicating if user can currently interact with the tier.
  - `hasSeatMap`: Boolean indicating if seated selection is required.
  - `evidence`: `DiscoveryEvidenceSnapshot` tracking exact DOM signals used for classification.
- **`ShowingSnapshot`**: Models individual performance showings (`id`, `title`, `date`, `time`, `isSelectable`).
- **`EventCatalog`**: Aggregates `eventId`, `eventTitle`, `eventUrl`, `pageType`, `showings`, `tickets`, and timestamp.
- **`TicketCandidate`**: Represents a specific candidate ticket tier and requested quantity evaluated against user preferences.

---

## 3. Passive DOM Discovery Architecture

### 3.1 Zero-Dependency Abstraction (`DOMElementLike`)

To support both the live browser runtime (Content Script running inside Chrome Manifest V3) and deterministic test execution in Vitest without requiring heavy external dependencies (e.g. `jsdom`), the discovery layer defines the `DOMElementLike` interface:

- Supports `querySelector`, `querySelectorAll`, `getAttribute`, `hasAttribute`, `classList`, and `textContent`.
- Browser adapter: `wrapBrowserElement(element: Element): DOMElementLike`.
- Deterministic parser: `parseHtmlToDOMElementLike(html: string): DOMElementLike` implementing a lightweight regex-based tokenizer supporting tag matching, compound attribute filters (`input[type="number"]`), class selectors (`.ticket-item`), and ID selectors (`#event-title`).

### 3.2 Non-Mutating Content Script Scanner

Content scripts passively observe DOM mutations via `MutationObserver` or explicit one-shot queries. Under no circumstance does the discovery adapter execute `.click()`, trigger `.focus()`, or dispatch keyboard/mouse synthetic events.

---

## 4. Ticket & Price Normalization Rules

### 4.1 Currency & Price Regex (`VND`)

Ticketbox represents prices in Vietnamese Đồng across various formats:

- Formats: `900.000 đ`, `1,200,000 VND`, `2.500.000 VNĐ`, `Miễn phí` (Free).
- Regex pattern: Unicode-aware case-insensitive pattern with word boundaries and flexible currency symbols:
  ```regex
  /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:đ|vnd|vnđ|d)/iu
  ```
- Normalization:
  - Thousands separators (`.` or `,`) stripped.
  - Parsed integer converted to `Money.fromDecimal(amount, 'VND')`.
  - Zero/free labels (`miễn phí`, `0 đ`, `free`) normalized to `0 VND`.
  - When no price is observable, falls back to `0 VND` with an explicit diagnostic warning.

### 4.2 Ticket Name Normalization

- Removes leading/trailing whitespace, bullet points, and redundant price fragments from category titles.
- Retains alphanumeric tier labels (e.g. `VIP 1 Standing`, `CAT 2 - Khán đài B`).

---

## 5. Availability Signals & Classification Rules

The `AvailabilityEvaluator` classifies ticket tier availability using observable DOM signals:

| Availability      | Observable Signals                                                                                                                                                      |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SOLD_OUT`**    | Text contains `hết vé`, `sold out`, `hết chỗ`, `tạm hết`; or badge element `.sold-out`; or seated zone with 0 available seats.                                          |
| **`NOT_STARTED`** | Text contains `sắp mở bán`, `coming soon`, `chưa mở bán`, `sắp diễn ra`.                                                                                                |
| **`CLOSED`**      | Text contains `đã kết thúc`, `sale ended`, `đóng bán`, `closed`.                                                                                                        |
| **`AVAILABLE`**   | Contains active quantity stepper (`input:not(:disabled)`), selectable radio/checkbox, clickable select button, or explicit `đang bán` text without sold out indicators. |
| **`UNKNOWN`**     | Ambiguous, hidden, conflicting signals, or missing interaction controls.                                                                                                |

### 5.1 The `UNKNOWN` Invariant

> **CRITICAL INVARIANT:** Under no condition can `UNKNOWN` availability be converted into `AVAILABLE`.

- If a ticket's status cannot be proven with clear DOM evidence, it MUST remain `UNKNOWN`.
- The `TicketCandidateSelector` strictly discards all candidate tickets whose status is `UNKNOWN`, `SOLD_OUT`, `NOT_STARTED`, or `CLOSED`.
- Prevents the assistant from prematurely attempting reservations on unconfirmed or speculative inventory.

---

## 6. Seated vs Standing Rules

1. **Standing Zones (`TicketMode.STANDING`):**
   - Free standing / general admission areas.
   - Identified by labels (`standing`, `đứng`, `ga`, `khu đứng`) and standard quantity stepper controls.
   - Availability is governed directly by tier stepper presence and disabled state.

2. **Seated Zones (`TicketMode.SEATED`):**
   - Numbered seating or reserved seat sections.
   - Identified by labels (`ngồi`, `seated`, `ghế`, `khán đài`) or the presence of a visual seat map.
   - **Seat-Map Invariant:** The visual presence of a seat map (`canvas`, `svg.seatmap`, `[data-seat-map]`) is **NOT** evidence of seat availability.
   - If a seated zone is observed to have `availableSeats = 0` or all seat nodes are `taken`/`occupied`, `AvailabilityEvaluator` classifies the tier as `SOLD_OUT`.
   - **BLOCKED_BY_DISCOVERY Boundary:** Automated seat coordinate selection or automated clicking on SVG/Canvas nodes is strictly blocked. In seated mode, automated selection stops and requires human intervention or stub verification.

---

## 7. Quantity Discovery & Boundary Enforcement

1. **Observable Quantity Bounds:**
   - Evaluated from input attributes (`min`, `max`), stepper data attributes (`data-max-qty`), or `<select>` option counts.
2. **Strict Null Preservation:**
   - If min or max quantity is not explicitly observable in the DOM, `minQuantity = null` and `maxQuantity = null`.
   - **PROHIBITION:** The assistant MUST NEVER invent arbitrary quantity limits (e.g. defaulting `maxQuantity = 4`).
3. **Quantity Selection Checks:**
   - If user requests `desiredQuantity = 3`, but observable `maxQuantity = 2`, `TicketCandidateSelector` rejects the selection (or caps it if configured, reporting an explicit bound failure).
   - If user requests `desiredQuantity < minQuantity`, the candidate is rejected.
4. **Mutative Action Boundary:**
   - `TicketboxPageAdapter.selectQuantity()` remains `BLOCKED_BY_DISCOVERY`. No DOM value modification or event dispatch is performed.

---

## 8. Multi-Ticket Preference & Fallback Matching

The `TicketCandidateSelector` evaluates user preferences (`TicketPreference[]`) against the discovered `EventCatalog`:

- **Priority Preservation:** Preferences are checked in strict array order (`priority 1` > `priority 2` > `priority 3`).
- **Exact & Fuzzy Category Matching:** Matches preference `category` (e.g. `VIP 1`) against normalized ticket names.
- **Fallback Policy:**
  - If `allowFallback: false`: Only the first preference (priority 1) is considered. If unavailable, no fallback is selected.
  - If `allowFallback: true`: Evaluator proceeds to priority 2, priority 3, etc., until an `AVAILABLE` candidate satisfying quantity bounds is found.
  - If all preferences are unavailable or sold out, selector returns `null` with a diagnostic reason (e.g. `All candidate tickets are unavailable or sold out`).

---

## 9. Pre-Booking Revalidation Contract

Before any state transition from `SELECTING` towards `RESERVING`, the assistant must execute a revalidation check (`AvailabilityEvaluator.revalidateBooking()`):

1. **Fresh DOM Snapshot:** Verifies that the selected ticket is still listed on the page.
2. **Status Consistency:** Confirms the ticket is still `AVAILABLE` and not disabled or marked sold out during the selection phase.
3. **Quantity Recheck:** Verifies the requested quantity remains within observable bounds.
4. If revalidation fails, state machine aborts the attempt and returns to `MONITORING` or `FAILED` without dispatching ungrounded reservation requests.

---

## 10. Unresolved Discovery Items (`BLOCKED_BY_DISCOVERY`)

The following capabilities are intentionally blocked until Phase 8 active sale network analysis:

1. **Interactive Seat Selection:**
   - Coordinate mapping, SVG seat clicking, and seat lock requests remain unmapped.
2. **Quantity Stepper Mutation:**
   - Dispatching synthetic input/change events to stepper controls is blocked.
3. **Reservation Hold API Endpoint:**
   - The authoritative HTTP request method, URL, headers, and payload schema for holding inventory remain uncaptured.
4. **Real-time Inventory Polling/WebSockets:**
   - Transport mechanism (WebSocket vs SSE vs REST polling) remains unverified.
