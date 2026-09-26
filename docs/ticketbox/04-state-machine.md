# Ticketbox Purchase Assistant

## State Machine Specification

**Version:** 0.2
**Status:** Design / Discovery
**Document Type:** Source of Truth

---

# 1. Purpose

State machine là **source of truth** cho toàn bộ workflow của Ticketbox Purchase Assistant:

- Browser Extension
- Content Script
- Controller
- Automation Engine
- Human Intervention Manager
- Multi-account Orchestrator
- Notification System
- Error Handling
- Retry Policy
- Testing

State machine **không được phụ thuộc trực tiếp vào UI text**.

UI text, DOM structure, button label hoặc CSS selector chỉ được sử dụng như **signals** để xác định page state.

Không được coi:

```text
button_click_success
```

là bằng chứng của:

```text
reservation_success
purchase_success
payment_success
```

Mọi critical success state phải dựa trên evidence có thể xác minh.

---

# 2. Core Principles

## 2.1 Explicit User Arming

Automation không được tự bắt đầu purchase workflow.

User phải explicitly enable assistant:

```text
READY
  ↓
ARMED
```

Không có:

```text
ARMED
```

thì không được thực hiện purchase action.

---

## 2.2 Verified State Only

Automation engine chỉ được thực hiện action khi:

```text
current_state
+
page_state
+
required_evidence
```

đều hợp lệ.

Không được suy luận state chỉ từ:

- button text;
- URL thay đổi;
- loading spinner biến mất;
- click event thành công;
- DOM element tồn tại trong thời gian ngắn;
- client-side notification.

---

## 2.3 Server Confirmation

Các state quan trọng phải có server-confirmed evidence.

Đặc biệt:

```text
RESERVING → HELD
```

không được xảy ra chỉ vì click thành công.

Phải có bằng chứng như:

```text
reservation_id
hold_id
checkout_reference
server-confirmed inventory state
server response
```

Exact evidence sẽ được xác định trong implementation phase.

---

## 2.4 Human Intervention Is First-Class

Human intervention là một phần chính thức của workflow.

Automation phải pause khi gặp:

```text
CAPTCHA_REQUIRED
OTP_REQUIRED
PAYMENT_ACTION_REQUIRED
SESSION_REAUTH_REQUIRED
UNKNOWN_SECURITY_CHALLENGE
```

Không bypass:

- CAPTCHA
- OTP
- authentication challenge
- payment verification
- security challenge
- anti-bot mechanism

---

# 3. Global Lifecycle

Normal workflow:

```text
INIT
  ↓
AUTH_CHECK
  ↓
EVENT_CHECK
  ↓
READY
  ↓
ARMED
  ↓
MONITORING
  ↓
AVAILABLE_DETECTED
  ↓
SELECTING
  ↓
TICKET_TYPE_SELECTION
  ↓
QUANTITY_SELECTION
  ↓
SEAT_SELECTION
  ↓
RESERVING
  ↓
HELD
  ↓
CHECKOUT
  ↓
PAYMENT
  ↓
CONFIRMED
```

Human intervention có thể xảy ra ở bất kỳ bước nào khi page yêu cầu user action.

Ví dụ:

```text
MONITORING
    ↓
CAPTCHA_REQUIRED
    ↓
USER_ACTION
    ↓
MONITORING
```

hoặc:

```text
CHECKOUT
    ↓
PAYMENT_ACTION_REQUIRED
    ↓
USER_ACTION
    ↓
PAYMENT
```

---

# 4. State Categories

Mỗi state phải thuộc đúng một category.

## 4.1 Lifecycle States

```text
INIT
AUTH_CHECK
EVENT_CHECK
READY
ARMED
MONITORING
```

---

## 4.2 Purchase Flow States

```text
AVAILABLE_DETECTED
SELECTING
TICKET_TYPE_SELECTION
QUANTITY_SELECTION
SEAT_SELECTION
RESERVING
HELD
CHECKOUT
PAYMENT
CONFIRMED
```

---

## 4.3 Human Intervention States

```text
CAPTCHA_REQUIRED
OTP_REQUIRED
PAYMENT_ACTION_REQUIRED
SESSION_REAUTH_REQUIRED
UNKNOWN_SECURITY_CHALLENGE
```

---

## 4.4 Failure States

```text
FAILURE
SOLD_OUT
INVALID_SELECTION
SESSION_EXPIRED
RESERVATION_FAILED
RATE_LIMITED
CHECKOUT_FAILED
PAYMENT_FAILED
AUTH_FAILURE
UNKNOWN
```

---

## 4.5 Terminal States

```text
CONFIRMED
STOPPED
FAILED
```

A terminal state must not automatically restart the workflow.

---

# 5. Initialization

## State

```text
INIT
```

### Entry

Extension starts.

### Responsibilities

- initialize runtime;
- load configuration;
- initialize state store;
- initialize account context;
- initialize event context;
- initialize notification subsystem;
- validate extension version;
- validate required permissions.

### Transition

```text
INIT → AUTH_CHECK
```

Event:

```text
extension_ready
```

---

# 6. Authentication

## State

```text
AUTH_CHECK
```

### Possible Results

```text
AUTHENTICATED
NOT_AUTHENTICATED
SESSION_EXPIRED
AUTH_FAILURE
```

