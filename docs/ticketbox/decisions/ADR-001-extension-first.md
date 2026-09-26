# ADR-001 — Extension-First Architecture

**Status:** Accepted
**Date:** 2026-09-26

## Context

Product cần tương tác với Ticketbox thông qua browser session của người dùng.

Các phương án:

1. Web application
2. Backend automation
3. Desktop automation
4. Chrome Extension
5. Extension + Desktop Controller

Backend automation tạo thêm network hop và không có lợi thế trong critical browser interaction.

Desktop automation có thể quản lý browser tốt nhưng làm tăng complexity ngay từ MVP.

## Decision

Chrome Extension là execution client chính.

Desktop Controller chỉ được thêm sau khi single-account extension flow đã được chứng minh.

Architecture:

```text
Chrome
└── Ticketbox
    └── Extension
        ├── Observer
        ├── Selection Engine
        ├── Reservation Monitor
        └── State Machine
```

## Consequences

### Positive

- Gần browser/user session.
- UI state có thể được quan sát trực tiếp.
- Không cần backend trong critical path.
- MVP nhỏ.
- Dễ debug bằng Chrome DevTools.

### Negative

- Phụ thuộc browser.
- Phụ thuộc thay đổi UI/application behavior.
- MV3 có lifecycle constraints.
- Một số browser API bị giới hạn.

## Rejected

Không chọn backend làm execution layer chính.

Không chọn desktop automation làm MVP.

## Rule

> Extension is the execution layer. Backend is never assumed to be the execution layer.
