# Ticketbox Purchase Assistant

## Security & Compliance Specification

**Version:** 1.1
**Status:** Security Baseline / Design
**Document Type:** Security Source of Truth

---

# 1. Purpose

Tài liệu này định nghĩa security boundary của sản phẩm Ticketbox Purchase Assistant.

Mục tiêu:

```text
Protect user account

Protect browser session

Protect personal data

Protect payment information

Prevent credential leakage

Prevent uncontrolled automation

Prevent unauthorized actions

Prevent cross-account mistakes

Maintain platform-safe behavior

Fail safely when state is unknown

Keep security-sensitive actions user-controlled
```

Security specification này phải được áp dụng cho:

```text
Browser Extension
Content Script
Service Worker
Controller
State Machine
State Detector
Action Executor
Human Intervention Manager
Notification Manager
Multi-account Orchestrator
Optional Backend
Local IPC
Logging
Persistence
```

---

# 2. Security Principles

## S-001 — Least Privilege

Extension chỉ request những Chrome permissions thực sự cần thiết.

Không yêu cầu quyền rộng hơn nhu cầu.

Mỗi permission phải có:

```text
Permission
↓
Use Case
↓
Reason
↓
Why Required
```

Không được thêm permission chỉ vì "có thể cần sau này".

---

## S-002 — No Credential Ownership

Product không trở thành credential manager cho Ticketbox.

Authentication thuộc về:

```text
User
+
Ticketbox
+
Browser Session
```

Product không được trở thành nơi lưu trữ authentication secret.

---

## S-003 — Session Isolation

Mỗi account phải được isolation bằng browser profile riêng.

```text
Profile A
    ≠
Profile B
    ≠
Profile C
```

Mỗi runtime instance phải biết:

```text
profile_id
account_context
event_id
workflow_id
attempt_id
```

Không được tự động dùng session của profile khác.

---

## S-004 — Sensitive Data Minimization

Chỉ lưu dữ liệu thực sự cần thiết.

Không lưu dữ liệu chỉ vì:

```text
"có thể cần sau này"
```

Mỗi dữ liệu được persist phải có:

```text
Purpose
Retention
Access Scope
Security Classification
```

---

## S-005 — Safe Failure

Nếu system không hiểu trạng thái:

```text
UNKNOWN
```

thay vì:

```text
ASSUME_SUCCESS
```

Không được tự suy luận:

```text
UNKNOWN → RESERVING
UNKNOWN → HELD
UNKNOWN → PAYMENT
UNKNOWN → CONFIRMED
```

---

## S-006 — User-Controlled Security

Các bước yêu cầu user xác thực hoặc xác nhận bảo mật phải thuộc quyền kiểm soát của user.

Bao gồm:

```text
CAPTCHA
OTP
3DS
Bank Verification
Wallet Verification
Security Challenge
Re-authentication
```

Automation phải pause.

---

## S-007 — Evidence Before Success

Critical success state phải có evidence.

Đặc biệt:

```text
RESERVING → HELD
```

và:

```text
PAYMENT → CONFIRMED
```

không được dựa chỉ vào UI interaction.

---

## S-008 — Explicit Arming

Automation chỉ được thực hiện purchase workflow sau khi user explicitly arm assistant.

```text
READY
  ↓
ARMED
```

Không được:

```text
READY → RESERVING
```

---

# 3. Security Boundary

Boundary của hệ thống:

```text
                     USER
                       │
                       ▼
                Chrome Profile
                       │
                       ▼
                   Ticketbox
                       │
          ┌────────────┴────────────┐
          │                         │
      Extension                    User
          │                         │
          │                  CAPTCHA / OTP
          │                  Payment Action
          │                         │
          └────────────┬────────────┘
                       ▼
                  Result State
```

Nguyên tắc:

```text
Credentials remain with authentication systems.

Payment credentials remain with payment systems.

Session remains inside browser profile.

Extension automates only explicitly supported user-approved interaction.
```

---

# 4. Data Classification

## 4.1 Public

```text
event_name
venue
public_ticket_category
public_event_url
public_event_metadata
public_availability_information
```

---

## 4.2 Internal

```text
preferences
local_configuration
application_logs
attempt_ids
workflow_ids
performance_metrics
state_transition_metadata
retry_metadata
notification_metadata
```

---

## 4.3 Sensitive

```text
account_identifiers
purchase_history
personal_information
reservation_identifiers
checkout_references
order_identifiers
profile_metadata
```

---

## 4.4 Highly Sensitive

```text
password
OTP
authentication_token
session_cookie
payment_credentials
CVV
bank_credentials
wallet_credentials
payment_password
```

Highly Sensitive data MUST NOT be persisted by the application.

---

