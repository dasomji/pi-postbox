# U6 GREEN: documentation, ADR alignment, and smoke coverage

## changedFiles
- `README.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/protocol.md`
- `docs/adr/0003-combined-npm-package-and-package-local-autostart.md`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/06-green.md`

## testsAddedOrUpdated
- None in GREEN. Existing RED assertions in `packages/server/test/packageDocs.test.ts` now pass.

## commandsRun
- `npm test -- packages/server/test/packageDocs.test.ts`
  - Result: passed.
  - Summary: 1 test file passed; 13 tests passed.
- `npm run smoke`
  - Result: passed.
  - Summary: packaged-path smoke verified health, UI shell, fake extension registration, SSE, answer, state, and history.
- `git diff -- README.md docs/configuration.md docs/deployment.md docs/protocol.md docs/adr/0003-combined-npm-package-and-package-local-autostart.md && echo '---STATUS---' && git status --short && echo '---CACHED---' && git diff --cached --name-only`
  - Result: passed.
  - Summary: inspected U6 docs diff and worktree; cached diff output was empty.
- `git diff --cached --name-only && echo '---STATUS---' && git status --short`
  - Result: passed.
  - Summary: final staging check after writing this artifact; no staged files.

## validationOutput
Targeted package/docs validation:

```text
Test Files  1 passed (1)
Tests  13 passed (13)
```

Smoke validation:

```text
Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.
```

Staging check:

```text
---CACHED---
```

## implementationNotes
- Updated install guidance to distinguish `pi install npm:@wienerberliner/pi-postbox` for Pi resources plus bundled/package-local autostart from `npm install -g @wienerberliner/pi-postbox` for manual shell `pi-postbox-server` usage.
- Removed stale split-package user guidance for `pi install npm:@pi-postbox/extension` and `npx @pi-postbox/server` from deployment docs.
- Documented autostart default-on behavior, `PI_POSTBOX_AUTOSTART=off`, `PI_POSTBOX_AUTOSTART_TIMEOUT_MS`, default 10 second/10000ms wait, preferred-server fallback semantics, and fallback/autostart session stickiness until reload/restart.
- Documented `/postbox-status`, read-only `postbox_status`, exact `/postbox` browser-opening command, and the privacy/browser-opening boundary that browser opening is user-only/manual and not an LLM/tool side effect.

## residualRisks
- The worktree contains pre-existing U1-U5/planning changes and untracked files outside this GREEN pass; I did not stage or alter them beyond the listed docs/artifact files.
- `npm run smoke` uses the already-built packaged path; this phase did not run a full `npm run build` or full `npm test`.

## noStagedFiles
true
