# U2 REREVIEW: Preserve fallback active-local affinity

## Findings

No blocking or actionable findings.

## Validation notes

- Scope checked: U2 dossier, RED/GREEN/REVIEW/REPAIR artifacts, current U2 diff in `activeLocalTargetResolver.ts`, `index.ts`, resolver/extension tests, and targeted resolver/extension/resilience validation.
- Accepted mid-session migration finding is fixed: `registerResolvedTarget` now passes `skipConfiguredRemote: true` to active-local polling resolvers, and the repair test proves a fallback active-local client does not probe or retarget to a recovered configured remote.
- Nested Claude reviewer was not attempted per task instruction.

## commandsRun

- `git status --short && echo '---STAT---' && git diff --stat && echo '---CACHED---' && git diff --cached --name-only` — passed; inspected worktree/diff summary and confirmed no staged files.
- `git diff -- packages/extension/src/activeLocalTargetResolver.ts packages/extension/src/index.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts` — passed; inspected current U2 diff.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts` — passed; 3 files, 28 tests.
- `nl -ba packages/extension/src/index.ts | sed -n '145,165p' && echo '--- resolver ---' && nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '25,80p' && echo '--- repair test ---' && nl -ba packages/extension/test/extension.test.ts | sed -n '270,325p' && echo '--- staged ---' && git diff --cached --name-only` — passed; gathered line-numbered evidence and confirmed cached diff empty.
- `git status --short docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/02-rereview.md packages/extension/src/activeLocalTargetResolver.ts packages/extension/src/index.ts packages/extension/test/extension.test.ts && echo '---CACHED---' && git diff --cached --name-only` — passed before writing this artifact; confirmed no staged files.

## noStagedFiles

true