# 5. Credential Policy

Product MUST NOT:

```text
capture password

store password

log password

request password through extension UI

forward password to backend

send password through IPC

inject password into external services
```

Authentication should occur through the normal Ticketbox authentication UI.

---

# 6. OTP Policy

Product MUST NOT:

```text
intercept OTP

store OTP

log OTP

forward OTP

automatically harvest OTP

send OTP to backend

send OTP to controller

use OTP as an application-owned credential
```

If Ticketbox requires OTP:

```text
User
  ↓
Ticketbox
  ↓
OTP Verification
  ↓
Authenticated Session
  ↓
STATE_RECHECK
```

The extension may detect that OTP is required.

It must not acquire the OTP itself.

---

# 7. CAPTCHA Policy

CAPTCHA is a security boundary.

The product MUST NOT:

```text
solve CAPTCHA automatically

bypass CAPTCHA

inject CAPTCHA answers

use CAPTCHA-solving services

delegate CAPTCHA solving to external automation

attempt to defeat anti-bot verification
```

When CAPTCHA is detected:

```text
CURRENT STATE
     ↓
CAPTCHA_REQUIRED
     ↓
PAUSE AUTOMATION
     ↓
PERSIST STATE
     ↓
NOTIFY USER
     ↓
USER COMPLETES CAPTCHA
     ↓
STATE_RECHECK
     ↓
RESUME ONLY IF VERIFIED
```

---

# 8. Human Intervention Security Model

Human intervention states:

```text
CAPTCHA_REQUIRED
OTP_REQUIRED
PAYMENT_ACTION_REQUIRED
SESSION_REAUTH_REQUIRED
UNKNOWN_SECURITY_CHALLENGE
```

When entering any human intervention state:

```text
1. Pause automation
2. Persist workflow state
3. Persist account/event context
4. Create intervention record
5. Notify user
6. Wait for user action
7. Re-evaluate application state
8. Resume only if state is verified
```

The system must never assume:

```text
user_action_completed
```

means:

```text
security_step_successful
```

Instead:

```text
USER_ACTION
    ↓
STATE_RECHECK
    ↓
VERIFIED STATE
```

---

# 9. Session Policy

The extension may operate inside an authenticated browser session.

It MUST NOT:

```text
extract cookies for external storage

send session cookies to project backend

synchronize raw session tokens

display raw authentication tokens

export browser authentication state

copy session state between profiles
```

Browser profile isolation should be provided by Chrome itself.

---

# 10. Cookie Policy

Cookies are treated as sensitive authentication material.

Forbidden:

```text
document.cookie → backend
```

or equivalent extraction of authentication cookies for storage.

The application must not build its own session-cookie database.

Do not persist:

```text
Cookie
Set-Cookie
Authorization
session_token
access_token
refresh_token
```

unless a future architecture explicitly establishes a separate security-approved mechanism.

For MVP:

```text
Browser owns session.
Extension operates within session.
Backend does not own session.
```

---

# 11. Payment Security

MVP does not store:

```text
card_number
CVV
bank_credentials
wallet_credentials
payment_password
OTP
3DS credentials
payment tokens
```

Payment should remain within the supported Ticketbox/payment-provider flow.

The extension may detect payment state but must not become a payment credential store.

---

# 12. Payment Action Required

When payment requires user-controlled action:

```text
PAYMENT
    ↓
PAYMENT_ACTION_REQUIRED
```

Automation must:

```text
PAUSE
NOTIFY USER
WAIT
STATE_RECHECK
```

Examples:

```text
3DS verification
bank approval
wallet confirmation
device confirmation
security confirmation
OTP
```

The extension must not bypass these mechanisms.

---

# 13. Personal Data

Potential personal data:

```text
name
email
phone
billing_information
shipping_information
account_identifiers
```

The system should avoid collecting this unless required for an explicit feature.

If collected, it must have:

```text
Purpose
Access Control
Retention Policy
Deletion Policy
```

---

# 14. Logging Security

Logs MUST be sanitized.

Forbidden:

```text
Authorization headers

Cookie headers

Set-Cookie

password

OTP

CVV

payment credentials

raw session tokens

raw access tokens

refresh tokens

full payment information
```

Never log:

```text
console.log(request.headers)
```

if headers may contain authentication information.

Prefer:

```text
Authorization: [REDACTED]
Cookie: [REDACTED]
OTP: [REDACTED]
```

---

# 15. Network Logging

DevTools discovery may temporarily expose sensitive headers.

Discovery notes MUST NOT be committed with:

```text
real Cookie
Authorization
session tokens
personal payment data
password
OTP
```

Use:

```text
[REDACTED]
```

instead.

HAR files must be sanitized before entering source control.

---