### Rules

The assistant may inspect whether the current session is authenticated.

The assistant must not:

- collect passwords;
- collect OTP values;
- extract credentials;
- bypass authentication;
- automatically solve authentication challenges.

### Transitions

```text
AUTH_CHECK
    ├── authenticated → EVENT_CHECK
    ├── not_authenticated → SESSION_REAUTH_REQUIRED
    ├── session_expired → SESSION_REAUTH_REQUIRED
    └── auth_failure → FAILURE
```

---

# 7. Event Check

## State

```text
EVENT_CHECK
```

### Possible Results

```text
EVENT_NOT_FOUND
EVENT_NOT_OPEN
EVENT_READY
EVENT_ENDED
```

### Transitions

```text
EVENT_CHECK
    ├── event_ready → READY
    ├── event_not_open → READY
    ├── event_not_found → FAILURE
    └── event_ended → FAILURE
```

If the event has not opened yet, the assistant may remain idle until the configured monitoring window begins.

---

# 8. Ready

## State

```text
READY
```

### Requirements

All of:

```text
Authenticated
Event loaded
Preferences configured
Account context valid
```

### Important Rule

`READY` means the system is prepared.

It does NOT mean automation is active.

User must explicitly arm the assistant.

### Transition

```text
READY → ARMED
```

Event:

```text
arm
```

---

# 9. Armed

## State

```text
ARMED
```

### Meaning

User explicitly enabled the assistant for the selected event.

### Rules

Before `ARMED`:

```text
No purchase action
No reservation attempt
No automatic checkout
```

### Transition

```text
ARMED → MONITORING
```

Event:

```text
monitoring_started
```

---

# 10. Monitoring

## State

```text
MONITORING
```

### Responsibilities

- observe supported application state;
- observe inventory availability;
- observe relevant page state;
- detect state changes;
- avoid uncontrolled request loops;
- respect rate limits;
- respect configured polling/backoff policy.

### Monitoring Must Not

- bypass anti-bot controls;
- generate uncontrolled requests;
- continuously hammer endpoints;
- bypass normal application flow.

### Possible Events

```text
inventory_available
captcha_required
session_expired
rate_limited
event_ended
user_stop
```

### Transitions

```text
MONITORING
    ├── inventory_available → AVAILABLE_DETECTED
    ├── captcha_required → CAPTCHA_REQUIRED
    ├── session_expired → SESSION_REAUTH_REQUIRED
    ├── rate_limited → RATE_LIMITED
    ├── event_ended → FAILURE
    └── user_stop → STOPPED
```

---

# 11. Available Detected

## State

```text
AVAILABLE_DETECTED
```

### Meaning

Relevant inventory has been observed through the supported application flow.

This does NOT mean:

```text
reserved
held
purchased
```

### Requirements

The system should have enough verified information to begin candidate selection.

### Transition

```text
AVAILABLE_DETECTED → SELECTING
```

Event:

```text
candidate_found
```

---

# 12. Selecting

## State

```text
SELECTING
```

### Input

```text
Inventory
+
User Preferences
```

### Output

```text
Candidate
```

### Example Preferences

```text
ticket_type
quantity
section
seat_preference
price_limit
ranking/preference rules
```

The preference engine must only select candidates allowed by the user's configured rules.

### Transitions

```text
SELECTING
    ├── ticket_type_required → TICKET_TYPE_SELECTION
    ├── quantity_required → QUANTITY_SELECTION
    ├── seat_selection_required → SEAT_SELECTION
    ├── candidate_ready → RESERVING
    └── invalid_selection → FAILURE
```

---

# 13. Ticket Type Selection

## State

```text
TICKET_TYPE_SELECTION
```

### Meaning

The page requires a ticket/product/type selection before continuing.

### Responsibilities

- identify supported ticket types;
- match against configured preferences;
- select only an allowed candidate;
- verify resulting page state.

### Transition

```text
TICKET_TYPE_SELECTION → QUANTITY_SELECTION
```

when quantity is required.

Or:

```text
TICKET_TYPE_SELECTION → SEAT_SELECTION
```

when seat selection is required.

Or:

```text
TICKET_TYPE_SELECTION → RESERVING
```

when no additional selection is required.

### Failure

```text
invalid_ticket_type → FAILURE
ticket_unavailable → SOLD_OUT
```

---

# 14. Quantity Selection

## State

```text
QUANTITY_SELECTION
```

### Meaning

The purchase flow requires quantity selection.

### Input

```text
configured_quantity
+
available_quantity
+
purchase_limit
```

### Rules

Selected quantity must satisfy all verified constraints.

For example:

```text
requested_quantity <= available_quantity
requested_quantity <= platform_limit
```

### Transition

```text
QUANTITY_SELECTION → SEAT_SELECTION
```

if seats are required.

Otherwise:

```text
QUANTITY_SELECTION → RESERVING
```

### Failure

```text
quantity_invalid → INVALID_SELECTION
quantity_unavailable → SOLD_OUT
```

---

# 15. Seat Selection

## State

```text
SEAT_SELECTION
```

### Meaning

The purchase flow requires seat selection.

### Input

```text
available_seats
+
seat_preferences
+
quantity
```

### Output

```text
selected_seats
```

### Rules

