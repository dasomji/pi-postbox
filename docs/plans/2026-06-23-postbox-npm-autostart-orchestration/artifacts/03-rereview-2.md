# U3 REREVIEW 2: Repair-2 verification

## Findings

No blocking or actionable findings.

## Previous finding verification

- Ask-time resolution before autostart is fixed. `ask_postbox` now calls `ensureRegistrationForMutatingCaller`, which first invokes `retryRegistrationForMutatingCaller` and performs a fresh `resolveActiveLocalTarget` before any autostart spawn (`packages/extension/src/index.ts:93-96`, `packages/extension/src/index.ts:300-337`).
- A recovered preferred server is now registered and used without spawning autostart, covered by `packages/extension/test/autostart.test.ts:201-236`.
- Newly available active-local metadata is now registered and used without spawning autostart, covered by `packages/extension/test/autostart.test.ts:238-267`.
- The original U3 autostart fallback path remains covered: no spawn on session start, spawn on ask only when fresh resolution is unavailable, bounded timeout, opt-out diagnostics, PATH fallback async error retry, active-local reuse, and shutdown not killing the child.

## Validation notes

- Nested Claude reviewer was not attempted per task instruction.
- Scope checked: U3 dossier, `03-red.md`, `03-green.md`, `03-review.md`, `03-repair.md`, `03-rereview.md`, `03-repair-2.md`, current source/diff for `packages/extension/src/index.ts`, `packages/extension/src/autostart.ts`, `packages/extension/src/activeLocalTargetResolver.ts`, `packages/extension/src/client/PostboxClient.ts`, and U3-related tests.
- Targeted U3/resolver/client tests and typecheck pass.

## commandsRun

- `git status --short && echo '---CACHED---' && git diff --cached --name-only && echo '---STAT---' && git diff --stat` — passed; inspected worktree/diff status and confirmed no staged files at start of rereview.
- `nl -ba packages/extension/src/index.ts | sed -n '1,380p'; ...` — passed; inspected line-numbered U3 source and tests.
- `nl -ba packages/extension/src/index.ts | sed -n '380,620p'; ...; git diff -- packages/extension/src/index.ts packages/extension/test/autostart.test.ts | sed -n '1,260p'` — passed; inspected wait logic, test helpers, and relevant diff.
- `nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '1,280p'; nl -ba packages/extension/src/client/PostboxClient.ts | sed -n '430,540p'` — passed; checked resolver and retarget behavior relevant to previous review findings.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/resilience.test.ts` — passed; 6 files / 49 tests.
- `npm run typecheck` — passed.
- `git status --short && echo '---CACHED---' && git diff --cached --name-only` — passed; confirmed no staged files before writing this artifact.

## residualRisks

- No real installed-package `pi-postbox-server` launch was run; validation relies on code inspection plus mocked spawn/resolver/client coverage.
- Review was read-only except for writing this requested rereview artifact.

## noStagedFiles

true