# 16. Local Storage

Allowed:

```text
event configuration

ticket preferences

UI settings

non-sensitive workflow metadata

non-sensitive metrics

workflow IDs

attempt IDs

state metadata
```

Forbidden:

```text
password

OTP

CVV

raw authentication cookies

raw access tokens

refresh tokens

payment credentials
```

---

# 17. State Persistence Security

Persisted workflow state may contain:

```text
workflow_id
account_id
profile_id
event_id
current_state
previous_state
transition_event
transition_timestamp
retry_count
failure_code
human_intervention_id
```

It must NOT contain:

```text
password
OTP
raw cookies
session tokens
payment credentials
```

Critical evidence references must be minimized.

Do not persist sensitive server responses unnecessarily.

---

# 18. Extension Permissions

Permission design:

```text
minimum required host permissions
minimum Chrome APIs
no unnecessary broad permissions
```

Every permission must have a documented reason.

Example:

```text
Permission
    ↓
Use Case
    ↓
Why Required
    ↓
Security Impact
```

Permission changes require security review.

---

# 19. Content Script Security

Content scripts must treat page data as untrusted input.

Do not blindly:

```text
eval()

innerHTML with untrusted data

execute page-provided JavaScript

inject arbitrary scripts

trust DOM text as authoritative state
```

Prefer:

```text
textContent

structured parsing

validated data

explicit selectors

strict schemas
```

---

# 20. State Detection Security

The State Detector observes application state.

It must not automatically authorize an action.

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
Action Guard
 ↓
Executor
```

State detection signals may include:

```text
URL
DOM structure
visible controls
application markers
navigation
network metadata
server-confirmed evidence
```

No individual UI signal should automatically prove a critical state.

---

# 21. UI Text Is Not Security Evidence

The following are NOT authoritative:

```text
"Success"
"Reserved"
"Payment successful"
"Order completed"
"Buy now"
"Continue"
```

A UI label can be spoofed, changed, localized, or rendered before server confirmation.

Therefore:

```text
UI text ≠ authoritative state
```

---

# 22. Evidence Security

Critical states require evidence.

## HELD

Possible evidence:

```text
reservation_id
hold_id
checkout_reference
server-confirmed inventory state
authoritative server response
```

## CONFIRMED

Possible evidence:

```text
order_id
ticket_id
confirmation_reference
server-confirmed order state
authoritative confirmation response
```

Exact evidence definitions remain implementation-specific.

---

# 23. Reservation Security Boundary

The following does NOT prove reservation:

```text
button clicked

button disabled

spinner disappeared

DOM changed

URL changed

client-side notification

local variable changed
```

Required:

```text
server-confirmed evidence
```

Therefore:

```text
RESERVING
    ↓
server-confirmed evidence
    ↓
HELD
```

not:

```text
RESERVING
    ↓
button click
    ↓
HELD
```

---

# 24. Confirmation Security Boundary

The following does NOT prove purchase confirmation:

```text
payment button clicked

payment popup closed

client-side success message

redirect occurred

DOM changed
```

Required:

```text
authoritative confirmation evidence
```

Therefore:

```text
PAYMENT
    ↓
verified confirmation
    ↓
CONFIRMED
```

---

# 25. Message Security

Messages between:

```text
Popup
Service Worker
Content Script
Controller
State Machine
```

must use typed schemas.

Validate:

```text
message_type
payload_shape
schema_version
expected_sender
profile_id
account_id
event_id
workflow_id
current_state
allowed_transition
```

Reject invalid messages.

---

# 26. Message Authorization

A component must not perform actions merely because it received a message.

Example:

```text
RESERVE
```

is only valid when current state permits the transition.

For example:

```text
SELECTING
    ↓
RESERVING
```

is valid.

But:

```text
READY
    ↓
RESERVING
```

must be rejected.

---

# 27. Action Guard

Every automation action must pass an action guard.

Conceptually:

```text
canExecuteAction(
    currentState,
    detectedPageState,
    action,
    accountContext,
    eventContext
)
```

Result:

```text
ALLOW
```

or:

```text
DENY
```

The executor must never bypass the action guard.

---

# 28. Action Guard Rules

Examples:

```text
READY → purchase
DENY

READY → reserve
DENY

SELECTING → valid_selection
ALLOW

RESERVING → hold_confirmation
ALLOW

UNKNOWN → reserve
DENY

CAPTCHA_REQUIRED → reserve
DENY

