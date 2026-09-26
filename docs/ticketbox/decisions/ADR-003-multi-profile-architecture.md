# ADR-003 — Multi-Profile Architecture

**Status:** Accepted

## Decision

Mỗi Ticketbox account được isolation bằng một Chrome Profile riêng.

```text
Profile A
 └── Ticketbox Account A

Profile B
 └── Ticketbox Account B

Profile C
 └── Ticketbox Account C
```

## Why Profile Isolation

Browser profile naturally isolates:

```text
cookies
localStorage
session state
browser data
extension runtime context
```

## Rejected

### Cookie Switching

Không sử dụng:

```text
Account A cookie
↓
replace cookie
↓
Account B
```

Lý do:

- dễ session contamination;
- khó debug;
- khó recover;
- tăng security risk.

### One Browser Tab Per Account

Không coi tab là authentication boundary.

Tab chỉ là UI context.

Profile mới là isolation boundary.

## Controller

Desktop Controller quản lý:

```text
Profile
Account metadata
Event assignment
Status
Start/stop
Global coordination
```

Controller không sở hữu Ticketbox credentials.

## Principle

> One authenticated account = one isolated browser profile.
