# U2 GREEN: Health-verified preferred server resolution

## changedFiles

- `packages/extension/src/activeLocalTargetResolver.ts`
- `packages/extension/test/extension.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/02-green.md`

## testsAddedOrUpdated

- Updated `packages/extension/test/extension.test.ts` to keep extension registration expectations aligned with health-verified explicit remotes and deterministic active-local metadata time.
- RED tests in `packages/extension/test/activeLocalTargetResolver.test.ts` were left intact.

## commandsRun

- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts` — failed before implementation with the expected U2 RED failures.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts` — passed after resolver implementation: 1 file, 10 tests.
- `npm test -- packages/extension/test/extension.test.ts` — failed after resolver implementation because extension tests still expected unverified explicit remotes and two active-local tests used stale wall-clock metadata.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts` — passed after extension test alignment: 2 files, 19 tests.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts` — passed final targeted validation: 1 file, 10 tests.
- `git diff --cached --name-only` — no output.

## validationOutput

Final targeted resolver validation:

```text
Test Files  1 passed (1)
Tests  10 passed (10)
```

Directly impacted extension validation:

```text
Test Files  2 passed (2)
Tests  19 passed (19)
```

## residualRisks

- No known residual U2 risk. Explicit non-loopback configured remotes are now preferred only after `/healthz` verifies successfully; failed remotes emit an `explicit-remote` diagnostic and allow active-local fallback.
- Autostart, status command, and browser behavior were intentionally not implemented in this unit.

## noStagedFiles

true
