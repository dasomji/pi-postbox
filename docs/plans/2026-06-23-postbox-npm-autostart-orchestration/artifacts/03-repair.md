# U3 REPAIR: Accepted review findings

## changedFiles

- `packages/extension/src/autostart.ts`
- `packages/extension/src/index.ts`
- `packages/extension/test/autostart.test.ts`
- `packages/extension/test/extension.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/03-repair.md`

## testsAddedOrUpdated

- `packages/extension/test/autostart.test.ts`
  - Updated the main autostart ask test to assert `session_start` reaches unavailable state without spawning; spawn now happens only after `ask_postbox` executes.
  - Updated shutdown coverage to use an ask-triggered autostart child and still assert shutdown does not kill it.
  - Added PATH fallback async spawn-error coverage: package-local CLI absent, `pi-postbox-server` spawn emits `error`, ask returns unavailable diagnostics, and a second ask retries instead of treating the failed child as already started.
- `packages/extension/test/extension.test.ts`
  - Added fallback active-local stickiness regression: after registering to one active-local target, metadata changing to another local target returns a sticky-target mismatch instead of allowing this session to retarget.

## commandsRun

- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/activeLocalTargetResolver.test.ts` — failed once during repair before tightening the PATH fallback async-error timing; final run passed.
- `npm test -- packages/extension/test/autostart.test.ts -t "PATH fallback"` — passed while isolating the PATH fallback regression.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/activeLocalTargetResolver.test.ts && npm run typecheck` — passed.
- `npm run typecheck` — passed in an earlier standalone run, and passed again in the combined final validation.
- `git status --short && echo '---CACHED---' && git diff --cached --name-only` — inspected worktree/staging; no staged files.

## validationOutput

Final targeted tests:

```text
Test Files  6 passed (6)
Tests  47 passed (47)
```

Final typecheck:

```text
> @wienerberliner/pi-postbox@0.1.0 typecheck
> tsc -b
```

Final staging check:

```text
---CACHED---
```

## implementationNotes

- Removed session-start autostart by keeping `session_start` registration non-mutating; `ask_postbox` now calls the autostart supervisor path only when no client/registration is available.
- Attached `error` and `exit` handlers to autostarted children, clear the cached child on failure/exit, remember diagnostics, and expose the async failure to the waiting ask so unavailable results are bounded and diagnostic.
- Constrained extension-provided active-local retarget resolver to the originally selected local target identity/URL, preventing fallback active-local sessions from migrating to a different local server mid-session.

## residualRisks

- Real end-to-end launch of an installed `pi-postbox-server` binary was not run; coverage uses mocked `spawn` and active-local metadata/health probes.
- Worktree contains pre-existing/untracked U3 and broader plan changes outside this repair; no files were staged.

## noStagedFiles

true