The system may select seats only according to configured user preferences.

The system must verify:

```text
selected_seats_count == requested_quantity
```

when the application requires an exact seat count.

### Transition

```text
SEAT_SELECTION → RESERVING
```

Event:

```text
selection_completed
```

### Failure

```text
seat_unavailable → SOLD_OUT
seat_invalid → INVALID_SELECTION
selection_conflict → INVALID_SELECTION
```

---

# 16. Reserving

## State

```text
RESERVING
```

### Meaning

The normal Ticketbox purchase flow is attempting to obtain the selected inventory.

### Important Rule

This is NOT success.

The following do not prove reservation:

```text
button clicked
button disabled
spinner displayed
client-side success message
DOM changed
URL changed
```

### Possible Outcomes

```text
server_confirmed
rejected
session_expired
rate_limited
captcha_required
unknown_security_challenge
```

### Transitions

```text
RESERVING
    ├── server_confirmed → HELD
    ├── rejected → FAILURE
    ├── session_expired → SESSION_REAUTH_REQUIRED
    ├── rate_limited → RATE_LIMITED
    ├── captcha_required → CAPTCHA_REQUIRED
    └── unknown_security_challenge → UNKNOWN_SECURITY_CHALLENGE
```

---

# 17. Held

## State

```text
HELD
```

### Critical Success Boundary

`HELD` means the system has verified that the selected inventory is actually held/reserved.

### Required Evidence

At least one authoritative evidence source must exist.

Possible evidence:

```text
reservation_id
hold_id
checkout_reference
server-confirmed inventory state
server response
```

Exact evidence:

```text
TBD
```

### Critical Rule

Never transition:

```text
RESERVING → HELD
```

based only on:

```text
click_success
ui_success
client_state
```

### Global Orchestration

If configured for one-success mode:

```text
Account A → HELD
```

may trigger:

```text
GLOBAL_SUCCESS
```

and:

```text
Account B → STOPPED
Account C → STOPPED
```

---

# 18. Checkout

## State

```text
CHECKOUT
```

### Meaning

The user/session has entered checkout after a verified reservation.

### Responsibilities

- verify checkout reference;
- verify order context;
- verify selected inventory;
- verify total;
- detect whether human intervention is required;
- detect payment state.

### Possible Events

```text
payment_started
payment_action_required
checkout_failed
session_expired
unknown_security_challenge
```

### Transitions

```text
CHECKOUT
    ├── payment_started → PAYMENT
    ├── payment_action_required → PAYMENT_ACTION_REQUIRED
    ├── checkout_failed → CHECKOUT_FAILED
    ├── session_expired → SESSION_REAUTH_REQUIRED
    └── unknown_security_challenge → UNKNOWN_SECURITY_CHALLENGE
```

---

# 19. Payment

## State

```text
PAYMENT
```

### Possible States

```text
PAYMENT_PENDING
PAYMENT_SUCCESS
PAYMENT_FAILED
PAYMENT_ACTION_REQUIRED
```

### Rules

Payment automation must not bypass:

```text
OTP
3DS
bank verification
wallet verification
CAPTCHA
security confirmation
```

When additional user-controlled payment action is required:

```text
PAYMENT → PAYMENT_ACTION_REQUIRED
```

### Transitions

```text
PAYMENT
    ├── success → CONFIRMED
    ├── failed → PAYMENT_FAILED
    ├── action_required → PAYMENT_ACTION_REQUIRED
    └── timeout → FAILURE
```

---

# 20. Confirmed

## State

```text
CONFIRMED
```

### Meaning

The normal Ticketbox flow has produced verifiable evidence that the order/purchase is confirmed.

### Evidence

Possible evidence:

```text
order_id
ticket_id
confirmation_reference
server-confirmed order state
confirmation page backed by authoritative data
```

Exact evidence:

```text
TBD
```

### Rule

`CONFIRMED` is terminal for that purchase attempt.

No automatic retry after:

```text
CONFIRMED
```

---

# 21. Human Intervention Model

Human intervention is a first-class state category.

The system must distinguish:

```text
AUTOMATABLE
HUMAN_INTERVENTION_REQUIRED
FAILURE
TERMINAL
UNKNOWN
```

When entering a human intervention state:

1. Pause automation.
2. Persist current workflow state.
3. Persist current account/event context.
4. Create or update a human intervention record.
5. Notify the user.
6. Wait for user action.
7. Detect resulting page/application state.
8. Verify the resulting state.
9. Resume only if the state is supported and safe to continue.

---

# 22. CAPTCHA Required

## State

```text
CAPTCHA_REQUIRED
```

### Meaning

The application has presented a CAPTCHA or equivalent anti-automation challenge.

### Behaviour

Automation must:

```text
PAUSE
PERSIST STATE
NOTIFY USER
WAIT FOR USER ACTION
RE-EVALUATE PAGE
```

### Notification

Example notification:

```text
Ticketbox Assistant

Action required:
CAPTCHA verification is required.

Automation has been paused.

Please complete the verification in the browser.
```

### Resume

After user action:

```text
CAPTCHA_REQUIRED
    ↓
STATE_RECHECK
```

If verified:

```text
STATE_RECHECK → previous_valid_state
```

Otherwise:

```text
STATE_RECHECK → UNKNOWN_SECURITY_CHALLENGE
```

