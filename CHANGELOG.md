# Changelog

## Unreleased — cleanup branch

- Removed confirmed-unused popup modules `state-display.ts` and `timer-manager.ts`.
- Removed the unused `@ui` alias from TypeScript/Vite configuration.
- Fixed 24 pre-existing TypeScript errors without changing runtime behavior.
- Added `docs/ticketbox/README.md` and `docs/ticketbox/SUMMARY.md` as documentation navigation and invariant summary.
- Corrected persistence defaults, poll interval, manifest permission documentation, and user-guide troubleshooting text.
- Added `npm run docs:check` for internal Markdown links and repository-path references.
- Hardened the Chromium CAPTCHA probe with configurable ports, build-directory validation, and guaranteed temporary-profile cleanup.

## 0.1.0

- Initial Ticketbox Purchase Assistant implementation and Manifest V3 extension workflow.
