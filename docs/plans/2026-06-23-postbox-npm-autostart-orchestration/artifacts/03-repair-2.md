# U3 REPAIR 2: Ask-time resolution before autostart

## changedFiles

- `packages/extension/src/index.ts`
- `packages/extension/test/autostart.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/03-repair-2.md`

## testsAddedOrUpdated

- `packages/extension/test/autostart.test.ts`
  - Added regression coverage that `ask_postbox` re-checks a recovered preferred server after session-start unavailability and answers without spawning autostart.
  - Added regression coverage that `ask_postbox` re-checks newly available active-local metadata after session-start unavailability and answers without spawning autostart.
  - Adjusted existing fake-timer autostart assertions to wait for the new async ask-time preflight resolution before asserting spawn/timeout behavior.

## commandsRun

- `npm test -- packages/extension/test/autostart.test.ts -t "re-checks"` — expected RED before implementation: failed; preferred ask timed out through autostart wait and active-local ask spawned before using recovered metadata.
- `npm test -- packages/extension/test/autostart.test.ts -t "re-checks"` — passed after implementation and active-local test timestamp adjustment.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/resilience.test.ts` — failed once while existing fake-timer tests still assumed synchronous spawn immediately after `ask_postbox` execution.
- `npm test -- packages/extension/test/autostart.test.ts` — failed once after the fake-timer adjustment because the pre-timeout assertion still counted waitFor's timer advancement.
- `npm test -- packages/extension/test/autostart.test.ts` — passed after final test timing adjustment.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/resilience.test.ts` — passed.
- `npm run typecheck` — passed.
- `git diff -- packages/extension/src/index.ts packages/extension/test/autostart.test.ts && echo '---STATUS---' && git status --short && echo '---CACHED---' && git diff --cached --name-only` — inspected diff/status; no staged files.
- `git status --short && echo '---CACHED---' && git diff --cached --name-only` — final post-artifact staging check; no staged files.

## validationOutput

Initial focused RED:

```text
Test Files  1 failed (1)
Tests  2 failed | 7 skipped (9)
```

Final autostart focused run:

```text
Test Files  1 passed (1)
Tests  9 passed (9)
```

Final targeted extension/resolver/client-related run:

```text
Test Files  6 passed (6)
Tests  49 passed (49)
```

Final typecheck:

```text
> @wienerberliner/pi-postbox@0.1.0 typecheck
> tsc -b
```

Staging check:

```text
---CACHED---
```

## implementationNotes

- `session_start` now retains the active Pi/session registration context so a later mutating `ask_postbox` call can perform one fresh preferred/active-local resolution before autostart.
- The ask-time recovery path registers and uses a fresh healthy preferred or active-local target, stops the no-client active-local supervisor, and returns without spawning autostart.
- Autostart remains the fallback only when that fresh resolution is unavailable.

## residualRisks

- Real installed-package server launch was not run; this repair relies on existing mocked spawn and resolver/client test coverage.
- Worktree contains pre-existing U3/broader plan changes from earlier phases; this repair did not stage files.

## noStagedFiles

true