### Prohibited

The system must never:

```text
solve CAPTCHA automatically
bypass CAPTCHA
inject CAPTCHA answers
use CAPTCHA-solving services
```

---

# 23. OTP Required

## State

```text
OTP_REQUIRED
```

### Behaviour

Automation pauses.

User performs OTP verification through the normal application flow.

The extension must not:

- collect OTP values;
- store OTP values;
- forward OTP values to external services;
- attempt to bypass OTP.

### Flow

```text
OTP_REQUIRED
    ↓
USER_ACTION
    ↓
STATE_RECHECK
```

Possible result:

```text
STATE_RECHECK → PAYMENT
```

or:

```text
STATE_RECHECK → CHECKOUT
```

or:

```text
STATE_RECHECK → FAILURE
```

---

# 24. Payment Action Required

## State

```text
PAYMENT_ACTION_REQUIRED
```

### Meaning

The payment provider requires user-controlled action.

Examples may include:

```text
bank approval
3DS verification
wallet confirmation
security confirmation
device confirmation
```

### Behaviour

```text
PAUSE
NOTIFY
WAIT
RECHECK
```

### Example Notification

```text
Ticketbox Assistant

Payment action required.

Your checkout is waiting for a payment verification step.
Please complete it in the payment interface.

Automation is paused until the result is detected.
```

---

# 25. Session Re-authentication Required

## State

```text
SESSION_REAUTH_REQUIRED
```

### Meaning

The current authenticated session is no longer valid.

### Behaviour

Automation must stop.

User must re-authenticate through the normal Ticketbox flow.

### Flow

```text
SESSION_REAUTH_REQUIRED
    ↓
USER_ACTION
    ↓
STATE_RECHECK
```

Possible:

```text
STATE_RECHECK → AUTH_CHECK
```

or:

```text
STATE_RECHECK → FAILURE
```

---

# 26. Unknown Security Challenge

## State

```text
UNKNOWN_SECURITY_CHALLENGE
```

### Meaning

The application presents a security/authentication challenge that the automation engine does not recognize.

### Rule

Fail-safe behaviour:

```text
PAUSE
NOTIFY USER
DO NOT BYPASS
DO NOT GUESS
```

### Resume

Only after the page state becomes a known supported state.

---

# 27. Human Intervention Record

Every human intervention event should create or update a record containing:

```text
id
account_id
event_id
workflow_id
state
reason
detected_at
notification_sent_at
user_action_at
resolved_at
previous_state
next_state
status
```

Possible status:

```text
PENDING
USER_ACTION
RESOLVED
EXPIRED
CANCELLED
```

---

# 28. Notification Model

Notifications are derived from state transitions.

The notification system must not independently decide workflow state.

Architecture:

```text
State Machine
      ↓
State Transition
      ↓
Notification Event
      ↓
Notification Manager
      ↓
Extension UI
```

---

# 29. Notification Types

## 29.1 Availability

```text
Ticketbox Assistant

Availability detected.

The configured purchase flow is starting.
```

---

## 29.2 Seat Selection

```text
Ticketbox Assistant

Seat selection detected.

Selected seats:
[detected seats]

The assistant is continuing with the configured selection.
```

---

## 29.3 Quantity Selection

```text
Ticketbox Assistant

Quantity selection detected.

Requested quantity:
2

The assistant is applying the configured quantity.
```

---

## 29.4 CAPTCHA

```text
Ticketbox Assistant

CAPTCHA verification required.

Automation has been paused.
Please complete the CAPTCHA in the browser.
```

---

## 29.5 OTP

```text
Ticketbox Assistant

OTP verification required.

Automation has been paused.
Please complete verification in the normal application flow.
```

---

## 29.6 Payment Action

```text
Ticketbox Assistant

Payment verification required.

Please complete the payment action.
Automation is currently paused.
```

---

## 29.7 Held

```text
Ticketbox Assistant

Tickets successfully held.

Reservation evidence has been verified.
```

---

## 29.8 Confirmed

```text
Ticketbox Assistant

Purchase confirmed.

Confirmation evidence has been verified.
```

---

## 29.9 Failure

```text
Ticketbox Assistant

Purchase workflow stopped.

Reason:
{failure_reason}
```

---

# 30. Failure States

```text
FAILURE
├── SOLD_OUT
├── INVALID_SELECTION
├── SESSION_EXPIRED
├── AUTH_FAILURE
├── RESERVATION_FAILED
├── RATE_LIMITED
├── CHECKOUT_FAILED
├── PAYMENT_FAILED
└── UNKNOWN
```

---

# 31. Sold Out

## State

```text
SOLD_OUT
```

### Meaning

The requested inventory is no longer available.

Possible behaviour:

```text
SOLD_OUT
    ↓
RETRY_POLICY
    ↓
MONITORING
```

only if the configured policy allows retry.

Otherwise:

```text
SOLD_OUT → STOPPED
```

---

# 32. Invalid Selection

## State

```text
INVALID_SELECTION
```

### Meaning

The configured preference cannot be satisfied by the current inventory/page state.

Examples:

```text
requested_quantity > allowed_quantity
requested_seat_unavailable
ticket_type_not_available
invalid_candidate
```

### Behaviour

Re-evaluate candidates if policy permits.

