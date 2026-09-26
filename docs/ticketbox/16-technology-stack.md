# Ticketbox Purchase Assistant — Technology Decision Record

**Document Reference:** `docs/ticketbox/16-technology-stack.md`  
**Status:** Approved & Frozen  
**Date:** 2026-09-26

---

## 1. Environment Assessment

Prior to selecting dependencies, the host system was inspected:

- **Operating System:** Windows 10/11 Enterprise x64
- **Runtime:** Node.js `v24.11.1`
- **Package Manager:** `npm v11.6.4` (pnpm is not installed on the system; attempting to invoke pnpm fails with `CommandNotFoundException`)
- **Git:** Git is installed, but repository is uninitialized.

**Decision:** Standardize on **npm** as the canonical package manager with `package-lock.json` committed.

---

## 2. Technology Stack Selection

| Component                | Selected Technology                   | Version / Spec     | Rationale                                                                                                                               |
| :----------------------- | :------------------------------------ | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **Language**             | TypeScript                            | `^5.6.x`           | Industry standard static typing, rich compiler checks, excellent IDE support. Zero runtime overhead.                                    |
| **Target Platform**      | Chrome Extension Manifest V3          | Chrome MV3 spec    | Mandatory standard for modern Chromium extensions. Supports background service worker and isolated content scripts.                     |
| **Build Tool / Bundler** | Vite                                  | `^6.x`             | Blazing fast build speeds, native ESM support, clean multi-entry rollup builds for background, content script, and popup.               |
| **Testing Framework**    | Vitest                                | `^3.x`             | Native TypeScript test runner powered by Vite. Fast execution, standard Jest/Chai assertion compatibility, zero Babel/ts-jest overhead. |
| **DOM Test Utility**     | JSDOM (via Vitest environment)        | `^26.x`            | Allows headless testing of content script adapters and UI rendering without spinning up heavy browser binaries.                         |
| **Linter**               | ESLint + typescript-eslint            | `^9.x` flat config | Enforces code consistency, prevents subtle async bugs, catches unused variables and unsafe types.                                       |
| **Formatter**            | Prettier                              | `^3.x`             | Deterministic code formatting across all developers and CI pipelines.                                                                   |
| **Extension UI**         | Typed Vanilla TypeScript / Native DOM | Native Web API     | Zero bundle overhead, instant load time in extension popup, no virtual DOM reconciliation latency or React version conflicts.           |

---

## 3. Rejected Alternatives

### 3.1 React / Vue for Extension Popup

- **Reason for Rejection:** The extension popup has a small, well-defined state space (Configuration form, Arm/Stop status, Latency indicators). Adding React or Vue introduces ~150KB+ of minified framework bundle, virtual DOM diffing overhead, and complex hook lifecycles. Native TypeScript DOM updates are instantaneous, simpler to audit, and free of third-party vulnerabilities.

### 3.2 Webpack / Webpack Extension Reloader

- **Reason for Rejection:** Webpack configuration for MV3 is notoriously verbose and slow. Vite provides superior performance, cleaner multi-entry builds, and modern ESM configuration with minimal boilerplate.

### 3.3 pnpm / yarn

- **Reason for Rejection:** `pnpm` is not installed on the developer machine. Installing global tools outside repository boundaries violates environmental immutability. `npm` is natively available (`11.6.4`) and fully capable of reproducible lockfile management.

### 3.4 Puppeteer / Playwright in Domain Tests

- **Reason for Rejection:** Domain logic (state machine, selection strategy, retry policy) must be 100% browser-independent and executable in sub-second Vitest test suites. End-to-end browser drivers are deferred to controlled integration gates once live Ticketbox evidence is established.

---

## 4. Directory & Folder Structure

```text
ticket_tool/
├── .agents/
│   └── skills/                # Agent operational skills
├── docs/
│   └── ticketbox/             # Authoritative architecture and discovery documentation
│       └── decisions/         # ADRs
├── src/
│   ├── domain/                # Pure domain layer (zero Chrome/DOM dependencies)
│   │   ├── entities/          # Event, CandidateTicket, Reservation, PurchaseAttempt
│   │   ├── value-objects/     # AttemptId, ProfileId, Money, Quantity, PriorityList
│   │   ├── policies/          # SelectionStrategy, RetryPolicy, ErrorClassifier
│   │   ├── states/            # PurchaseState enum, state transition table
│   │   ├── state-machine/     # PurchaseStateMachine implementation
│   │   └── errors/            # DomainError, SecurityError, StateTransitionError
│   │
│   ├── application/           # Application use cases & ports
│   │   ├── use-cases/         # ArmAssistant, StartMonitoring, SelectTicket, SubmitReservation, StopAssistant
│   │   ├── ports/             # TicketboxPageAdapter, StorageRepository, EventBus, LoggerPort
│   │   └── services/          # LatencyTracker, StateSynchronizer
│   │
│   ├── infrastructure/        # Port implementations
│   │   ├── chrome/            # ChromeMessageBus, ChromeStorageRepository
│   │   ├── logging/           # SanitizedLogger (automatic secret masking)
│   │   └── ticketbox/         # TicketboxDomAdapter, TicketboxDiscoveryAdapter, SafeStubAdapter
│   │
│   ├── extension/             # Chrome Extension entry points
│   │   ├── background/        # service-worker.ts (MV3 background orchestrator)
│   │   ├── content/           # content.ts (DOM observation & event bridging)
│   │   ├── popup/             # popup.ts, popup.html, popup.css
│   │   └── shared/            # Typed message schemas, common types
│   │
│   └── ui/                    # Reusable, framework-free UI components
│
├── tests/
│   ├── unit/                  # Domain, State Machine, Policy, & Sanitizer unit tests
│   │   ├── domain/
│   │   ├── application/
│   │   └── infrastructure/
│   ├── integration/           # Message bus, storage, adapter mock tests
│   └── fixtures/              # Sample discovery responses (sanitized)
│
├── public/
│   └── manifest.json          # Manifest V3 specification
│
├── .gitignore
├── eslint.config.mjs
├── package.json
├── prettier.config.mjs
├── README.md
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

---

## 5. TypeScript Strictness Configuration

The compiler configuration in `tsconfig.json` enforces maximum strictness:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true
  }
}
```

---

## 6. Manifest V3 Permissions Strategy

In strict adherence to Principle S-001 (Least Privilege):

- **Host Permissions:** Restricted strictly to `*://*.ticketbox.vn/*` (and `*://localhost/*` for testing/discovery fixtures).
- **Chrome API Permissions:**
  - `storage`: Required for local configuration, preferences, and session state rehydration.
  - `activeTab`: Required for interacting with the currently active Ticketbox tab when user clicks the extension.
  - `tabs`: Required for checking event URLs.
  - `alarms`: Required for heartbeat checks without persistent background wake-locks.
- **Explicitly Excluded Permissions:**
  - `cookies`: Excluded to prevent direct session extraction or cookie theft.
  - `webRequestBlocking`: Excluded (MV3 declarativeNetRequest or passive observation preferred).
  - `<all_urls>`: Forbidden.
