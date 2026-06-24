# U3 REREVIEW: Repair verification

## Findings

1. **Severity:** Medium  
   **Location:** `packages/extension/src/index.ts:288`  
   **Requirement/pattern violated:** U3 contract/R3 says autostart starts a reusable local server only when `ask_postbox` needs one and no preferred or active local server is reachable; the U3 acceptance criteria also require existing active-local servers to be reused without spawning another process.  
   **Issue:** The repaired `ask_postbox` path calls `ensurePostboxServerAutostarted` immediately whenever `client`/`currentRegistration` is absent (`packages/extension/src/index.ts:288-306`). It does not first retry `resolveActiveLocalTarget`/registration at ask time. If the preferred server recovers after `session_start`, or active-local metadata appears before the no-client supervisor's next tick, the ask still spawns an autostart child before using the already-reachable target. The no-client supervisor only registers active-local targets and explicitly stops without registering recovered non-local targets (`packages/extension/src/index.ts:238-240`), so a recovered preferred server is skipped in favor of local autostart.  
   **Required fix:** In the mutating ask recovery path, retry preferred/active target resolution and register a selected target before calling `ensurePostboxServerAutostarted`; only spawn when that fresh resolution is unavailable. Add regression coverage for an ask after session-start unavailability where active-local metadata or the preferred server becomes healthy before autostart.

## Accepted review findings verification

- No autostart on `session_start`: fixed for process spawning. `session_start` now calls non-mutating `startRegistration` (`packages/extension/src/index.ts:104-109`), and the repaired autostart tests assert no `spawn` before `ask_postbox` (`packages/extension/test/autostart.test.ts:155-162`, `packages/extension/test/autostart.test.ts:276-283`).
- Async spawn/PATH fallback errors: fixed for bounded unavailable behavior. `ensurePostboxServerAutostarted` attaches `error`/`exit` handlers, clears cached children, and records diagnostics (`packages/extension/src/autostart.ts:71-85`, `packages/extension/src/autostart.ts:122-130`); tests cover PATH fallback `ENOENT` retry and unavailable diagnostics (`packages/extension/test/autostart.test.ts:295-324`).
- No retarget to a different local server mid-session: fixed for active-local polling. The resolver hook skips configured remote recovery and returns `session-sticky-target-mismatch` unless the selected local target matches the original URL/source/identity (`packages/extension/src/index.ts:256-285`); tests cover replacement active-local metadata and recovered remote non-migration (`packages/extension/test/extension.test.ts:273-364`).

## Validation notes

- Nested Claude reviewer was not attempted per task instruction.
- Scope checked: U3 dossier, `03-red.md`, `03-green.md`, `03-review.md`, `03-repair.md`, implementation plan R3/R4/R5, current diff/source for `packages/extension/src/autostart.ts`, `packages/extension/src/index.ts`, `packages/extension/src/client/PostboxClient.ts`, and U3-related tests.
- Targeted tests and typecheck pass, but the finding above is a missing/reordered recovery step not covered by current tests.

## commandsRun

- `git status --short && echo '---CACHED---' && git diff --cached --name-only && echo '---STAT---' && git diff --stat` — passed; inspected worktree/diff status and confirmed no staged files at start of rereview.
- `git diff -- packages/extension/src/index.ts packages/extension/src/autostart.ts packages/extension/test/autostart.test.ts packages/extension/test/extension.test.ts | sed -n '1,260p'` — passed; inspected relevant diff.
- `git diff -- packages/extension/src/index.ts packages/extension/src/autostart.ts packages/extension/test/autostart.test.ts packages/extension/test/extension.test.ts | sed -n '260,560p'` — passed; inspected relevant diff continuation.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/activeLocalTargetResolver.test.ts` — passed; 6 files / 47 tests.
- `npm run typecheck` — passed.
- `nl -ba packages/extension/src/index.ts | sed -n '96,340p' && echo '--- autostart ---' && nl -ba packages/extension/src/autostart.ts | sed -n '1,150p' && echo '--- tests relevant ---' && nl -ba packages/extension/test/autostart.test.ts | sed -n '115,330p' && echo '--- extension stickiness tests ---' && nl -ba packages/extension/test/extension.test.ts | sed -n '240,370p'` — passed; captured line-number evidence.
- `nl -ba packages/extension/src/index.ts | sed -n '336,352p' && git status --short && echo '---CACHED---' && git diff --cached --name-only` — passed; captured line-number evidence and confirmed no staged files before writing this artifact.

## residualRisks

- No real installed-package `pi-postbox-server` launch was run; spawn and health behavior were reviewed through code inspection and existing mocked tests.
- Current tests do not cover ask-time re-resolution before spawning, which is the remaining finding.

## noStagedFiles

true
