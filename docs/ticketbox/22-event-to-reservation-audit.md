# Ticketbox Purchase Assistant — Event-to-Reservation Pipeline Audit

> **Document ID:** TB-PERF-022  
> **Status:** Production Authoritative  
> **Target Metric:** Minimize the REAL browser-runtime latency between earliest observable ticket state change (`T_EVENT`) and authoritative reservation initiation (`T_RESERVATION`).

---

## 1. Pipeline Definition & Telemetry Markers

To evaluate real browser-runtime performance rather than artificial microbenchmarks, the pipeline is decomposed into six canonical telemetry milestones:

```text
T_EVENT
  └── T_DETECTED
        └── T_DISCOVERY
              └── T_CANDIDATE
                    └── T_RESERVATION
                          └── T_RESULT
```

| Marker          | Description                                                                    | Detection Mechanism                                                                                   | Critical Boundary Rule                                                      |
| --------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `T_EVENT`       | Earliest observable browser signal indicating inventory/ticket status changed. | DOM mutation (button enabled, status badge text, class change), network response, or WebSocket event. | Raw browser signal; non-mutating.                                           |
| `T_DETECTED`    | Moment content script or observer receives and classifies the signal.          | `MutationObserver` callback + `MutationClassifier.classifyBatch()`.                                   | Must filter irrelevant/cosmetic noise without delaying inventory signals.   |
| `T_DISCOVERY`   | Completion of ticket catalog extraction from DOM or showing API.               | `TicketboxJourneyAdapter.discoverTicketCatalog()`.                                                    | Must query minimal authoritative data; no speculative full summary parsing. |
| `T_CANDIDATE`   | Target ticket tier chosen by priority matching engine.                         | `PriorityCategoryEngine.evaluate()`.                                                                  | Pure domain operation in in-memory JavaScript (< 0.5 ms).                   |
| `T_RESERVATION` | Initiation of legitimate reservation action on ticket tier.                    | `TicketboxJourneyAdapter.selectTicket()`.                                                             | Authoritative hold initiation. `SELECTED ≠ RESERVED`.                       |
| `T_RESULT`      | Authoritative confirmation received from server.                               | Showing API / Cart / Seat hold response.                                                              | Transition to `HELD` authorized ONLY upon verifiable proof.                 |

---

## 2. DOM Mutation Classification & Fast Path

### 2.1 The 100ms Coalescing Problem

The previous implementation applied an unconditional `MUTATION_COOLDOWN_MS = 100` debounce across all observed DOM mutations. While essential to protect against layout storms caused by 10,000 ad banner updates or third-party tracking scripts, delaying legitimate ticket inventory releases by 100ms added unacceptable real browser lag.

### 2.2 Mutation Taxonomy

We introduced `MutationClassifier` (`src/infrastructure/ticketbox/parsing/MutationClassifier.ts`), which inspects mutation batches and categorizes them into four disjoint categories:

1. **`IRRELEVANT`**:
   - Mutations on `<script>`, `<style>`, `<link>`, `<noscript>`, `<iframe>`, `<svg>`, `<meta>`, `<head>`.
   - Ignored immediately with zero scheduling overhead.
2. **`COSMETIC`**:
   - Attribute or class changes unrelated to ticketing (e.g. `header-scroll`, `ad-banner-active`, tooltips, carousel transitions).
   - Coalesced into a background debounce queue (100 ms).
3. **`STRUCTURAL`**:
   - Generic `<div>`, `<section>`, `<ul>` additions that do not match ticketing patterns.
   - Coalesced into a background debounce queue (100 ms) to avoid thrashing during hydration.
4. **`INVENTORY_RELEVANT`**:
   - Attribute changes on `disabled`, `aria-disabled`, `aria-pressed`, `value` on interactive elements.
   - Class additions matching `/ticket|seat|showing|price|tier|zone|area|booking|stepper|quantity/i` or `available`, `active`, `sold-out`.
   - Text node updates containing keywords: `mua vé`, `mua ngay`, `đặt vé`, `còn vé`, `chọn ghế`, `hết vé`, `sold out`, `tạm hết`, currency symbols (`đ`, `VND`).
   - **Action:** Immediately triggers the **0ms Fast Path** (`scheduleDiscoveryScan(0)`), clearing any active cooldown timers.

### 2.3 Measured Empirical Results

Tested under realistic DOM conditions with Vitest performance harness (`tests/performance/event-to-reservation.test.ts`):

- **Baseline (100ms Coalescing):**
  - p50: **109.61 ms**
  - p95: **110.51 ms**
  - max: **110.77 ms**
- **Fast Path (0ms on Inventory Relevant):**
  - p50: **14.86 ms**
  - p95: **16.15 ms**
  - max: **17.28 ms**
- **Net Latency Reduction:** **~94.75 ms** saved on the critical path (>86% reduction in latency to reservation).

---

## 3. Discovery Deduplication & Storm Prevention

### 3.1 The Problem

When a major ticket drop occurs, the browser DOM experiences dozens of concurrent mutations (e.g., button enabled + badge changed to "Còn vé" + price tag updated + countdown timer removed). If every mutation triggered an independent scan and decision, the assistant would spawn multiple conflicting booking attempts, overloading the main thread and triggering rate limits.

### 3.2 Deduplication Invariants

