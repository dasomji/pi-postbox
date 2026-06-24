# U2 REVIEW: Health-verified preferred server resolution

## Findings

1. **Severity:** High  
   **Location:** `packages/extension/src/index.ts:155`  
   **Requirement/pattern violated:** R4 / U2 non-goal: “If a Pi Session registers with fallback local server, it must remain attached to that server until reload/restart rather than migrating mid-session”; dossier also requires no live migration for an already-registered client/session.  
   **Issue:** When the preferred remote is initially unhealthy, `resolveActiveLocalTarget` can select healthy active-local metadata. Because that target has `activeLocalPollingEnabled: true`, `registerResolvedTarget` still installs a `resolveTarget` hook (`index.ts:155-158`). That hook calls the same resolver, whose first step is now to health-check and select a configured non-loopback URL when it becomes healthy (`activeLocalTargetResolver.ts:57-70`). `PostboxClient` applies any selected URL returned by that hook via `retargetNow` (`PostboxClient.ts:495-517`). This means a session registered to an active-local fallback can migrate back to the preferred remote during the same session once the remote recovers, which is exactly the R4 behavior U2 says not to introduce.  
   **Required fix:** Preserve origin affinity for clients created from fallback resolution. For example, when registration falls back from a configured remote to active-local/autostart, pass a resolver that only considers active-local successors, or disable active-local polling for that fallback client until reload/restart. Add an extension/client test that starts with unreachable configured remote + healthy active-local, then makes the remote healthy and proves the existing client does not retarget to the remote.

## Validation notes

- Nested Claude reviewer skipped per task instruction: known flaky/timeout.
- Scope checked: U2 dossier, RED/GREEN artifacts, R3/R4 plan requirements, resolver selection order and diagnostics, extension registration wiring, PostboxClient retarget semantics, and targeted resolver/extension tests.
- Tests pass for the existing test suite, but coverage does not exercise R4 fallback-origin affinity after a configured remote recovers.

## commandsRun

- `git status --short && echo '---STAT---' && git diff --stat && echo '---CACHED---' && git diff --cached --name-only` — passed; inspected modified/untracked files and confirmed no staged files at review start.
- `git diff -- packages/extension/src/activeLocalTargetResolver.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts` — passed; inspected U2 implementation/test diff.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts` — passed; 2 files, 19 tests.
- `nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '45,125p;330,390p' && echo '--- tests lines ---' && nl -ba packages/extension/test/activeLocalTargetResolver.test.ts | sed -n '20,125p' && echo '--- ext lines ---' && nl -ba packages/extension/test/extension.test.ts | sed -n '215,295p'` — passed; gathered line-numbered resolver/test evidence.
- `nl -ba packages/extension/src/index.ts | sed -n '130,155p'` — passed; gathered line-numbered registration evidence.
- `nl -ba packages/extension/src/index.ts | sed -n '152,170p' && nl -ba packages/extension/src/client/PostboxClient.ts | sed -n '482,535p'` — passed; gathered line-numbered retarget evidence.
- `git status --short docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/02-review.md && git diff --cached --name-only` — passed; review artifact is unstaged/untracked and no staged files.

## noStagedFiles

true
