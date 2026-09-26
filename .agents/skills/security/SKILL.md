# Security and Compliance Skill

## Purpose

Security is a mandatory architectural boundary.

The system must automate user-approved browser interactions without becoming the owner of user credentials or authentication secrets.

---

## 1. Security Principles

Use:

- least privilege
- data minimization
- secure defaults
- explicit authorization
- profile isolation
- fail-safe behavior

---

## 2. Forbidden Storage

Never store:

- passwords
- OTP codes
- CVV
- payment credentials
- raw authentication cookies
- raw session tokens

---

## 3. Logging

Never log:

- password
- OTP
- CVV
- Authorization header
- Cookie header
- Set-Cookie
- session tokens
- payment information

Logs must be sanitized.

---

## 4. Browser Session

The extension operates within the user's normal browser authentication context.

Do not:

- export sessions
- copy cookies
- extract authentication tokens
- transfer sessions between profiles

---

## 5. Multi-Profile Security

Each account should correspond to an isolated Chrome profile.

Never implement:

cookie switching

as a mechanism for changing accounts.

---

## 6. Message Security

Validate every extension message.

Validate:

- message type
- payload
- sender
- expected state
- allowed operation

Reject malformed or unexpected messages.

---

## 7. DOM Security

Treat page content as untrusted input.

Prefer:

- textContent
- structured parsing
- validated values

Avoid unsafe HTML injection.

Never execute arbitrary page-provided JavaScript.

---

## 8. Network Security

Do not create unnecessary external network dependencies.

If a backend is introduced later:

- authenticate it
- authorize requests
- minimize data
- avoid secrets
- document the security boundary

---

## 9. Rate Limiting

When rate limiting occurs:

1. recognize it;
2. classify the error;
3. stop or follow the documented safe policy;
4. inform the user where appropriate.

Never bypass rate limits.

Do not use:

- IP rotation
- stolen sessions
- credential rotation
- hidden identifier manipulation
- excessive concurrency

to evade controls.

---

## 10. Anti-Abuse Controls

Do not implement mechanisms intended to defeat:

- CAPTCHA
- queue systems
- rate limits
- anti-bot controls
- access controls
- authentication controls

---

## 11. Security Review Triggers

Review security whenever modifying:

- Chrome permissions
- storage
- authentication
- session handling
- network access
- logging
- IPC
- multi-profile architecture

---

## 12. Final Security Boundary

Conceptually:

USER
  ↓
CHROME PROFILE
  ↓
TICKETBOX
  ↓
EXTENSION
  ↓
USER-CONTROLLED PAYMENT / OTP
  ↓
RESULT

Credentials remain under user/browser-controlled systems.

The application should not become a credential vault.