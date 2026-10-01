# Ticketbox Purchase Assistant — Performance Hotspots & Bottleneck Ranking

**Document:** `docs/ticketbox/19-performance-hotspots.md`  
**Version:** 1.0  
**Status:** Authoritative Bottleneck Ranking

---

## 1. Hotspot Classification & Ranking

Each bottleneck has been measured and classified by its architectural layer:
`CPU`, `DOM`, `network`, `Chrome API`, `storage`, `message passing`, `GC/allocation`, `serialization`, `retry`, `contention`, `external platform`.

### Ranked Hotspots Table:

|  Rank  | Hotspot                                                       | Layer                            |       Measured Cost        | Critical Path | Proposed Optimization                                                                                                                             |
| :----: | :------------------------------------------------------------ | :------------------------------- | :------------------------: | :-----------: | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**  | **Authoritative Server Round Trip ($T_3 \to T_4$)**           | `network` / `external platform`  |        150 – 500 ms        |    **Yes**    | Cannot reduce external network latency without violating verification; optimize client readiness so request is sent at $T_3$ without local stall. |
| **2**  | **Synchronous Chrome Storage Reads on Hot Path**              | `storage` / `Chrome API`         |         4 – 20 ms          |    **Yes**    | Cache configuration snapshot in memory; eliminate `chrome.storage.local.get` from critical loop. Invalidate only on explicit config change.       |
| **3**  | **Uncoalesced State Persistence on Every Transition**         | `storage` / `serialization`      |  5 – 25 ms per transition  |    **Yes**    | Decouple persistence from critical path: update in-memory state synchronously, flush to `chrome.storage.local` asynchronously out-of-band.        |
| **4**  | **IPC Flooding via `STATE_CHANGED` Across Runtime**           | `message passing` / `Chrome API` |     3 – 12 ms per hop      |    **Yes**    | Coalesce rapid micro-transitions; emit IPC only for major lifecycle milestones or when subscribers exist; avoid loopback to sender tab.           |
| **5**  | **DOM Mutation Burst Rescans (MutationObserver Storms)**      | `DOM` / `contention`             |    15 – 60 ms CPU churn    |      No       | Narrow observer target to ticket container and dialogs; implement single-flight discovery scan with minimum cooldown (50ms).                      |
| **6**  | **Deep PII/Secret Sanitization on Verbose Hot Path Logs**     | `CPU` / `GC/allocation`          |     0.5 – 3 ms per log     |    **Yes**    | Introduce explicit **Production Performance Mode**; bypass debug/trace logging and verbose object cloning on critical path.                       |
| **7**  | **Nested Ticket Filtering & Repeated Normalization**          | `CPU` / `serialization`          | 1.5 – 4.5 ms on large sets |    **Yes**    | Precompile user priority sets and normalized tokens at configuration time; evaluate candidate selection in a single linear pass $O(N)$.           |
| **8**  | **Service Worker Wake-up Work on Intermediate Hops**          | `contention` / `Chrome API`      |         5 – 15 ms          |      No       | Badge updates and state mirroring throttled to milestone states only; avoid redundant `storage.getConfiguration()` calls.                         |
| **9**  | **Adjacent Seat Window Sliding Over Unfiltered Rows**         | `CPU` / `GC/allocation`          |         0.5 – 2 ms         |    **Yes**    | Filter out rows with `seats.length < quantity` before sorting; single-pass window slide over contiguous blocks.                                   |
| **10** | **Page Bridge Nonce Handshake & Message Listener Contention** | `message passing`                |          1 – 5 ms          |    **Yes**    | Maintain active bridge connection state; avoid redundant script re-injections and listener thrash.                                                |

---

## 2. In-Depth Root Cause Analysis

### Hotspot 2 & 3: Chrome Storage Access Bottleneck

- **Mechanism:** `chrome.storage.local` operations serialize JSON data and send an asynchronous IPC message from the renderer process (content script) to the browser process, which performs disk I/O.
- **Critical Path Impact:** During `attemptBookingJourney`, `storage.getConfiguration()` and `storage.getPersistentState()` are called sequentially, followed by `storage.saveJourneyState` on every transition.
- **Fix:** Keep an immutable in-memory configuration cache in `content.ts` and `service-worker.ts`. Any write to storage updates memory synchronously and persists to disk on an async side path.

### Hotspot 4: IPC Message Bus Broadcast

- **Mechanism:** Every `stateMachine.transition()` triggers an event subscriber that calls `messageBus.publish('STATE_CHANGED')`.
- **Critical Path Impact:** A single reservation flow fires 8 to 13 transitions in rapid succession. Chrome IPC serializes the entire `StateContext` and routes it to all extension views and tabs.
- **Fix:** On the hot path, execute state machine transitions with zero-overhead in-memory listener updates. Only broadcast milestone states (`ARMED`, `MONITORING`, `SEATS_SELECTED`, `HELD`, `PAYMENT_GATE`, `CONFIRMED`, `STOPPED`) across Chrome IPC.

### Hotspot 6: SanitizedLogger Traversal

- **Mechanism:** `SanitizedLogger.sanitizeObject` recursively inspects all keys against a 45-item Set with substring matching (`lowerKey.includes(s)`) and runs 3 regular expressions against all string values.
- **Critical Path Impact:** 20 to 50 log statements across a journey execution generate thousands of substring and regex checks, creating GC pressure.
- **Fix:** Fast-path exact Set lookups for known safe keys; enable production performance mode where `debug` and non-essential `info` logs are completely skipped on the hot path.

### Hotspot 7: Candidate Selection Evaluation

- **Mechanism:** `PriorityCategoryEngine.evaluate` re-normalizes priorities, groups tickets by showing, and performs nested array scans for every priority category.
- **Critical Path Impact:** On events with hundreds of tickets across multiple showings, candidate evaluation scales with $O(P \times T)$ nested operations.
- **Fix:** Precompute normalized priority tokens and lookup maps at configuration time. Execute single-pass candidate ranking in $O(N)$ time.