Otherwise:

```text
INVALID_SELECTION → STOPPED
```

---

# 33. Reservation Failed

## State

```text
RESERVATION_FAILED
```

### Meaning

The normal purchase flow rejected the reservation attempt.

Possible causes:

```text
inventory_taken
selection_conflict
server_rejection
reservation_timeout
```

### Behaviour

Retry only if explicitly allowed by retry policy.

---

# 34. Rate Limited

## State

```text
RATE_LIMITED
```

### Behaviour

Do not immediately retry.

Required:

```text
BACKOFF
PAUSE
```

The retry system must respect server/platform behaviour.

Default:

```text
RATE_LIMITED → STOPPED
```

unless an explicit safe retry policy exists.

---

# 35. Checkout Failed

## State

```text
CHECKOUT_FAILED
```

### Behaviour

Persist diagnostic context.

Possible:

```text
CHECKOUT_FAILED → RETRY_POLICY
```

or:

```text
CHECKOUT_FAILED → STOPPED
```

depending on policy.

---

# 36. Payment Failed

## State

```text
PAYMENT_FAILED
```

### Behaviour

No blind repeated payment attempts.

The system must not automatically repeat payment unless the payment state is explicitly known to be safe for retry.

Possible:

```text
PAYMENT_FAILED → STOPPED
```

or:

```text
PAYMENT_FAILED → PAYMENT
```

only when retry conditions are explicitly verified.

---

# 37. Unknown

## State

```text
UNKNOWN
```

### Rule

Unknown state is fail-safe.

```text
UNKNOWN
    ↓
PAUSE
    ↓
NOTIFY
    ↓
WAIT
```

Do not guess the next action.

---

# 38. Retry Policy

Only explicitly retryable states may return to monitoring.

General pattern:

```text
FAILURE
    ↓
RETRY_POLICY
    ↓
MONITORING
```

Retry must have:

```text
retry_count
max_retry_count
backoff
reason
last_attempt_at
next_attempt_at
```

---

# 39. Non-Retryable Conditions

The following should normally stop automation or require user intervention:

```text
RATE_LIMITED
SESSION_EXPIRED
AUTH_FAILURE
CAPTCHA_REQUIRED
OTP_REQUIRED
UNKNOWN_SECURITY_CHALLENGE
PAYMENT_FAILED
UNKNOWN
```

No automatic bypass.

---

# 40. Global Multi-Account State Machine

Global states:

```text
GLOBAL_IDLE
GLOBAL_ARMED
GLOBAL_RUNNING
GLOBAL_SUCCESS
GLOBAL_STOPPED
GLOBAL_ERROR
```

---

# 41. Global Idle

```text
GLOBAL_IDLE
```

No account is actively attempting the purchase workflow.

---

# 42. Global Armed

```text
GLOBAL_ARMED
```

User has configured and armed the multi-account workflow.

No account may perform purchase action before global arming.

---

# 43. Global Running

```text
GLOBAL_RUNNING
```

One or more accounts are executing the workflow.

Example:

```text
Account A → MONITORING
Account B → MONITORING
Account C → MONITORING
```

---

# 44. Global Success

```text
GLOBAL_SUCCESS
```

Triggered when configured success condition is satisfied.

Example:

```text
Account A → HELD
```

may trigger:

```text
GLOBAL_SUCCESS
```

when:

```text
success_mode = ONE_SUCCESS
```

Then:

```text
Account B → STOPPED
Account C → STOPPED
```

---

# 45. Global Stop

```text
GLOBAL_STOPPED
```

Triggered by:

```text
user_stop
terminal_failure
policy_stop
success_condition
```

All active workflows must stop gracefully.

---

# 46. Global Error

```text
GLOBAL_ERROR
```

Used for unrecoverable orchestration errors.

Examples:

```text
state_store_failure
configuration_corruption
controller_failure
unexpected orchestration exception
```

---

# 47. Account Isolation

Each account must maintain independent workflow state.

Example:

```text
Account A
    workflow_state = HELD

Account B
    workflow_state = MONITORING

Account C
    workflow_state = CAPTCHA_REQUIRED
```

A failure in one account must not corrupt another account's state.

Global orchestration may stop other accounts only according to explicit policy.

---

# 48. One-Success Mode

Configuration:

```text
success_mode = ONE_SUCCESS
```

Example:

```text
A → HELD
```

Then:

```text
GLOBAL_SUCCESS
```

and:

```text
B → STOPPED
C → STOPPED
```

Stopping must be graceful.

The system must not start new purchase attempts after global success.

---

# 49. Multi-Success Mode

Configuration:

```text
success_mode = MULTI_SUCCESS
```

Each account may continue independently until:

```text
CONFIRMED
STOPPED
FAILED
```

or the global configured target is reached.

---

# 50. Canonical State Transition Table

