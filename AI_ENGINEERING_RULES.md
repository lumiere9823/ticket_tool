# AI Engineering Rules — Ticketbox Purchase Assistant

**Source of Truth:** `docs/ticketbox/12-ai-engineering-rules.md`

## Summary of Core Invariants

1. **Rule 01 — Read Documentation First:** Always review state machine, security, and architecture baseline documents before making changes.
2. **Rule 02 — Never Invent Ticketbox APIs:** Endpoints like `/api/reserve`, `/api/tickets` without captured evidence remain `TBD` and `BLOCKED_BY_DISCOVERY`.
3. **Rule 03 — Evidence Before Implementation:** Production selectors and endpoints require verified evidence log entries.
4. **Rule 04 — No Business Logic in DOM Code:** Content scripts only observe; all business logic lives in Domain/Application layers.
5. **Rule 05 — State Machine Is Authoritative:** Do not infer `HELD` or `CONFIRMED` from button text, URLs, CSS, or client callbacks.
6. **Rule 06 — Server Confirmation:** `RESERVATION_CONFIRMED` requires authoritative server hold ID. `PAYMENT_CONFIRMED` requires authoritative order ID or confirmation reference.
7. **Rule 07 — No Infinite Automation:** Bounded retries and explicit stop conditions only.
8. **Rule 08 — Safe Unknown State:** State mismatches transition to safe `UNKNOWN` or `STOPPED`.
9. **Rule 09 — Credentials:** Never store passwords, OTPs, CVVs, or payment cards.
10. **Rule 10 — Network Logging:** Never log raw Cookies, Authorization headers, or payment credentials.
11. **Rule 11 — No Platform Security Bypass:** Do not attempt to bypass CAPTCHA, queues, or anti-bot protections.
12. **Rule 12 — Profile Isolation:** Accounts are isolated via independent browser profiles; no cookie swapping.
13. **Rule 13 — Typed Messages:** All IPC messages strictly follow typed schemas.
14. **Rule 14 — Correlation:** Every attempt carries an `attemptId`.
15. **Rule 15 — Test Before Refactor:** Run tests before and after changes.
16. **Rule 16 — Small Commits:** Keep changes modular and focused.
17. **Rule 17 — No Speculative Abstraction:** Build verified requirements only.
18. **Rule 18 — TBD Means STOP:** Do not fill missing discovery data with assumptions.
19. **Rule 19 — Critical Path Protection:** Keep the reservation critical path strictly local (extension ↔ page).
20. **Rule 20 — Documentation Is Code:** Keep documentation synchronized with implementation.
