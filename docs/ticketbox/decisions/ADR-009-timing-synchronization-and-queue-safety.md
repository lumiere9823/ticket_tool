# ADR-009 — Timing Synchronization, Precision Foreground Scheduling, Pre-warm, and In-Queue Safety

**Status:** Accepted  
**Date:** 2026-10-02  
**Deciders:** Core Engineering Team  
**Consulted:** ADR-004, ADR-008, docs/ticketbox/00-project-overview.md, docs/ticketbox/04-state-machine.md, docs/ticketbox/08-security-and-compliance.md, docs/ticketbox/17-ticketbox-adapter-evidence.md

---

## 1. Context & Problem Statement

In competitive ticket booking, assistant self-induced latency (time difference between the platform's exact sale opening timestamp $T_0$ and the assistant's first active monitoring action) determines whether inventory can be evaluated before exhaustion. However, minimizing this latency must **never** involve anti-bot evasion, unauthorized API bombardment, waiting room bypassing, or multi-account queue hoarding.

Prior to this decision:

1. **Clock Discrepancy:** The assistant relied solely on the local client clock (`Date.now()`), which frequently diverged from Ticketbox server time by 1–5+ seconds.
2. **Timer Drift & SW Throttling:** Background Service Workers in Chrome MV3 are subject to coarse alarm resolution (minimum 1 minute or pre-wake inaccuracies) and process termination.
3. **Cold Cache at $T_0$:** At sale opening, the assistant had to issue cold queries for showing metadata, tier structures, and question form schemas.
4. **Queue / Waiting Room Position Loss:** When Ticketbox engaged a virtual waiting room (e.g. Queue-it), automated zoom-thrash reloads or 404 stray-page recoveries could trigger page reloads, destroying the user's queue position.

---

## 2. Decision & Architectural Principles

We implement a four-pillar timing synchronization and queue safety architecture:

### 2.1 Server Clock Synchronization (`ServerClockPort` & `HttpDateServerClockAdapter`)

- Pure domain algorithms in `ServerClock.ts`:
  - Offset calculation: $\text{offset} = \text{serverTime} + \frac{\text{RTT}}{2} - \text{clientNow}$.
  - Multi-sample selection prioritizing the sample with the lowest round-trip time ($\text{RTT}$).
  - Explicit uncertainty estimation ($\pm 500\text{ms} + \frac{\text{RTT}}{2}$) reflecting HTTP `Date` 1-second resolution.
- Infrastructure adapter uses `safeTicketboxFetch` (`credentials: 'omit'`) against allowlisted hosts (`ticketbox.vn`).
- Fallback: Uses client local time with explicit warning in popup if synchronization fails.

### 2.2 Content-Script Precision Scheduling (`PrecisionContentTimer`)

- Service worker provides alarms strictly for coarse wake-up (`SCHEDULED_ARM_PREWAKE` and `SCHEDULED_ARM`).
- The foreground content script tab owns the precise $T_0$ trigger:
  - Coarse `setTimeout` until $T_0 - 300\text{ms}$.
  - Fine-grained `requestAnimationFrame` and `performance.now()` loop to intercept the exact millisecond threshold without busy-wait CPU burn.
  - Fallback timeout handles background tab throttling.
  - Idempotent execution lock (`isExecutingScheduledArm`) prevents dual activation.

### 2.3 Read-Only Pre-Warm & Readiness Policy (`PreWarmPurchasePlanUseCase`)

- Pre-warms showing, ticket tiers, and question form schemas before $T_0$ strictly via whitelisted GET endpoints.
- Purely read-only; absolutely zero DOM mutations or premature reservation attempts.
- Popup readiness checklist (`evaluatePreT0Readiness`) verifies clock sync, foreground tab status, authentication, profile completeness, and terms consent.

### 2.4 Safe `IN_QUEUE` State & Anti-Thrash Protection

- Introduces first-class `IN_QUEUE` state to the domain state machine.
- `ActionGuard` strictly restricts actions in `IN_QUEUE` to `OBSERVE` and `USER_ACTION`. Mutating actions (`SELECT`, `RESERVE`, `CHECKOUT`, `PROCEED`) are fail-closed rejected.
- Automatic page reloads (from anti-bot zoom-thrash watchdog and 404 stray-page recovery) are strictly suppressed during `IN_QUEUE` to protect queue position.
- Detection relies on passive evidence (domain indicators such as `queue-it.net`); unverified challenges fall back to `UNKNOWN_SECURITY_CHALLENGE` without guessing proprietary selectors.

---

## 3. Consequences & Invariants Maintained

- **Zero Evasion:** No CAPTCHA solving, waiting room skipping, or rate limit bypass.
- **Fairness:** Single tab, single active session; no multi-tab queue hoarding.
- **Fail-Safe:** Service worker crash rehydrates safely into passive observation mode.
- **Privacy:** `LatencyTracker` captures only numeric millisecond timestamps without PII or tokens.
