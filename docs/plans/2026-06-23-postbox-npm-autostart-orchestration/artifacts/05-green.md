# U5 GREEN: user-only `/postbox` browser command

## changedFiles
- `packages/extension/src/commands/openPostbox.ts` (new user command registration and OS-opener helper)
- `packages/extension/src/index.ts` (registers `/postbox` and wires it to the existing mutating recovery/autostart helper path)
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/05-green.md` (this artifact)

## testsAddedOrUpdated
- None in GREEN. RED tests were already added in `packages/extension/test/openPostbox.test.ts`.

## commandsRun
1. `npm test -- packages/extension/test/openPostbox.test.ts`
   - Result: passed.
   - Summary: 1 test file passed; 5/5 `/postbox` command tests passed.
2. `npm test -- packages/extension/test/openPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/autostart.test.ts packages/extension/test/status.test.ts`
   - Result: passed.
   - Summary: 4 test files passed; 29/29 targeted openPostbox/extension/autostart/status tests passed.
3. `npx tsc -p packages/extension/tsconfig.json --noEmit`
   - Result: passed.
   - Summary: extension source typechecked successfully.
4. `git status --short && git diff --name-only && git diff --cached --name-only`
   - Result: passed.
   - Summary: worktree contains pre-existing tracked/untracked changes plus this unit's files; cached diff output was empty.
5. `git diff --cached --name-only`
   - Result: passed.
   - Summary: no output; no staged files.

## validationOutput

Focused `/postbox` run:

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

Full targeted U5 run:

```text
Test Files  4 passed (4)
Tests  29 passed (29)
```

Extension typecheck:

```text
(no output)
```

## implementationNotes
- `/postbox` is registered as a user command only; no browser-opening LLM tool is registered.
- The command ignores its args and opens the URL from the active status snapshot.
- When disconnected, the command calls `ensureRegistrationForMutatingCaller(process.env)`, the same recovery/autostart path used by `ask_postbox`, before reading the dashboard URL.
- Opener failures notify the user with the manual URL.
- Recovery timeout/unavailable state notifies with diagnostics and avoids opening an undefined URL.

## residualRisks
- The OS opener helper intentionally treats immediate spawn errors as failures; later browser/app failures after the opener successfully starts are not observable from this command.
- The worktree includes unrelated pre-existing modified/untracked files from earlier units; this GREEN phase did not stage anything.

## noStagedFiles
true
