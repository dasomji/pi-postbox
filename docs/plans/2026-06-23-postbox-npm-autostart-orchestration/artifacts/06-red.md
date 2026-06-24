# U6 RED: documentation, ADR alignment, and smoke/package coverage

## changedFiles
- `packages/server/test/packageDocs.test.ts`
  - Added focused U6 documentation/package assertions to the existing public release/package docs test surface.
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/06-red.md`
  - RED evidence artifact.

## testsAddedOrUpdated
- `release packaging and operator docs > documents the combined package install shape without stale split-package guidance`
  - Asserts docs mention both public install commands:
    - `pi install npm:@wienerberliner/pi-postbox`
    - `npm install -g @wienerberliner/pi-postbox`
  - Asserts Pi install docs say the public package installs Pi resources plus bundled/package-local autostart support.
  - Asserts manual shell CLI docs keep the global npm install distinct from Pi install.
  - Asserts docs no longer point users at stale split-package install guidance (`pi install npm:@pi-postbox/extension`, `npx @pi-postbox/server`).
- `release packaging and operator docs > documents autostart controls, default timeout, and preferred-server fallback stickiness`
  - Asserts docs mention `PI_POSTBOX_AUTOSTART=off`.
  - Asserts docs mention `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` and state the default autostart wait is 10 seconds / 10000ms.
  - Asserts docs describe configured Postbox URL as a preferred server that can fall back to package-local autostart when unreachable.
  - Asserts docs describe fallback/autostart session stickiness until reload/restart.
  - Asserts docs do not retain old absolute-authority wording that contradicts preferred-server fallback semantics.
- `release packaging and operator docs > documents status surfaces, /postbox browser opening, and privacy boundaries`
  - Asserts docs mention `/postbox-status`.
  - Asserts docs mention the read-only `postbox_status` tool and its privacy-preserving/no-question-dump boundary.
  - Asserts docs mention the exact user command `/postbox`.
  - Asserts docs describe `/postbox` as opening the dashboard/browser for the user.
  - Asserts docs state browser-opening is user-only/manual and not exposed as an LLM/tool side effect.

## commandsRun
- `npm test -- packages/server/test/packageDocs.test.ts`
  - Result: failed as expected (RED).
  - Summary: 1 test file failed; 3 tests failed and 10 passed.
- `git diff --cached --name-only`
  - Result: passed.
  - Summary: no staged files.
- `git status --short`
  - Result: passed.
  - Summary: working tree has existing uncommitted U1-U5/planning changes plus this RED test/artifact; nothing staged.

## validationOutput
Targeted Vitest RED output summary from `/tmp/pi-bash-f3d10452e3cdcbbf.log`:

```text
FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents the combined package install shape without stale split-package guidance
AssertionError: Pi package install docs should say the public package installs Pi resources plus bundled/package-local autostart support
AssertionError: docs should no longer point users at the old internal extension package: expected docs not to contain 'pi install npm:@pi-postbox/extension'
AssertionError: docs should no longer point users at the old internal server package: expected docs not to contain 'npx @pi-postbox/server'

FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents autostart controls, default timeout, and preferred-server fallback stickiness
AssertionError: expected docs to contain 'PI_POSTBOX_AUTOSTART=off'
AssertionError: expected docs to contain 'PI_POSTBOX_AUTOSTART_TIMEOUT_MS'
AssertionError: operator docs should state the default autostart wait is 10 seconds/10000ms
AssertionError: old absolute-authority wording contradicts the preferred-server fallback contract

FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents status surfaces, /postbox browser opening, and privacy boundaries
AssertionError: expected docs to contain 'postbox_status'
AssertionError: postbox_status should be documented as read-only/privacy-preserving status, not a question dump
AssertionError: operator docs should document the exact user-only /postbox command
AssertionError: /postbox should be described as opening the dashboard/browser for the user
AssertionError: docs should state browser-opening is user-only/manual and not exposed as an LLM/tool side effect

Test Files 1 failed (1)
Tests 3 failed | 10 passed (13)
```

Why this is the intended RED:
- The failures are documentation/package-alignment gaps, not production/runtime failures.
- Existing package metadata/tarball/global-install/smoke-isolation assertions still passed in the same targeted run.
- Failures directly correspond to U6 acceptance: public combined install docs, autostart env/default docs, preferred-server fallback/session stickiness, `/postbox-status`, `postbox_status`, `/postbox`, privacy/browser-opening boundaries, and stale split-package guidance removal.

## residualRisks
- I did not run `npm run smoke`; this RED phase only added docs/package assertions and ran the targeted package docs test.
- `packages/server/test/packageDocs.test.ts` already contained prior U1-U5 modifications before this RED phase; this phase only added the three U6 docs/alignment tests above.
- The `/postbox` assertions intentionally require an exact command token so `~/.pi-postbox/postbox.sqlite` or `/postbox-status` cannot satisfy the browser-command contract accidentally.

## noStagedFiles
true