| From                       | Event                      | To                         |
| -------------------------- | -------------------------- | -------------------------- |
| INIT                       | extension_ready            | AUTH_CHECK                 |
| AUTH_CHECK                 | authenticated              | EVENT_CHECK                |
| AUTH_CHECK                 | not_authenticated          | SESSION_REAUTH_REQUIRED    |
| AUTH_CHECK                 | session_expired            | SESSION_REAUTH_REQUIRED    |
| AUTH_CHECK                 | auth_failure               | AUTH_FAILURE               |
| EVENT_CHECK                | event_ready                | READY                      |
| EVENT_CHECK                | event_not_open             | READY                      |
| EVENT_CHECK                | event_not_found            | FAILURE                    |
| EVENT_CHECK                | event_ended                | FAILURE                    |
| READY                      | arm                        | ARMED                      |
| ARMED                      | monitoring_started         | MONITORING                 |
| MONITORING                 | inventory_available        | AVAILABLE_DETECTED         |
| MONITORING                 | captcha_required           | CAPTCHA_REQUIRED           |
| MONITORING                 | session_expired            | SESSION_REAUTH_REQUIRED    |
| MONITORING                 | rate_limited               | RATE_LIMITED               |
| MONITORING                 | user_stop                  | STOPPED                    |
| AVAILABLE_DETECTED         | candidate_found            | SELECTING                  |
| SELECTING                  | ticket_type_required       | TICKET_TYPE_SELECTION      |
| SELECTING                  | quantity_required          | QUANTITY_SELECTION         |
| SELECTING                  | seat_selection_required    | SEAT_SELECTION             |
| SELECTING                  | candidate_ready            | RESERVING                  |
| SELECTING                  | invalid_selection          | INVALID_SELECTION          |
| TICKET_TYPE_SELECTION      | quantity_required          | QUANTITY_SELECTION         |
| TICKET_TYPE_SELECTION      | seat_selection_required    | SEAT_SELECTION             |
| TICKET_TYPE_SELECTION      | selection_completed        | RESERVING                  |
| QUANTITY_SELECTION         | seat_selection_required    | SEAT_SELECTION             |
| QUANTITY_SELECTION         | selection_completed        | RESERVING                  |
| QUANTITY_SELECTION         | invalid_selection          | INVALID_SELECTION          |
| SEAT_SELECTION             | selection_completed        | RESERVING                  |
| SEAT_SELECTION             | seat_unavailable           | SOLD_OUT                   |
| SEAT_SELECTION             | invalid_selection          | INVALID_SELECTION          |
| RESERVING                  | server_confirmed           | HELD                       |
| RESERVING                  | rejected                   | RESERVATION_FAILED         |
| RESERVING                  | session_expired            | SESSION_REAUTH_REQUIRED    |
| RESERVING                  | rate_limited               | RATE_LIMITED               |
| RESERVING                  | captcha_required           | CAPTCHA_REQUIRED           |
| RESERVING                  | unknown_security_challenge | UNKNOWN_SECURITY_CHALLENGE |
| HELD                       | checkout_opened            | CHECKOUT                   |
| CHECKOUT                   | payment_started            | PAYMENT                    |
| CHECKOUT                   | payment_action_required    | PAYMENT_ACTION_REQUIRED    |
| CHECKOUT                   | checkout_failed            | CHECKOUT_FAILED            |
| CHECKOUT                   | session_expired            | SESSION_REAUTH_REQUIRED    |
| PAYMENT                    | success                    | CONFIRMED                  |
| PAYMENT                    | failed                     | PAYMENT_FAILED             |
| PAYMENT                    | action_required            | PAYMENT_ACTION_REQUIRED    |
| PAYMENT                    | timeout                    | PAYMENT_FAILED             |
| CAPTCHA_REQUIRED           | user_completed             | STATE_RECHECK              |
| OTP_REQUIRED               | user_completed             | STATE_RECHECK              |
| PAYMENT_ACTION_REQUIRED    | user_completed             | STATE_RECHECK              |
| SESSION_REAUTH_REQUIRED    | user_completed             | STATE_RECHECK              |
| UNKNOWN_SECURITY_CHALLENGE | user_completed             | STATE_RECHECK              |
| STATE_RECHECK              | known_state                | previous_valid_state       |
| STATE_RECHECK              | unknown_state              | UNKNOWN                    |

---

# 51. State Recheck

## State

```text
STATE_RECHECK
```

This is a transitional verification state.

It exists to prevent the automation engine from assuming that user action succeeded.

After human action:

```text
USER_ACTION
    ↓
STATE_RECHECK
```

The system must inspect the actual resulting application state.

It must never blindly execute:

```text
user_action_completed → continue
```

Instead:

```text
user_action_completed
        ↓
STATE_RECHECK
        ↓
verified_state
```

---

# 52. State Detection Model

State detection should use multiple signals where possible.

Possible signals:

```text
URL
DOM structure
visible controls
application state
network response metadata
server-confirmed data
page navigation
known application markers
```

Signals should produce:

```text
DetectedState
```

which is then validated against the state machine.

Architecture:

```text
Page
 ↓
State Detector
 ↓
Detected State
 ↓
State Validator
 ↓
State Machine
 ↓
Allowed Transition?
 ├── YES → Action
 └── NO  → Pause / Failure
```

---

# 53. UI Text Rule

UI text must never be the canonical state identifier.

Bad:

```text
if button.innerText === "Buy Now"
    state = RESERVING
```

Better:

```text
detect verified purchase-flow state
        ↓
state = RESERVING
```

Text may be one detection signal but never the source of truth.

---

# 54. Action Guard

Every automation action must pass an action guard.

Conceptually:

