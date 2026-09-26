# Chrome Extension Architecture Skill

## Purpose

This skill governs the architecture and implementation of the Chrome Extension.

The extension must remain modular, testable, secure, and independent from Ticketbox-specific implementation details.

---

## 1. Architecture

Use the following conceptual layers:

src/
├── extension/
│   ├── background/
│   ├── content/
│   ├── popup/
│   └── shared/
│
├── domain/
├── application/
└── infrastructure/

---

## 2. Dependency Direction

The dependency direction is:

Domain
    ↑
Application
    ↑
Infrastructure
    ↑
Extension

The domain MUST NOT depend on:

- Chrome APIs
- DOM
- fetch
- browser storage
- Ticketbox
- network infrastructure

---

## 3. Domain Layer

The domain contains:

- entities
- value objects
- policies
- state machine
- business rules
- domain errors

The domain must be executable in a normal Node/Vitest environment.

No browser should be required.

---

## 4. Application Layer

Application layer contains use cases such as:

- StartMonitoring
- StopMonitoring
- DetectAvailability
- SelectTicket
- BeginReservation
- HandleReservationResult
- RecoverAttempt

Application logic must not know CSS selectors.

---

## 5. Infrastructure Layer

Infrastructure contains:

- Chrome storage
- Chrome messaging
- browser integration
- Ticketbox adapter
- logging
- external APIs where explicitly required

---

## 6. Content Script

Content scripts must remain thin.

They may:

- inspect the page
- communicate with the adapter
- observe relevant UI changes
- execute explicitly approved page interactions

They must NOT contain:

- core business rules
- retry algorithms
- state-machine logic
- multi-account policy
- purchase orchestration

---

## 7. Background Service Worker

The background worker is responsible for:

- extension lifecycle
- message coordination
- persistent extension state
- orchestration that belongs at extension level

Do not place large business algorithms directly inside the service worker.

---

## 8. Popup

Popup is presentation only.

It should:

- display state
- display configuration
- expose user-approved controls
- show errors
- request operations

It must not contain business logic.

---

## 9. Message Bus

Every message must be typed.

Example:

type Message =
  | StartMonitoringMessage
  | StopMonitoringMessage
  | StateChangedMessage
  | AvailabilityDetectedMessage
  | ReservationStartedMessage
  | ReservationConfirmedMessage
  | ReservationFailedMessage;

Messages must have validated payloads.

Reject malformed messages.

---

## 10. Attempt Identity

Every purchase attempt must have a unique:

attemptId

All relevant logs and state transitions should reference this identifier.

---

## 11. Ticketbox Adapter

All Ticketbox-specific behavior must be isolated behind an adapter.

Examples:

- selectors
- page parsing
- Ticketbox-specific state interpretation
- endpoint knowledge
- Ticketbox-specific error mapping

Do NOT scatter Ticketbox-specific code across:

- domain
- application
- popup
- background

---

## 12. Chrome Permissions

Use least privilege.

Every permission must have a documented reason.

Do not add broad permissions merely because they might be useful later.

---

## 13. Storage

Create a storage abstraction.

The rest of the application should not directly depend on:

chrome.storage.*

Never persist:

- password
- OTP
- CVV
- payment credentials
- raw authentication cookies
- raw session tokens

---

## 14. Critical Path

Keep the purchase critical path as short as practical.

Do not introduce:

- unnecessary backend calls
- unnecessary logging
- unnecessary analytics
- unnecessary synchronization

into the critical path.

---

## 15. Manifest

Use Manifest V3.

Do not use deprecated extension architecture unless there is a documented technical reason.

---

## 16. Final Rule

The extension is infrastructure around the domain.

The domain is NOT infrastructure around the extension.

Keep these boundaries explicit.