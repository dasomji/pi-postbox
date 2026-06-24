# U5 REVIEW: User-only `/postbox` browser command

## Findings

1. **Severity:** Medium  
   **Location:** `packages/extension/src/commands/openPostbox.ts:57`  
   **Requirement/pattern violated:** U5 acceptance requires opener failure to notify the user with the manual dashboard URL.  
   **Issue:** `openUrlWithSystemOpener` only rejects on the child-process `error` event, then resolves on the next microtask (`queueMicrotask(() => settle())`). If the opener executable starts but exits non-zero (for example, `xdg-open` on a headless system with no browser, or `open`/`cmd start` failing after launch), the command has already resolved as successful and `/postbox` will not show the manual URL fallback. The RED/GREEN test covers spawn `error`, but not a non-zero opener exit.  
   **Required fix:** Treat a non-zero opener `exit`/`close` as failure before resolving, and add a focused test that simulates the opener child exiting non-zero and asserts the manual URL notification is shown.

## Validation notes

- Nested Claude reviewer was not attempted per task instruction.
- Scope checked: U5 dossier, RED/GREEN artifacts, R7 in the implementation plan, command-only/no-tool privacy/control, opener failure behavior, recovery/autostart behavior, tests, and U5-relevant source/test changes.
- Targeted U5 tests and extension typecheck pass, but current opener-failure coverage is limited to child-process spawn `error` and does not exercise non-zero opener exit.

## commandsRun

- `pwd && git status --short && ls` — passed; inspected repository state and current worktree.
- Read `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/units/05-postbox-browser-command.md`, `artifacts/05-red.md`, `artifacts/05-green.md`, `CONTEXT.md`, and the U5 implementation/test files — passed; gathered review context.
- `grep -R "R7" docs/...` via tool search — passed; located R7 in `docs/plans/2026-06-23-001-feat-postbox-npm-autostart-plan.md`.
- `git diff -- packages/extension/src/index.ts packages/extension/src/commands/openPostbox.ts packages/extension/test/openPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/src/autostart.ts packages/extension/src/status.ts` — passed; inspected relevant diff and noted untracked U5 files require direct reads.
- `git diff --stat && git diff --cached --name-only && npm test -- packages/extension/test/openPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/autostart.test.ts packages/extension/test/status.test.ts` — passed; 4 test files / 29 tests passed, cached diff empty.
- `git status --short && git diff --cached --name-only` — passed; inspected worktree and confirmed no staged files before artifact write.
- `npx tsc -p packages/extension/tsconfig.json --noEmit` — passed; extension typecheck produced no output.
- `nl -ba packages/extension/src/commands/openPostbox.ts | sed -n '1,120p'` — passed; captured line numbers for finding.
- `grep "open_postbox|browser|dashboard" packages/extension/src` via tool search — passed; confirmed no `open_postbox` tool registration was present in source search results.

## noStagedFiles

true

## residualRisks

- Review was read-only except for writing this requested review artifact; no repair was attempted.
- Full real-browser/manual OS opener behavior was not run; opener finding is based on code inspection plus targeted tests that currently mock only spawn boundaries.
- Worktree contains unrelated pre-existing tracked/untracked changes from prior units; this review did not attempt to classify or repair non-U5 scope.