```text
canExecuteAction(
    currentState,
    detectedPageState,
    action
)
```

must return:

```text
ALLOW
```

before execution.

Otherwise:

```text
DENY
```

and the system must pause or transition to an appropriate failure/intervention state.

---

# 55. Action Examples

## Monitoring

Allowed:

```text
observe
detect
wait
```

Not allowed:

```text
purchase
checkout
payment
```

---

## Selecting

Allowed:

```text
select ticket type
select quantity
select supported seat
```

Only when corresponding state is verified.

---

## Reserving

Allowed:

```text
continue normal purchase flow
```

Only after valid selection.

---

## Held

Allowed:

```text
continue to checkout
```

Only after server-confirmed hold.

---

## Checkout

Allowed:

```text
continue normal checkout
```

unless human intervention is required.

---

## Payment

Allowed:

```text
continue normal supported payment flow
```

but user-controlled verification must remain manual.

---

# 56. State Persistence

The current state must be persisted.

Minimum:

```text
workflow_id
account_id
event_id
current_state
previous_state
transition_event
transition_timestamp
retry_count
last_error
human_intervention_id
```

Persistence is required before entering human intervention or terminal states.

---

# 57. State Transition Audit Log

Every transition should generate an immutable audit event.

Example:

```text
{
    workflow_id,
    account_id,
    event_id,
    from_state,
    event,
    to_state,
    timestamp,
    evidence_type,
    evidence_reference,
    actor
}
```

Possible actors:

```text
SYSTEM
USER
SERVER
```

---

# 58. Evidence Model

Critical states should record evidence.

Example:

```text
HELD
```

requires:

```text
evidence_type
evidence_reference
verified_at
```

Example:

```text
evidence_type = reservation_id
evidence_reference = <server-confirmed-reference>
```

Sensitive information must not be unnecessarily persisted.

---

# 59. Stop Conditions

Automation must stop when:

```text
user_stop
global_success
session_expired
rate_limited
unknown_security_challenge
payment_failed
unknown_state
max_retry_reached
event_ended
```

unless an explicit policy defines a safe alternative.

---

# 60. Manual Stop

User must always be able to stop an active workflow.

Example:

```text
MONITORING → STOPPED
RESERVING → STOPPED
CHECKOUT → STOPPED
PAYMENT → STOPPED
```

The stop command must be higher priority than normal automation actions.

---

# 61. Safety Priority

Action priority:

```text
USER STOP
    ↓
SECURITY / HUMAN INTERVENTION
    ↓
GLOBAL SUCCESS
    ↓
TERMINAL STATE
    ↓
NORMAL AUTOMATION
    ↓
RETRY
```

The system must never prioritize automation over an explicit user stop.

---

# 62. Complete Normal Flow

```text
INIT
 ↓
AUTH_CHECK
 ↓
EVENT_CHECK
 ↓
READY
 ↓
ARMED
 ↓
MONITORING
 ↓
AVAILABLE_DETECTED
 ↓
SELECTING
 ↓
TICKET_TYPE_SELECTION
 ↓
QUANTITY_SELECTION
 ↓
SEAT_SELECTION
 ↓
RESERVING
 ↓
HELD
 ↓
CHECKOUT
 ↓
PAYMENT
 ↓
CONFIRMED
```

Not every purchase requires every intermediate selection state.

For example:

```text
SELECTING
 ↓
RESERVING
```

is valid when ticket type, quantity and seat are already determined by the supported flow.

---

# 63. Example: Quantity Required

```text
AVAILABLE_DETECTED
 ↓
SELECTING
 ↓
TICKET_TYPE_SELECTION
 ↓
QUANTITY_SELECTION
 ↓
RESERVING
 ↓
HELD
```

---

# 64. Example: Seat Required

```text
AVAILABLE_DETECTED
 ↓
SELECTING
 ↓
TICKET_TYPE_SELECTION
 ↓
QUANTITY_SELECTION
 ↓
SEAT_SELECTION
 ↓
RESERVING
 ↓
HELD
```

---

# 65. Example: CAPTCHA

```text
MONITORING
 ↓
CAPTCHA_REQUIRED
 ↓
PAUSED
 ↓
USER COMPLETES CAPTCHA
 ↓
STATE_RECHECK
 ↓
MONITORING
```

The assistant does not solve or bypass the CAPTCHA.

---

# 66. Example: OTP

```text
PAYMENT
 ↓
OTP_REQUIRED
 ↓
PAUSED
 ↓
USER COMPLETES OTP
 ↓
STATE_RECHECK
 ↓
PAYMENT
 ↓
CONFIRMED
```

The assistant does not collect or automate the OTP.

---

# 67. Example: Payment Verification

```text
CHECKOUT
 ↓
PAYMENT
 ↓
PAYMENT_ACTION_REQUIRED
 ↓
PAUSED
 ↓
USER COMPLETES PAYMENT ACTION
 ↓
STATE_RECHECK
 ↓
PAYMENT
 ↓
CONFIRMED
```

---

# 68. Example: One-Success Multi-Account

```text
GLOBAL_RUNNING

Account A → MONITORING
Account B → MONITORING
Account C → MONITORING
```

Then:

```text
Account B
MONITORING
 ↓
AVAILABLE_DETECTED
 ↓
SELECTING
 ↓
RESERVING
 ↓
HELD
```