PAYMENT_ACTION_REQUIRED → payment_action
DENY
```

Security state always takes precedence over normal automation.

---

# 29. State Transition Authorization

Every transition must be validated.

Required:

```text
from_state
+
event
+
current_context
+
required_evidence
```

must match a known transition.

Unknown transitions must be rejected.

---

# 30. Unknown State Handling

If application state cannot be reliably identified:

```text
UNKNOWN
```

The system must:

```text
STOP ACTION
PERSIST STATE
LOG SANITIZED ERROR
NOTIFY USER
WAIT FOR SAFE RECOVERY
```

It must not:

```text
guess
retry aggressively
click random controls
continue checkout
attempt payment
assume success
```

---

# 31. Security Challenge Detection

Potential security challenge signals:

```text
CAPTCHA
OTP
3DS
re-authentication
verification page
anti-bot challenge
unknown security prompt
```

If recognized:

```text
→ corresponding HUMAN_INTERVENTION state
```

If not recognized:

```text
→ UNKNOWN_SECURITY_CHALLENGE
```

---

# 32. Controller Security

If a desktop controller is introduced:

```text
Controller
    ↓
Local IPC
    ↓
Chrome Profiles
```

The controller should prefer local IPC rather than exposing an unauthenticated network control API.

If IPC is used, messages must be authenticated and validated.

---

# 33. Local IPC Security

IPC messages should include:

```text
message_type
schema_version
profile_id
account_id
workflow_id
timestamp
request_id
```

Reject:

```text
unknown sender
invalid schema
wrong profile
wrong account
invalid state
expired request
```

---

# 34. Remote Backend

If backend is added later:

```text
Extension
    ↓
Authenticated API
    ↓
Backend
```

Backend MUST NOT receive:

```text
password
OTP
session cookies
raw authentication tokens
payment credentials
CVV
```

Backend should operate on metadata rather than browser secrets.

---

# 35. Backend Data Model

Potentially allowed:

```text
User
Device
Event
Preference
Profile Metadata
Usage Metrics
Non-sensitive Logs
Workflow Metadata
```

Avoid storing:

```text
authentication secrets
payment credentials
raw browser sessions
session cookies
```

---

# 36. Multi-Account Security

Multiple accounts create additional risks:

```text
wrong profile
wrong event
wrong strategy
wrong account
wrong checkout
wrong reservation
wrong notification
```

Therefore every operation must have, where applicable:

```text
profile_id
account_id
event_id
workflow_id
attempt_id
```

---

# 37. Cross-Account Isolation

Never allow:

```text
Profile A
    ↓
Account B configuration
```

without an explicit controller operation.

Every runtime instance must know its assigned:

```text
profile_id
account_id
event_id
```

Cross-account state must be rejected.

---

# 38. Account Context Validation

Before every critical action verify:

```text
current_profile_id == configured_profile_id

current_account_id == configured_account_id

current_event_id == configured_event_id
```

If any mismatch exists:

```text
STOP
NOTIFY
DO NOT PURCHASE
```

---

# 39. Event Context Security

Before purchase workflow begins, validate:

```text
event_id
event_url
event_context
configured_preferences
```

The system must not silently switch to another event.

A navigation to an unexpected event must produce:

```text
EVENT_CONTEXT_MISMATCH
```

and stop the workflow.

---

# 40. Explicit Arming Security

Before:

```text
ARMED
```

the system must not execute:

```text
reservation
checkout
payment
purchase
```

User must explicitly initiate:

```text
READY
    ↓
ARM
    ↓
ARMED
```

Arming should be auditable.

---

# 41. User Stop

User must always be able to stop an active workflow.

Examples:

```text
MONITORING → STOPPED

SELECTING → STOPPED

RESERVING → STOPPED

CHECKOUT → STOPPED

PAYMENT → STOPPED
```

User stop has higher priority than normal automation.

---

# 42. Global Stop

Global stop must be fail-safe.

When triggered:

```text
Controller
    ↓
STOP signal
    ↓
all active sessions
    ↓
prevent new purchase actions
```

Already completed server-side reservations are not assumed to be cancellable merely because local execution stopped.

---

# 43. Global Stop Priority

Priority:

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

# 44. Rate-Limit Handling

If the platform signals:

```text
RATE_LIMITED
```

the system must not:

```text
rotate IP

rotate cookies

increase concurrency

increase request rate

bypass queue

spawn more accounts to compensate

```

Default behavior:

```text
STOP
LOG
NOTIFY
```

Retry is allowed only if explicitly defined by a safe retry policy.

---

# 45. Anti-Abuse Boundary

The product must not intentionally circumvent:

```text
CAPTCHA

rate limits

queue systems

anti-bot controls

access controls

authentication controls

security challenges
```

The system should operate through the normal browser/application flow.

---

# 46. Automation Rate Safety

Monitoring must not create uncontrolled request loops.

The system must define:

```text
polling interval
backoff
maximum retry count
concurrency limit
stop conditions
```

If these values are unknown:

```text
FAIL SAFE
```

Do not default to unlimited retry.

---

# 47. Retry Security

Retry must be state-aware.

Only explicitly retryable states may transition back to monitoring.

Example:

```text
FAILURE
    ↓
