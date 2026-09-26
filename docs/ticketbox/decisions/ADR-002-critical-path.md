# ADR-002 — Critical Path Isolation

**Status:** Accepted

## Decision

Reservation critical path không được phụ thuộc vào backend riêng của project.

Canonical path:

```text
Ticketbox
    ↓
Browser
    ↓
Extension
    ↓
Normal Ticketbox interaction
    ↓
Ticketbox server
    ↓
Reservation result
```

Không:

```text
Ticketbox
    ↓
Our Backend
    ↓
Queue
    ↓
Worker
    ↓
Ticketbox
```

## Reason

Mỗi network hop bổ sung:

- latency;
- failure point;
- operational dependency;
- debugging complexity.

## Backend Responsibilities

Backend chỉ xử lý các chức năng không thuộc critical path:

```text
configuration
analytics
subscription
team management
remote settings
```

## Principle

> Anything required to obtain a reservation must remain as close to the browser execution context as practical.

## Constraint

Decision này không cho phép bypass:

- authentication;
- queue;
- CAPTCHA;
- rate limits;
- anti-abuse controls;
- platform security.
