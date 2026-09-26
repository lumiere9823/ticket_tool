# Ticketbox Purchase Assistant

## Security & Compliance Specification

**Version:** 1.0
**Status:** Security Baseline

---

# 1. Purpose

Tài liệu này định nghĩa security boundary của sản phẩm.

Mục tiêu:

```text
Protect user account
Protect browser session
Protect personal data
Protect payment information
Prevent credential leakage
Prevent uncontrolled automation
Maintain platform-safe behavior
```

---

# 2. Security Principles

## S-001 — Least Privilege

Extension chỉ request những Chrome permissions thực sự cần thiết.

Không yêu cầu quyền rộng hơn nhu cầu.

---

## S-002 — No Credential Ownership

Product không trở thành credential manager cho Ticketbox.

Authentication thuộc về:

```text
User
+
Ticketbox
+
Browser session
```

---

## S-003 — Session Isolation

Mỗi account phải được isolation bằng browser profile riêng.

```text
Profile A
    ≠
Profile B
```

---

## S-004 — Sensitive Data Minimization

Chỉ lưu dữ liệu thực sự cần thiết.

Không lưu dữ liệu chỉ vì "có thể cần sau này".

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

---

# 3. Data Classification

## Public

```text
event name
venue
public ticket category
public event URL
```

---

## Internal

```text
preferences
local configuration
application logs
attempt IDs
performance metrics
```

---

## Sensitive

```text
account identifiers
purchase history
personal information
reservation identifiers
checkout references
```

---

## Highly Sensitive

```text
password
OTP
authentication token
session cookie
payment credentials
CVV
```

Highly Sensitive data MUST NOT be persisted by the application.

---

# 4. Credential Policy

Product MUST NOT:

```text
capture password
store password
log password
request password through extension UI
```

Authentication should occur through the normal Ticketbox authentication UI.

---

# 5. OTP Policy

Product MUST NOT:

```text
intercept OTP
store OTP
log OTP
forward OTP
automatically harvest OTP
```

If Ticketbox requires OTP:

```text
User
 ↓
Ticketbox
 ↓
OTP verification
 ↓
Authenticated session
```

---

# 6. Session Policy

The extension may operate inside an authenticated browser session.

It MUST NOT:

```text
extract cookies for external storage
send session cookies to project backend
synchronize raw session tokens
display raw authentication tokens
```

---

# 7. Cookie Policy

Cookies are treated as sensitive authentication material.

Forbidden:

```text
document.cookie → backend
```

or equivalent extraction of authentication cookies for storage.

Profile isolation should be provided by Chrome itself.

---

# 8. Payment Security

MVP does not store:

```text
card number
CVV
bank credentials
wallet credentials
payment password
```

Payment should remain within the supported Ticketbox/payment-provider flow.

---

# 9. Personal Data

Potential personal data:

```text
name
email
phone
billing information
shipping information
account identifiers
```

The system should avoid collecting this unless required for an explicit feature.

---

# 10. Logging Security

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
```

---

# 11. Network Logging

DevTools discovery may temporarily expose sensitive headers.

Discovery notes MUST NOT be committed with:

```text
real Cookie
Authorization
session tokens
personal payment data
```

Use:

```text
[REDACTED]
```

instead.

---

# 12. Local Storage

Allowed:

```text
event configuration
ticket preferences
UI settings
non-sensitive state
non-sensitive metrics
```

Forbidden:

```text
password
OTP
CVV
raw authentication cookies
raw access tokens
```

---

# 13. Extension Permissions

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
Use case
    ↓
Why unavoidable
```

---

# 14. Content Script Security

Content scripts must treat page data as untrusted input.

Do not blindly:

```text
eval()
innerHTML with untrusted data
execute page-provided JavaScript
```

Prefer:

```text
textContent
structured parsing
validated data
explicit selectors
```

---

# 15. Message Security

Messages between:

```text
Popup
Service Worker
Content Script
Controller
```

must use typed schemas.

Validate:

```text
message type
payload shape
expected sender
allowed state transition
```

---

# 16. State Authorization

A component must not perform actions merely because it received a message.

Example:

```text
RESERVE
```

is only valid when current state permits:

```text
SELECTING
```

or another explicitly defined transition.

---

# 17. Controller Security

If a desktop controller is introduced:

```text
Controller
    ↓
Local IPC
    ↓
Chrome profiles
```

The controller should prefer local IPC rather than exposing an unauthenticated network control API.