1. **Single Flight Scan Lock:** `isDiscoveryScanning` ensures only one discovery scan executes at any given instant. Additional mutations arriving during an active scan set a dirty flag rather than queueing parallel runs.
2. **Single Flight Journey Lock:** `activeJourneyPromise` and `isExecutingJourney` guarantee that once a ticket candidate is selected, subsequent discovery runs cannot initiate competing journey executions.
3. **Burst Scale Resistance:**
   - 1 mutation: **1 scan, 1 decision** (p50: 15.38 ms).
   - 10 mutations: **1 scan, 1 decision** (p50: 15.67 ms).
   - 100 mutations: **1 scan, 1 decision** (p50: 14.53 ms).
   - 1,000 mutations: **1 scan, 1 decision** (p50: 16.49 ms).
   - 10,000 mutations: **1 scan, 1 decision** (p50: 14.44 ms).
   - **Verification:** 10,000 noisy mutations result in strictly **1 decision** with zero duplicate execution.

---

## 4. Pre-Warming & Idle Initialization

To eliminate setup overhead during `T_EVENT`:

1. **Pre-Compiled Priority Tokens:** User priority lists are pre-tokenized and indexed into regex matchers during `ARM` phase. Priority evaluation time: **0.16 ms** for small sets, **0.30 ms** for 50 tickets.
2. **Hot-Path Configuration Cache:** Active configuration, target event ID, and user preferences reside in the `ChromeStorageRepository` synchronous in-memory snapshot (`cachedConfig`). Zero IPC or disk access occurs to read configuration.
3. **Pre-Attached Mutation Listeners:** `MutationObserver` and `ResizeObserver` are registered during page load (`document_idle`), ensuring immediate readiness when the event goes live.

---

## 5. Critical Path Elimination

We conducted an architectural query audit asking: _Does this operation need to complete before reservation can start?_

| Operation                                           | Previous Path                          | New Path               | Latency Saved | Rationale                                                                                                                         |
| --------------------------------------------------- | -------------------------------------- | ---------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `adapter.getBookingSummary()`                       | Critical (blocking)                    | Post-selection only    | 4 – 8 ms      | Before ticket selection, cart/summary tables are empty; querying them causes useless DOM selector queries.                        |
| `storage.saveJourneyState()`                        | Critical (awaited in state subscriber) | Asynchronous side path | 5 – 12 ms     | In-memory state machine updates synchronously in <0.05ms. Disk persistence is for crash recovery and can flush in the background. |
| `messageBus.publish('STATE_CHANGED')`               | Critical (awaited in state subscriber) | Asynchronous side path | 2 – 5 ms      | Background badge and popup reflection do not affect reservation correctness.                                                      |
| `messageBus.publish('PAGE_DISCOVERY_SNAPSHOT')`     | Critical (awaited in discovery scan)   | Asynchronous side path | 1 – 4 ms      | Telemetry snapshots are diagnostic and must never delay triggering candidate evaluation.                                          |
| `chrome.storage.local.set({ latestJourneyUpdate })` | Critical (awaited in discovery scan)   | Fire-and-forget        | 3 – 8 ms      | Caching catalog snapshot for popup display is non-critical.                                                                       |

**Total Blocking Overhead Eliminated from Critical Path:** **15 – 37 ms**.

---

## 6. Adapter Query Audit: Minimal Authoritative Information

We evaluated query combinations required to initiate legitimate reservations:

| Query Set                        | Time (ms)   | Sufficient for Reservation?             | Architectural Recommendation     |
| -------------------------------- | ----------- | --------------------------------------- | -------------------------------- |
| `catalog` only                   | 12.4 ms     | Partial (missing page URL context)      | Insufficient                     |
| `catalog + eventState`           | **13.1 ms** | **YES (Complete & Authoritative)**      | **ADOPTED AS CRITICAL BASELINE** |
| `catalog + summary`              | 18.2 ms     | Redundant (summary empty pre-selection) | Rejected                         |
| `eventState + summary`           | 11.5 ms     | Insufficient (no ticket tiers)          | Rejected                         |
| `catalog + eventState + summary` | 22.8 ms     | Over-fetching on discovery              | Rejected                         |

**Conclusion:** `catalog + eventState` provides 100% of the authoritative information required to evaluate priorities and initiate ticket selection. `summary` is deferred until after ticket selection.

---

## 7. Platform Defense & Non-Bypass Compliance

The assistant strictly complies with all anti-bot and platform integrity constraints:

1. **Zero Evasion:** No CAPTCHA solving, Turnstile bypass, waiting room skipping, or fingerprint manipulation.
2. **Automated Challenge Halting:** When Turnstile/Cloudflare or Geetest challenge elements appear, state machine transitions immediately to `CAPTCHA_REQUIRED` and pauses all automated actions.
3. **Passive Token Detection:** Content script monitors for human completion (`window.__simulateSolveCaptcha` or native turnstile callback) and auto-resumes strictly after legitimate token presence.
4. **Rate Limit Protection (429):** Platform HTTP 429 errors are classified as non-retryable by `ErrorClassifier` and `RetryPolicy`, transitioning immediately to `RATE_LIMITED` without retry storms.
5. **Bounded Polling:** Enforces 1500ms safety floor with ±20% jitter.
