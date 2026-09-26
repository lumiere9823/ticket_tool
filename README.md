# Ticketbox Purchase Assistant

A browser-based purchase assistant for Ticketbox engineered with strict reservation boundary verification, isolated domain logic, least-privilege security, and multi-profile orchestration capabilities.

> **Core Principle (BR-001..BR-003):**  
> `SELECTED ≠ RESERVED` and `RESERVING ≠ HELD`.  
> A reservation is a server-side business state confirmed by authoritative server evidence, not a browser click.

---

## 1. Architectural Highlights

- **Extension-First (ADR-001):** Primary execution client is a Chrome Extension (Manifest V3) running within the user's browser context.
- **Local Critical Path (ADR-002):** Zero external backend servers or queues in the critical purchase path.
- **Profile-Level Account Isolation (ADR-003):** Multi-account support is achieved strictly through isolated Chrome browser profiles (`Default`, `Profile 1`, etc.). No session cookie extraction or switching.
- **Clean Architecture:** Domain and Application layers are 100% pure TypeScript with zero Chrome or DOM API dependencies. Fully testable without a browser.
- **Safe Discovery Mode:** Inspects DOM and network metadata passively without automated clicking until verified server evidence is established.
- **Sanitized Observability:** Real-time latency tracking ($T_0 \dots T_5$) with automatic masking of tokens, passwords, cookies, and payment credentials.

---

## 2. Directory Structure

```text
├── docs/ticketbox/            # Authoritative architecture, PRD, and discovery docs
│   ├── decisions/             # ADR-001, ADR-002, ADR-003
│   ├── 00-project-overview.md
│   ├── 01-product-requirements.md
│   ├── 04-state-machine.md
│   ├── 05-reservation-boundary.md
│   ├── 06-multi-account-orchestration.md
│   ├── 08-security-and-compliance.md
│   ├── 14-repository-audit.md           # Phase 0 Audit
│   ├── 15-architecture-baseline.md       # Phase 1 Freeze
│   ├── 16-technology-stack.md           # Phase 2 Tech Decision
│   └── 17-ticketbox-adapter-evidence.md # Discovery Evidence Log
│
├── src/
│   ├── domain/                # Pure domain layer (entities, policies, state machine)
│   ├── application/           # Use cases, ports, and latency services
│   ├── infrastructure/        # Chrome storage, message bus, sanitized logger, adapters
│   └── extension/             # Manifest V3 service worker, content script, popup UI
│
├── tests/
│   └── unit/                  # Vitest unit test suites (Domain, Application, Security)
│
├── public/
│   └── manifest.json          # Chrome Extension Manifest V3
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 3. Prerequisites

- **Node.js:** `>= 20.x` (tested on Node.js `v24.11.1`)
- **Package Manager:** `npm` (`>= 10.x`)
- **Browser:** Google Chrome or Chromium-based browser supporting Manifest V3

---

## 4. Development Workflow

### 4.1 Installation

```bash
npm install
```

### 4.2 Type Checking

```bash
npm run typecheck
```

### 4.3 Running Tests

```bash
npm test
```

### 4.4 Linting & Formatting

```bash
npm run lint
npm run format:check
```

### 4.5 Production Build

```bash
npm run build
```

The compiled, ready-to-load extension will be generated in `dist/`.

---

## 5. Loading the Extension in Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `dist/` directory inside this repository.
5. The **Ticketbox Purchase Assistant** icon will appear in the toolbar.
6. Click the extension icon to configure target event URL, ticket category priorities (e.g. `VIP, CAT 1, CAT 2`), and desired quantity.

---

## 6. Debugging & Discovery Mode

- **Service Worker Console:** Click the `background.js` (or service worker) link in `chrome://extensions/` under the extension card to open DevTools.
- **Content Script Console:** Press `F12` on any `ticketbox.vn` page to view passive discovery logs.
- **Popup Console:** Right-click the extension popup and select **Inspect**.

---

## 7. Security Mandate

1. **No Credential Storage:** The extension never prompts for, captures, or persists passwords, OTP codes, or payment cards.
2. **Sanitized Logs:** All tokens, cookies, authorization headers, and CVVs are automatically masked as `[REDACTED]`.
3. **No Abuse Controls Bypass:** CAPTCHA, waiting queues, and rate limits are never bypassed. Platform errors trigger safe, bounded stop.