RETRY_POLICY
    ↓
MONITORING
```

Retry metadata:

```text
retry_count
max_retry_count
backoff
last_attempt_at
next_attempt_at
failure_reason
```

---

# 48. Non-Retryable Security Conditions

The following should normally stop or require user intervention:

```text
RATE_LIMITED

SESSION_EXPIRED

AUTH_FAILURE

CAPTCHA_REQUIRED

OTP_REQUIRED

UNKNOWN_SECURITY_CHALLENGE

PAYMENT_FAILED

UNKNOWN

EVENT_CONTEXT_MISMATCH
```

No automatic bypass.

---

# 49. Human Intervention Record Security

Every human intervention should create or update:

```text
intervention_id
account_id
profile_id
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

Do not store:

```text
OTP value
password
payment credentials
raw session token
```

---

# 50. Notification Security

Notifications must not expose sensitive information.

Allowed:

```text
CAPTCHA required
OTP verification required
Payment action required
Reservation held
Purchase confirmed
Workflow stopped
```

Avoid:

```text
password
OTP
CVV
full card number
session token
authentication cookie
```

Notifications should use references rather than raw sensitive values.

---

# 51. Notification State Integrity

Notification Manager must not independently change workflow state.

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
User
```

A notification is an output of the state machine.

It is not the source of truth.

---

# 52. Audit Logging

Every critical state transition should generate an immutable audit event.

Example:

```text
{
    workflow_id,
    account_id,
    profile_id,
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

Actors:

```text
SYSTEM
USER
SERVER
```

Sensitive values must be redacted.

---

# 53. Evidence Audit

For:

```text
HELD
CONFIRMED
```

audit metadata should record:

```text
evidence_type
evidence_reference
verified_at
verification_source
```

Do not store the full sensitive server response unless required.

---

# 54. Security Event Classification

System should classify:

```text
AUTH_FAILURE

SESSION_EXPIRED

RATE_LIMITED

INVALID_MESSAGE

INVALID_STATE_TRANSITION

SUSPICIOUS_PAGE_STATE

UNKNOWN_SECURITY_CHALLENGE

EVENT_CONTEXT_MISMATCH

ACCOUNT_CONTEXT_MISMATCH

PROFILE_CONTEXT_MISMATCH

STORAGE_ERROR

CONTROLLER_ERROR

EVIDENCE_VERIFICATION_FAILED

ACTION_GUARD_DENIED
```

---

# 55. Suspicious Page State

If page behaviour does not match the expected application state:

```text
SUSPICIOUS_PAGE_STATE
```

The system should:

```text
PAUSE
PERSIST
NOTIFY
```

Do not blindly continue.

---

# 56. State Machine Security Contract

The security layer must enforce:

```text
No purchase before ARMED.

No RESERVING without valid candidate.

No HELD without server-confirmed evidence.

No CONFIRMED without confirmation evidence.

No payment security bypass.

No CAPTCHA bypass.

No OTP collection.

No unknown-state automation.

No cross-account action.

No cross-profile action.

No uncontrolled retry.

No action after global stop.
```

---

# 57. Critical Negative Security Tests

The following must explicitly fail.

## Test 1

```text
READY → RESERVING
```

Expected:

```text
DENY
```

---

## Test 2

```text
RESERVING
+
button_clicked
→
HELD
```

Expected:

```text
DENY
```

Reason:

```text
No server-confirmed evidence.
```

---

## Test 3

```text
PAYMENT
+
client_success_message
→
CONFIRMED
```

Expected:

```text
DENY
```

Reason:

```text
No authoritative confirmation evidence.
```

---

## Test 4

```text
CAPTCHA_REQUIRED
→
RESERVING
```

Expected:

```text
DENY
```

---

## Test 5

```text
OTP_REQUIRED
→
PAYMENT
```

without verified resulting state.

Expected:

```text
DENY
```

---

## Test 6

```text
UNKNOWN
→
RESERVING
```

Expected:

```text
DENY
```

---

## Test 7

```text
Profile A
→
Account B
```

without explicit authorized context.

Expected:

```text
DENY
```

---

## Test 8

```text
GLOBAL_STOPPED
→
RESERVING
```

Expected:

```text
DENY
```

---

# 58. Browser Profile Security

Recommended:

```text
OS User
    ↓
Chrome
    ↓
Isolated Profile
```

Do not export profile directories as a method of transferring authenticated sessions.

Do not clone authenticated profile data into another account.

---

# 59. Source Code Security

Never commit:

```text
.env

credentials

cookies

session dumps

DevTools HAR containing credentials

screenshots containing sensitive data

real account identifiers where unnecessary

passwords

OTP

payment information
```

Recommended `.gitignore`:

```text
.env
.env.*
*.har
*.log
secrets/
credentials/
private/
```

If a discovery HAR is needed:

```text
discovery/sample.har
```

must be sanitized first.

---

# 60. Discovery Artifact Policy

Development discovery may inspect:

```text
DOM
network metadata
application state
public API responses
page navigation
```

But artifacts must be sanitized before persistence.

Remove:

```text
Cookie
Authorization
Set-Cookie
session tokens
password
OTP
payment data
personal data
```

Use:

```text
[REDACTED]
```

---

# 61. Supply Chain

Dependencies must:

```text
be reviewed
be version-pinned where appropriate
be updated intentionally
not execute unexplained remote scripts
have a justified purpose
```

Do not install random browser automation packages merely to solve one problem.

---

# 62. Dependency Security Review

For every package ask:

```text
Why is this needed?

What permissions does it require?

Does it access credentials?

Does it send telemetry?

Is it maintained?

What network access does it require?

Can it execute arbitrary code?

Is there a smaller alternative?
```

---

# 63. Threat Model

## Threat T-001 — Credential Theft

Mitigation:

```text
No credential storage
No credential collection
No credential logging
No credential backend transfer
```

---

## Threat T-002 — Session Theft

Mitigation:

```text
No cookie export
No session token backend
Browser profile isolation
No profile cloning
```

---

## Threat T-003 — Wrong Account

Mitigation:

```text
Profile isolation
account_id
profile_id
context validation
action guard
```

---

## Threat T-004 — Wrong Event

Mitigation:

```text
event_id
event URL validation
event context validation
configuration confirmation
```

---

## Threat T-005 — Wrong Purchase

Mitigation:

```text
ARM action
explicit configuration
selection policy
state machine
action guard
global STOP
```

---

## Threat T-006 — Uncontrolled Retry

Mitigation:

```text
bounded retry
rate-limit stop
backoff
unknown-state stop
```

---

## Threat T-007 — Malicious Page Content

Mitigation:

```text
input validation
safe DOM APIs
strict message validation
no arbitrary script execution
```

---

## Threat T-008 — False Reservation Detection

Mitigation:

```text
server-confirmed evidence
evidence validation
HELD state guard
```

---

## Threat T-009 — False Purchase Confirmation

Mitigation:

```text
authoritative confirmation evidence
CONFIRMED state guard
audit evidence
```

---

## Threat T-010 — Security Challenge Bypass

Mitigation:

```text
CAPTCHA_REQUIRED
OTP_REQUIRED
PAYMENT_ACTION_REQUIRED
SESSION_REAUTH_REQUIRED
UNKNOWN_SECURITY_CHALLENGE
```

All require human intervention or safe stop.

---

## Threat T-011 — Cross-Account Contamination

Mitigation:

```text
profile_id
account_id
event_id
workflow_id
strict context validation
isolated state
```

---

# 64. Incident Response

If sensitive data is accidentally logged:

```text
1. Stop distribution.

2. Remove exposed artifact.

3. Rotate affected credentials/session if applicable.

4. Identify exposure scope.

5. Inspect Git history and artifacts.

6. Add regression protection.

7. Document incident.
```

Never assume deleting a Git commit is sufficient if secrets were previously pushed.

---

# 65. Secret Exposure Response

If authentication material is exposed:

```text
STOP
↓
IDENTIFY
↓
REVOKE / ROTATE
↓
REMOVE ARTIFACT
↓
AUDIT
↓
ADD PREVENTION
```

Do not continue operating with known-exposed credentials or sessions.

---

# 66. Privacy

If a backend collects user information, the project must document:

```text
what is collected

why it is collected

where it is stored

how long it is retained

who can access it

how it can be deleted
```

The exact legal/privacy requirements depend on deployment jurisdiction and business model and should be reviewed before production launch.

---

# 67. Data Retention

Every persisted data category should have a retention decision.

Example:

```text
Workflow metadata
→ retain only as operationally necessary

Logs
→ bounded retention

Intervention records
→ bounded retention

Purchase metadata
→ explicit business requirement

Sensitive authentication data
→ never persist
```

Avoid indefinite retention by default.

---

# 68. Backend Access Control

If backend is introduced:

```text
User
    ↓
Authenticated API
    ↓
Authorization
    ↓
Backend Resource
```

Every backend operation must verify:

```text
user_id
resource ownership
permission
request scope
```

Never trust:

```text
account_id
profile_id
event_id
```

from the client without authorization.

---

# 69. Multi-Account Backend Security

If multiple accounts are represented in backend metadata:

```text
User
 ├── Account A
 ├── Account B
 └── Account C
```

Requests must not allow:

```text
Account A
    ↓
read/update
    ↓
Account B
```

without explicit authorization.

---

# 70. Controller Command Security

Every controller command must include:

```text
command_id
profile_id
account_id
workflow_id
issued_at
expires_at
```

Commands must be rejected when:

```text
expired
unknown
wrong profile
wrong account
invalid state
duplicate
```

---

# 71. Replay Protection

Security-sensitive commands should have unique:

```text
command_id
request_id
attempt_id
```

Duplicate commands should not unintentionally repeat:

```text
reservation
checkout
payment
```

Where applicable, commands should be idempotent.

---

# 72. Payment Replay Protection

Payment actions require additional caution.

The system must not blindly repeat payment because:

```text
response_timeout
page_reload
network_error
unknown_payment_state
```

A timeout does not automatically mean:

```text
payment_failed
```

Payment state must be verified before retry.

---

# 73. Reservation Replay Protection

Similarly:

```text
reservation_timeout
network_error
page_reload
unknown_response
```

must not automatically mean:

```text
reservation_failed
```

The system must attempt state verification before creating another reservation attempt.

---

# 74. Security and State Machine Relationship

The security layer and state machine must work together.

```text
                State Detector
                      ↓
                State Machine
                      ↓
                 Security
                      ↓
                 Action Guard
                      ↓
                  Executor
```

Security rules may deny an otherwise technically valid action.

Example:

```text
State = RESERVING
Action = continue

Security = CAPTCHA_REQUIRED

Result = DENY
```

---

# 75. Security Override Rules

Security must never be overridden by:

```text
retry
multi-account mode
high priority
user preference
performance optimization
global running state
```

A security stop remains authoritative until the condition is resolved.

---

# 76. Safe Shutdown

When extension/controller shuts down:

```text
persist state
stop new actions
cancel local timers
stop polling
close local control channels
sanitize logs
```

Do not attempt to resume purchase automatically after restart unless explicitly configured and state can be safely revalidated.

---

# 77. Restart Recovery

After restart:

```text
INIT
    ↓
LOAD PERSISTED METADATA
    ↓
AUTH_CHECK
    ↓
EVENT_CHECK
    ↓
REVALIDATE CONTEXT
    ↓
REVALIDATE STATE
```

Do not blindly resume:

```text
RESERVING
CHECKOUT
PAYMENT
```

from persisted local state.

Server/application state must be revalidated.

---

# 78. Security Invariants

The following invariants must always hold:

```text
1. No credentials persisted.

2. No OTP persisted.

3. No payment credentials persisted.

4. No raw authentication cookies exported.

5. No purchase before explicit ARM.

6. No RESERVING without valid candidate.

7. No HELD without authoritative evidence.

8. No CONFIRMED without authoritative evidence.

9. CAPTCHA is never automatically bypassed.

10. OTP is never automatically harvested.

11. Payment security verification remains user-controlled.

12. Unknown security states fail safe.

13. Unknown application states fail safe.

14. User STOP overrides automation.

15. Global STOP prevents new purchase actions.

16. Account context is isolated.

17. Browser profile context is isolated.

18. Event context is validated.

19. Retry is bounded.

20. Rate limits are respected.

21. Security challenges cannot be bypassed.

22. UI text is never authoritative security evidence.

23. Critical state transitions are auditable.

24. Sensitive logs are sanitized.

25. Restart never blindly resumes a critical action.
```

---

# 79. Security Acceptance Criteria

Security review passes only when:

```text
[ ] No credentials persisted

[ ] No OTP persisted

[ ] No payment credentials persisted

[ ] No raw session cookies exported

[ ] Sensitive logs sanitized

[ ] Extension permissions reviewed

[ ] Message schemas validated

[ ] Action guard implemented

[ ] State transition authorization implemented

[ ] Profile isolation tested

[ ] Account isolation tested

[ ] Event context validation tested

[ ] Global stop tested

[ ] User stop tested

[ ] Rate-limit behavior tested

[ ] Unknown state fails safely

[ ] CAPTCHA intervention tested

[ ] OTP intervention tested

[ ] Payment intervention tested

[ ] Session re-authentication tested

[ ] Unknown security challenge tested

[ ] HELD evidence validation tested

[ ] CONFIRMED evidence validation tested

[ ] Restart recovery tested

[ ] Replay protection tested

[ ] Payment retry safety tested

[ ] Reservation retry safety tested

[ ] Discovery artifacts sanitized

[ ] Backend authorization tested if backend exists
```

---

# 80. Security Test Matrix

Minimum test coverage:

| Security Area | Test                                |
| ------------- | ----------------------------------- |
| Credentials   | Password never persisted            |
| OTP           | OTP never persisted                 |
| Cookies       | Cookie never exported               |
| Payment       | Payment credentials never persisted |
| Permissions   | Only required permissions           |
| State         | Invalid transition rejected         |
| Action Guard  | Unauthorized action rejected        |
| CAPTCHA       | Automation pauses                   |
| OTP           | Automation pauses                   |
| Payment       | User action required                |
| Unknown State | Automation stops                    |
| Wrong Account | Action rejected                     |
| Wrong Profile | Action rejected                     |
| Wrong Event   | Action rejected                     |
| Rate Limit    | Retry stopped/backed off            |
| Global Stop   | New actions prevented               |
| User Stop     | New actions prevented               |
| HELD          | Evidence required                   |
| CONFIRMED     | Evidence required                   |
| Restart       | State revalidated                   |
| Replay        | Duplicate command rejected          |
| Logging       | Sensitive fields redacted           |

---

# 81. Compliance Boundary

This project must distinguish:

```text
technical capability
```

from:

```text
permission to use that capability
```

Before production deployment, review:

- Ticketbox Terms of Service;
- applicable privacy requirements;
- applicable consumer/payment requirements;
- Chrome Web Store extension policies if distributed publicly;
- organizational security requirements.

This document does not claim legal compliance by itself.

---

# 82. Platform-Safe Behaviour

The product should operate through the normal browser/application flow.

It must not intentionally attempt to defeat:

```text
authentication
CAPTCHA
rate limits
queue systems
anti-bot controls
access controls
security verification
```

The product should prefer:

```text
observe
verify
act
re-check
```

rather than:

```text
assume
force
bypass
retry indefinitely
```

---

# 83. Security Decision Hierarchy

When multiple signals conflict, use:

```text
1. Server-confirmed security evidence
2. Verified application state
3. State machine rules
4. Security policy
5. State detector
6. DOM/network signals
7. UI text
```

Never let a lower-trust signal override a higher-trust security condition.

Example:

```text
UI says "Success"

but

server state is unknown

→ NOT SUCCESS
→ STATE_RECHECK / UNKNOWN
```

---

# 84. Security Source of Truth

The following documents must remain consistent:

```text
Security & Compliance Specification
        +
State Machine Specification
        +
Architecture Specification
        +
Testing Specification
```

If a conflict exists:

```text
Security boundary
    ↓
must be preserved
```

Implementation must not weaken a security constraint simply to make automation work.

---

# 85. Implementation Rules

Any implementation introducing a new:

```text
state
transition
permission
message
persistent field
controller command
backend endpoint
security-sensitive action
```

must update this security specification.

No undocumented security-sensitive capability may be silently introduced.

---

# 86. Security Review Checklist

Before implementation:

```text
[ ] Threat identified
[ ] Data classification identified
[ ] Required permission identified
[ ] State impact identified
[ ] Human intervention impact identified
[ ] Logging impact identified
[ ] Persistence impact identified
[ ] Multi-account impact identified
[ ] Failure behaviour defined
[ ] Stop condition defined
```

Before production:

```text
[ ] Security tests pass
[ ] Sensitive data scan passes
[ ] Permission review passes
[ ] Dependency review passes
[ ] Profile isolation passes
[ ] Account isolation passes
[ ] State authorization passes
[ ] Global stop passes
[ ] Human intervention passes
[ ] Evidence verification passes
[ ] Privacy review completed
[ ] Terms/policy review completed
```

---

# 87. Final Security Principle

> The product should automate user-approved interaction, not take ownership of the user's credentials and not attempt to defeat the platform's security controls.

The assistant may automate supported purchase-flow interactions only while:

```text
state is known
+
context is correct
+
action is authorized
+
security conditions are satisfied
+
required evidence exists
```

Otherwise:

```text
PAUSE
STOP
NOTIFY
```

---

# 88. Final Security Boundary

```text
                         USER
                           │
                           ▼
                    Chrome Profile
                           │
                           ▼
                       Ticketbox
                           │
              ┌────────────┴────────────┐
              │                         │
         Extension                    User
              │                         │
       State Detection          CAPTCHA / OTP
              │                  Payment Action
       State Machine                   │
              │                         │
        Action Guard                   │
              │                         │
          Executor                     │
              └────────────┬────────────┘
                           ▼
                     Result State
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
             HELD                   CONFIRMED
```

Credentials remain with the authentication/payment systems and user-controlled browser session rather than becoming application-owned secrets.

The extension remains an interaction assistant, not a credential manager, payment processor, authentication bypass, or security-control bypass mechanism.
