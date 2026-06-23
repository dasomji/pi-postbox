# Unit 05 REVIEW — Live client retargeting with target affinity

## Findings

1. **Severity:** High  
   **Location:** `packages/extension/src/client/PostboxClient.ts:515`  
   **Requirement/pattern violated:** Unit 05 requires local fallback answer/cancel resolutions to stay origin-pinned, but all pinned work must have a bounded client-owned deadline so a permanently dead origin cannot block convergence forever (`docs/plans/2026-06-23-active-local-postbox-orchestration/units/05-live-client-retargeting.md:18-19`).  
   **Issue:** `deferTargetSwitch()` starts target-affinity timers only for unresolved sent asks via `startTargetAffinityTimersForPinnedWork()`. That helper iterates `pendingAsks` only (`PostboxClient.ts:564-568`), while local fallback resolutions are stored separately in `localResolutions` (`PostboxClient.ts:396-400`) and are considered blocking in `hasPinnedWorkBlocking()` (`PostboxClient.ts:546-552`). If a user answers/cancels locally while the origin socket is offline and the origin never comes back, the `localResolutions` entry has no deadline/release path, so every active-local switch remains deferred indefinitely.  
   **Required fix:** Add bounded timeout/release handling for origin-pinned `localResolutions` (and cleanup on flush/stop), or otherwise clear/report undeliverable after the configured affinity deadline so retargeting can proceed.

## Claude reviewer

- Result: Claude reviewer unavailable/skipped to avoid known hang from prior runs 906de82d/c5237741, per task instruction allowing skip instead of spending more than 8 seconds on nested Claude.

## Validation notes

- Scope checked: Unit 05 dossier, RED/GREEN artifacts, parent U5 plan, relevant source diffs/tests for `PostboxClient`, `index`, resilience/localFallback/extension coverage, active-local resolver shape as needed.
- Existing targeted tests pass, but they do not cover the permanently-dead-origin path after a local fallback answer/cancel has already moved the work from `pendingAsks` into `localResolutions`.
- No implementation, source, or test files were edited by this review. This review artifact was written as requested.

## commandsRun

- `git status --short && printf '\n-- staged --\n' && git diff --cached --name-only && printf '\n-- diff stat --\n' && git diff --stat -- packages/extension/src/client/PostboxClient.ts packages/extension/src/index.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts` — passed; showed relevant diff stat and no staged files.
- `git diff -- packages/extension/src/client/PostboxClient.ts packages/extension/src/index.ts` — passed; inspected implementation diff.
- `git diff -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts` — passed; inspected test diff.
- `npm test -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts && npm run typecheck -w @pi-postbox/extension && git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — passed; 3 test files / 24 tests passed, extension typecheck passed, no staged files.
- `npm test -- packages/extension/test` — passed; 7 test files / 43 tests passed.
- `nl -ba docs/plans/2026-06-23-active-local-postbox-orchestration/units/05-live-client-retargeting.md | sed -n '1,80p'` — passed; confirmed Unit 05 local-resolution pin/deadline requirements.
- `nl -ba packages/extension/src/client/PostboxClient.ts | sed -n '390,560p'` and `nl -ba packages/extension/src/client/PostboxClient.ts | sed -n '556,620p'` — passed; confirmed local resolutions block switches but have no affinity timer/release path.
- Nested Claude: skipped by instruction; no `claude -p` command run.

## noFileEdits

No implementation, source, or test files were edited. Review artifact only: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/05-review.md`.
