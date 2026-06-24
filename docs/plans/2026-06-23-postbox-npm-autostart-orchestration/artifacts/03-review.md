# U3 REVIEW: Package-local server autostart supervisor

## Findings

1. **Severity:** High  
   **Location:** `packages/extension/src/index.ts:109`  
   **Requirement/pattern violated:** U3 contract/R3 says autostart is invoked when `ask_postbox` or `/postbox` needs a server; the implementation plan explicitly resolved that autostart should not happen at Pi startup.  
   **Issue:** `session_start` calls `startRegistration(..., { autostart: true })`, and `startRegistration` immediately calls `ensurePostboxServerAutostarted` when target resolution is unavailable (`packages/extension/src/index.ts:141`). That means merely starting a Pi Session with no reachable Postbox server spawns a reusable background server even if no Postbox Question is sent. The new test `session shutdown does not kill the autostarted child process` also locks in spawn-on-session-start behavior.  
   **Required fix:** Keep session-start registration non-mutating (`autostart: false`/omitted). Move the mutating ensure/spawn/wait path behind `ask_postbox` execution (and the later user-only `/postbox` command), then adjust tests to assert no spawn occurs before an ask needs Postbox.

2. **Severity:** High  
   **Location:** `packages/extension/src/autostart.ts:48`  
   **Requirement/pattern violated:** U3 requires package-local-vs-PATH fallback with clear diagnostics and bounded unavailable behavior when spawn is unavailable.  
   **Issue:** `ensurePostboxServerAutostarted` treats `spawn()` as successful as soon as it returns and only catches synchronous exceptions. Node reports common failures like missing `pi-postbox-server` on PATH via an asynchronous child `error` event, and this code attaches no `error` listener. In the fallback case where the package-local CLI is absent and `pi-postbox-server` is also absent, the extension can get an unhandled child-process error instead of returning unavailable diagnostics. The same cache also uses only `!child.killed` (`packages/extension/src/autostart.ts:43`), so an exited/crashed child can be reported as `already-started` on later attempts.  
   **Required fix:** Attach `error` and `exit` handlers to spawned children, clear the cache when a child fails/exits, and surface a diagnostic that the PATH/package-local spawn failed so `ask_postbox` returns a bounded unavailable result rather than crashing or suppressing retries.

3. **Severity:** High  
   **Location:** `packages/extension/src/client/PostboxClient.ts:495`  
   **Requirement/pattern violated:** R4/CONTEXT: once a Pi Session registers with a fallback local server, it must stay attached to that server until reload/restart rather than migrating mid-session.  
   **Issue:** Active-local registrations still receive a `resolveTarget` hook (`packages/extension/src/index.ts:171`), and `PostboxClient` polls it and calls `retargetNow()` whenever it returns a different selected active-local URL and there is no pinned work (`packages/extension/src/client/PostboxClient.ts:495-517`). U3 only skips recovered configured remotes; it does not prevent migration from one fallback local server instance/URL to another during the same Pi Session.  
   **Required fix:** Disable retarget polling for fallback-local registrations, or constrain it to the originally selected active-local identity/URL so it can reconnect to the same server but never migrate this Pi Session to a different fallback server before reload/restart.

## Validation notes

- Nested Claude reviewer was not attempted per task instruction.
- Scope checked: U3 dossier, RED/GREEN artifacts, requirements R3/R4/R5/R7 in the implementation plan, `packages/extension/src/autostart.ts`, `packages/extension/src/index.ts`, `packages/extension/src/client/PostboxClient.ts`, and U3 tests.
- Targeted tests pass, but they currently do not cover PATH fallback failure, child exit/cache invalidation, or the no-autostart-before-ask boundary.

## commandsRun

- `git status --short && echo '---CACHED---' && git diff --cached --name-only` — passed; inspected worktree and confirmed no staged files before writing this review artifact.
- `git diff --stat && echo '---DIFF---' && git diff -- packages/extension/src/autostart.ts packages/extension/src/index.ts packages/extension/test/autostart.test.ts` — passed; inspected relevant diff/stat.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts` — passed; 3 files / 19 tests.
- `npm run typecheck` — passed.
- `git diff --cached --name-only` — passed; intended final staging check, no staged files expected.
- `git status --short docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/03-review.md && git diff --cached --name-only` — passed; review artifact is untracked and no staged files.

## noStagedFiles

true

## residualRisks

- Review was read-only except for writing this requested artifact; no repair was attempted.
- Full integration with a real installed package/server process was not run; findings are based on code inspection and targeted tests.