---

# 18. Remote Backend

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
payment credentials
```

---

# 19. Backend Data Model

Potentially allowed:

```text
User
Device
Event
Preference
Profile metadata
Usage metrics
Non-sensitive logs
```

Avoid storing:

```text
authentication secrets
payment credentials
raw browser sessions
```

---

# 20. Multi-account Security

Multiple accounts create additional risks:

```text
wrong profile
wrong event
wrong strategy
wrong account
wrong checkout
```

Therefore every operation must have:

```text
profile_id
account_id
event_id
attempt_id
```

where applicable.

---

# 21. Cross-account Isolation

Never allow:

```text
Profile A
    ↓
Account B configuration
```

without an explicit controller operation.

Every runtime instance must know its assigned profile/account context.

---

# 22. Global Stop

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

# 23. Rate-limit Handling

If the platform signals rate limiting:

```text
RATE_LIMITED
```

system must not:

```text
rotate IP
rotate cookies
increase concurrency
increase request rate
bypass queue
```

Default behavior:

```text
STOP
LOG
NOTIFY
```

---

# 24. Anti-abuse Boundary

The product must not intentionally circumvent:

```text
CAPTCHA
rate limits
queue systems
anti-bot controls
access controls
authentication controls
```

The system should operate through the normal browser/application flow.

---

# 25. Browser Profile Security

Recommended:

```text
OS user account
    ↓
Chrome
    ↓
isolated profile
```

Do not export profile directories as a method of transferring authenticated sessions.

---

# 26. Source Code Security

Never commit:

```text
.env
credentials
cookies
session dumps
DevTools HAR containing credentials
screenshots containing sensitive data
real account identifiers where unnecessary
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

# 27. Supply Chain

Dependencies must:

```text
be reviewed
be version-pinned where appropriate
be updated intentionally
not execute unexplained remote scripts
```

Do not install random browser automation packages merely to solve one problem.

---

# 28. Dependency Permissions

For every package ask:

```text
Why is this needed?
What permissions does it require?
Does it access credentials?
Does it send telemetry?
Is it maintained?
```

---

# 29. Threat Model

## Threat T-001 — Credential Theft

Mitigation:

```text
No credential storage
No credential collection
```

---

## Threat T-002 — Session Theft

Mitigation:

```text
No cookie export
No session token backend
```

---

## Threat T-003 — Wrong Account

Mitigation:

```text
Profile isolation
account_id
profile_id
```

---

## Threat T-004 — Wrong Event

Mitigation:

```text
event_id
event URL validation
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
global STOP
```

---

## Threat T-006 — Uncontrolled Retry

Mitigation:

```text
bounded retry
rate-limit stop
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

# 30. Security Events

System should classify:

```text
AUTH_FAILURE
SESSION_EXPIRED
RATE_LIMITED
INVALID_MESSAGE
INVALID_STATE_TRANSITION
SUSPICIOUS_PAGE_STATE
STORAGE_ERROR
CONTROLLER_ERROR
```

---

# 31. Incident Response

If sensitive data is accidentally logged:

```text
1. Stop distribution
2. Remove exposed artifact
3. Rotate affected credentials/session if applicable
4. Identify exposure scope
5. Add regression protection
```

Never assume deleting a Git commit is sufficient if secrets were previously pushed.

---

# 32. Privacy

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

# 33. Compliance Boundary

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

# 34. Security Acceptance Criteria

Security review passes only when:

```text
[ ] No credentials persisted
[ ] No OTP persisted
[ ] No payment credentials persisted
[ ] No raw session cookies exported
[ ] Sensitive logs sanitized
[ ] Extension permissions reviewed
[ ] Message schemas validated
[ ] Profile isolation tested
[ ] Global stop tested
[ ] Rate-limit behavior tested
[ ] Unknown state fails safely
[ ] Discovery artifacts sanitized
```

---

# 35. Security Principle

> The product should automate user-approved interaction, not take ownership of the user's credentials or attempt to defeat the platform's security controls.

---

# 36. Final Security Boundary

```text
                 USER
                   │
                   ▼
             Chrome Profile
                   │
                   ▼
              Ticketbox
                   │
          ┌────────┴────────┐
          │                 │
       Extension          User
          │                 │
          │             Payment/OTP
          │                 │
          └────────┬────────┘
                   ▼
              Result State
```

Credentials remain with the authentication/payment systems and user-controlled browser session rather than becoming application-owned secrets.
