# Repository Cleanup Report

**Branch:** `chore/cleanup`  
**Baseline commit:** `c4dec20`  
**Cleanup start:** 2026-10-02  
**Status:** In progress; this report is updated as cleanup groups land.

## 1. Baseline

The requested baseline numbers (`56 test files / 584 tests`) do not match the
repository at cleanup start. The measured baseline on `main` was:

- `npm test`: **60 test files / 625 tests passed**, approximately 8.1 seconds.
- `npm run lint`: passed with no warnings/errors.
- `npm run typecheck`: initially failed with 24 pre-existing errors in four
  infrastructure files. These were reproduced with the prior work stashed and
  were fixed in commit `242373d` as type-only corrections.
- `npm run build`: passed after `242373d`.

No production credentials, cookies, OTPs, CVVs, tokens, or live PII were added.

## 2. Changes by area

### A — Code cleanup

- **A1:** Removed confirmed-unused popup state-display and timer-manager modules.
  Both had zero imports in `src/` and
  `tests/`, and their responsibilities are superseded by the current popup
  implementation. Verified by ts-prune/knip cross-check.
- **A2:** No additional duplication was consolidated. The challenge handling
  path is already centralized through `SecurityChallengeHandler`; changing
  content/use-case ownership would be an architectural change, not cleanup.
- **A3:** Removed the unused `@ui` alias from `tsconfig.json` and `vite.config.ts`;
  the aliased UI directory does not exist. Build output was compared with
  `dist/manifest.json`:
  `background.js`, `content.js`, `content-main.js`, and
  `src/extension/popup/popup.html` all match.
- **A4:** Audited `as unknown as`, `as never`, and `any` occurrences. Remaining
  casts are concentrated at DOM/React/Konva/browser-boundary adapters and
  sanitized generic data paths. They were not broadly rewritten because doing
  so could change runtime behavior; the type-only fixes in `242373d` are already
  committed and verified.
- **A5:** Ran `npm run format` in isolated commit `4480d83`, then reran typecheck,
  lint, and tests successfully.

### B — Documentation cleanup

- Added `docs/ticketbox/README.md` as the documentation index.
- Added `docs/ticketbox/SUMMARY.md` with architecture, canonical states,
  security/payment invariants, bounded defaults, and implementation status.
- Updated root `README.md` structure/scripts and added links to the documentation
  index, summary, changelog, and Vietnamese guide.
- Corrected persistence defaults, poll interval, Manifest V3 permissions, consent
  behavior, and user-guide terminology to match code.
- Added troubleshooting guidance for CAPTCHA/OTP, re-authentication, rate limits,
  waiting rooms, 404 recovery, hidden tabs, empty discovery, and payment gate.
- Added `CHANGELOG.md`.
- ADR status was checked: ADR-004 describes the implementation currently running;
  ADR-008 remains **Proposed / Architectural Blueprint**, not implemented.
- Document numbering collisions (two unrelated documents each numbered 18–23)
  are intentionally not renamed in this pass; renaming requires a deliberate
  cross-reference migration.

### C — Test cleanup

- Inventory: `tests/unit` contains 49 files / 595 tests; `tests/performance`
  contains 11 files / 30 tests. The slowest files are
  `KonvaPageBridgeAndSeatSelection.test.ts`, `BookingJourneyCases.test.ts`,
  and `event-to-reservation.test.ts`.
- Stability: three consecutive full runs and one `--sequence.shuffle` run all
  passed 60 files / 625 tests. No `.skip`, `.only`, `.todo`, or empty assertion
  patterns were found.
- Added `npm run test:perf` for an explicit 11-file / 30-test performance run.
  Performance tests remain included in `npm test` because repeated runs did not
  show instability; the separate command is available for focused benchmarking.
- Coverage scope now includes `src/domain`, `src/application`,
  `src/infrastructure`, and `src/extension`. The expanded V8 report measured
  **51.55% statements**, **72.66% branches**, and **72.79% functions** across
  all included source. No threshold was introduced.
- No new characterization or negative tests were added in this pass: existing
  suites already cover bridge nonce/source/origin/action rejection, network
  host/credential safety, sanitized logging, PII retention, consent/payment
  gates, and parser/form behavior. Adding tests solely to inflate coverage was
  avoided.
- **C6:** `test-chromium-captcha.ts` accepts `CHROME_BIN` (retained),
  `CHROMIUM_PATH`, `CHROME_TEST_PORT`, and `CHROME_DEBUG_PORT`, validates that
  `dist/` exists before launching, and removes its temporary profile in
  `finally` even when CDP/test setup fails. The live Chromium probe was not run
  here because it requires a local Chrome binary and built extension; regular
  build and Vitest validation were run instead.

## 3. Measured before/after

| Metric            |                                   Baseline |                         After completed cleanup groups |
| ----------------- | -----------------------------------------: | -----------------------------------------------------: |
| Test files        |                                         60 |                                                     60 |
| Tests             |                                        625 |                                                    625 |
| TypeScript errors |                            24 pre-existing |                                      0 after `242373d` |
| ESLint errors     |                                          0 |                                                      0 |
| Coverage          | Existing V8 report; no mandatory threshold | 51.55% statements / 72.66% branches / 72.79% functions |

## 4. Documentation/code discrepancies resolved

- Scoped persistence defaults: code is 120 minutes / 1000 attempts, not 30 / 200.
- Hard ceilings: 240 minutes / 5000 attempts.
- Poll default: 2000ms; minimum floor: 1500ms.
- Duration/attempt value `0` is bounded-default fallback, not unlimited.
- Price ceilings use `0` as disabled, matching the existing `> 0` checks.
- Manifest permissions are `storage`, `activeTab`, `alarms`, `scripting`, and
  `notifications`; host permission is `*://*.ticketbox.vn/*` only.
- The historical src/ui alias and localhost host permission are not part of
  the current project.

## 5. Open questions / decisions needed

- Should the current bounded defaults remain 120/1000, or should they be reduced
  to the historical 30/200 values? The cleanup updated documentation to match
  code and did not change behavior.
- Should document numbers 18–23 be renumbered into a single sequence?
- ADR-008 proposes moving state-machine ownership to the service worker, while
  ADR-004 / current code keeps journey ownership in the content script and
  mirrors it to the service worker. No architecture redesign was performed.
- Knip reports `ErrorClassifier` as test-covered but not called by the runtime
  orchestration path. This may be intentional future policy wiring or dead
  integration; it needs an owner decision before removal.
- Several entry points (`popup.ts`, `content.ts`, `page-bridge.ts`) appear unused
  to static analyzers because they are Vite/Manifest entry points. They must not
  be removed based on ts-prune/knip output.

## 6. Validation

Completed repeatedly after each committed group:

```text
npm run typecheck  PASS
npm run lint       PASS
npm test           60 files / 625 tests PASS
npm run build      PASS
```

`npm run docs:check` is the documentation validation command and is included in
`npm run ci`. The final `npm run ci` result is recorded after the last cleanup
group is committed.
