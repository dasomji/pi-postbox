# U5 REPAIR: non-zero `/postbox` opener exit fallback

## changedFiles
- `packages/extension/src/commands/openPostbox.ts`
- `packages/extension/test/openPostbox.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/05-repair.md`

## testsAddedOrUpdated
- `packages/extension/test/openPostbox.test.ts`
  - Added focused regression coverage for a system opener process that starts but exits non-zero.
  - The test asserts `/postbox` still notifies the user with the manual dashboard URL when the opener emits a non-zero `exit`/`close` result.

## commandsRun
1. `npm test -- packages/extension/test/openPostbox.test.ts`
   - Result: failed as expected before the production repair.
   - Summary: 1 focused regression failed because non-zero opener exit did not produce the manual URL notification.
2. `npm test -- packages/extension/test/openPostbox.test.ts`
   - Result: passed after repair.
   - Summary: 1 test file passed; 6/6 `/postbox` tests passed.
3. `npm test -- packages/extension/test/openPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/autostart.test.ts packages/extension/test/status.test.ts`
   - Result: passed.
   - Summary: 4 impacted extension/autostart/status/openPostbox test files passed; 30/30 tests passed.
4. `npx tsc -p packages/extension/tsconfig.json --noEmit`
   - Result: passed.
   - Summary: extension typecheck completed with no output.
5. `git diff --cached --name-only && git status --short`
   - Result: passed.
   - Summary: cached diff output was empty; worktree still contains unstaged/untracked files from this and earlier units.

## validationOutput

Initial focused RED regression:

```text
Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)

FAIL packages/extension/test/openPostbox.test.ts > /postbox browser command > notifies the user with the manual dashboard URL when the OS opener exits non-zero
AssertionError: expected [] to deeply equal ArrayContaining{…}
```

Focused `/postbox` repair run:

```text
Test Files  1 passed (1)
Tests  6 passed (6)
```

Impacted targeted run:

```text
Test Files  4 passed (4)
Tests  30 passed (30)
```

Extension typecheck:

```text
(no output)
```

No staged files check:

```text
git diff --cached --name-only
(no output)
```

## implementationNotes
- `openUrlWithSystemOpener` now listens for opener `exit` and `close` events.
- Non-zero exit/close codes and signal termination reject before the command completes, which reuses the existing `/postbox` warning notification containing the manual dashboard URL.
- Successful opener close still resolves normally.
- No browser-opening tool was added, and no later docs were changed.

## residualRisks
- Real OS opener behavior was not manually exercised; coverage remains at the mocked child-process boundary.
- The worktree contains unrelated pre-existing unstaged/untracked files from previous units; this repair did not classify or modify non-U5 scope.

## noStagedFiles
true