Global:

```text
GLOBAL_RUNNING
      ↓
GLOBAL_SUCCESS
```

Other accounts:

```text
Account A → STOPPED
Account C → STOPPED
```

---

# 69. Testing Requirements

Every state transition must have tests for:

```text
valid transition
invalid transition
failure transition
retry transition
stop condition
```

---

# 70. State Machine Test Matrix

Minimum test categories:

## Initialization

```text
INIT → AUTH_CHECK
```

## Authentication

```text
authenticated
not_authenticated
session_expired
auth_failure
```

## Event

```text
event_ready
event_not_open
event_not_found
event_ended
```

## Monitoring

```text
inventory_available
captcha_required
rate_limited
session_expired
user_stop
```

## Selection

```text
ticket_type_required
quantity_required
seat_selection_required
invalid_selection
```

## Reservation

```text
server_confirmed
rejected
rate_limited
session_expired
captcha_required
```

## Human Intervention

```text
CAPTCHA_REQUIRED
OTP_REQUIRED
PAYMENT_ACTION_REQUIRED
SESSION_REAUTH_REQUIRED
UNKNOWN_SECURITY_CHALLENGE
```

## Payment

```text
success
failed
action_required
timeout
```

## Global

```text
one_success
multi_success
global_stop
global_error
```

---

# 71. Critical Negative Tests

The following must explicitly fail:

```text
RESERVING → HELD
```

when evidence is only:

```text
button_clicked
```

---

```text
PAYMENT → CONFIRMED
```

when there is no verified confirmation evidence.

---

```text
CAPTCHA_REQUIRED → MONITORING
```

without a user action and state recheck.

---

```text
OTP_REQUIRED → PAYMENT
```

without verified resulting application state.

---

```text
UNKNOWN → RESERVING
```

without state verification.

---

```text
READY → RESERVING
```

without:

```text
ARMED
```

---

# 72. Implementation Contract

The implementation must treat this document as the canonical state model.

Any implementation that introduces a new state must update:

```text
state machine specification
transition table
state detector
action guard
notification mapping
persistence model
tests
```

No undocumented state may be silently introduced in code.

---

# 73. Implementation Separation

The following components must remain separate:

```text
State Machine
State Detector
Action Executor
Human Intervention Manager
Notification Manager
Retry Manager
Multi-Account Orchestrator
```

Architecture:

```text
                 ┌──────────────────┐
                 │   Page / App     │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │  State Detector  │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │  State Machine   │
                 └───────┬──────────┘
                         ↓
              ┌──────────┴──────────┐
              ↓                     ↓
       ┌──────────────┐      ┌───────────────┐
       │ Action Guard │      │ Intervention  │
       └──────┬───────┘      │    Manager    │
              ↓              └───────┬───────┘
       ┌──────────────┐              ↓
       │   Executor   │         User Action
       └──────┬───────┘              ↓
              └──────────────→ STATE_RECHECK
```

---

# 74. Source of Truth Rule

The hierarchy of truth is:

```text
1. Server-confirmed evidence
2. Verified application state
3. State detector
4. DOM / network / URL signals
5. UI text
```

Never reverse this hierarchy.

In particular:

```text
UI text ≠ state
button click ≠ reservation
page navigation ≠ confirmation
spinner completion ≠ success
```

---

# 75. Final Invariants

The implementation must always preserve these invariants:

```text
1. No purchase action before ARMED.

2. No RESERVING without a valid candidate.

3. No HELD without server-confirmed evidence.

4. No CONFIRMED without confirmation evidence.

5. CAPTCHA is never automatically bypassed.

6. OTP is never automatically collected or bypassed.

7. Payment security verification remains user-controlled.

8. Unknown security states fail safe.

9. Unknown application states fail safe.

10. User STOP always overrides automation.

11. Multi-account state is isolated per account.

12. Global success may stop other accounts only according to explicit policy.

13. Retry is controlled by explicit retry policy.

14. UI text is never the canonical state.

15. Every state transition is auditable.

16. Every human intervention is persisted.

17. Every critical success state requires evidence.

18. No undocumented state may be introduced silently.
```

---

# 76. Current Design Status

The following items remain intentionally `TBD` until implementation/discovery:

```text
Exact Ticketbox reservation evidence
Exact hold evidence
Exact confirmation evidence
Exact supported page-state signatures
Exact state detector implementation
Exact retry/backoff values
Exact notification transport
Exact persistence schema
Exact multi-account concurrency limits
Exact checkout/payment detection rules
```

These values must be established from observed, legitimate application behaviour during implementation.

---

# 77. Design Completion Criteria

This state machine is considered implementation-ready when:

```text
[ ] All states have unique identifiers
[ ] All transitions are documented
[ ] All terminal states are documented
[ ] All human intervention states are documented
[ ] All failure states are documented
[ ] All retry rules are documented
[ ] All stop conditions are documented
[ ] Evidence requirements are documented
[ ] Notification mappings are documented
[ ] Persistence requirements are documented
[ ] Multi-account behaviour is documented
[ ] Negative transition tests are defined
[ ] Unknown-state behaviour is defined
[ ] Security challenge behaviour is defined
```

Until these criteria are satisfied, implementation should remain in the design/discovery phase.
