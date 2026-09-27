# Ticketbox Purchase Assistant — Agent Guidelines

## 1. Project Context & Boundaries

This repository implements the **Ticketbox Purchase Assistant**, a browser extension for ticket booking on Ticketbox with strict reservation boundary protection, profile-isolated multi-account orchestration, zero credential persistence, and a domain-driven state machine.

### Critical Operating Constraints:

- **Phase 8 Pre-Discovery Hardening:** Production Ticketbox selectors and hold endpoints remain **BLOCKED_BY_DISCOVERY**.
- **Discovery Must Remain Passive:** The assistant must NEVER click Buy, Reserve, Checkout, or mutate page state during discovery.
- **State Machine is Authoritative:** No state transition can be inferred merely from DOM changes, button clicks, or client callbacks without authoritative server evidence.
- **Fail Safe / Security First:** Zero credential storage (passwords, OTPs, CVV, raw tokens, cookies). All logs, network captures, and snapshots must be strictly sanitized.

---

## 2. Agent Skills Directory

Agent specialized skills are organized under `.agents/skills/`:

- `.agents/skills/documentation/`: Documentation standards and architectural record guidelines.
- `.agents/skills/extension-architecture/`: Manifest V3 extension standards, service worker lifecycle, and content script isolation.
- `.agents/skills/implementation/`: Domain-driven clean architecture and port/adapter implementation patterns.
- `.agents/skills/multi-account/`: Profile isolation, cross-context prevention, and global stop orchestration.
- `.agents/skills/security/`: Mandatory security controls, forbidden storage, and sanitization boundaries.
- `.agents/skills/state-machine/`: Authoritative state transitions and evidence verification.
- `.agents/skills/testing/`: Vitest test suite guidelines, negative testing, and invariant verification.
- `.agents/skills/ticketbox-discovery/`: Safe passive discovery methodologies without automated DOM mutation.

---

## 3. Engineering Source of Truth

Read and adhere to the following authoritative documents before modifying architecture:

- `docs/ticketbox/00-project-overview.md`
- `docs/ticketbox/04-state-machine.md`
- `docs/ticketbox/08-security-and-compliance.md`
- `docs/ticketbox/12-ai-engineering-rules.md` (and `AI_ENGINEERING_RULES.md`)
- `docs/ticketbox/15-architecture-baseline.md`
- `docs/ticketbox/17-ticketbox-adapter-evidence.md`
