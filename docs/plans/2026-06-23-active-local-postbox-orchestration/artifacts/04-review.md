## Findings

1. **Severity:** High  
   **Location:** `packages/extension/src/activeLocalTargetResolver.ts:253`  
   **Requirement/pattern violated:** Explicit non-loopback configured URLs must remain authoritative and local recovery must only treat true loopback candidates as recoverable.  
   **Issue:** `isLoopbackHostname()` accepts any hostname starting with `127.`. A configured URL such as `http://127.evil.example:32187/` is therefore misclassified as a recoverable loopback URL, so fresh local metadata can replace it instead of preserving the explicit non-loopback target. This also allows configured-loopback fallback health probes to target arbitrary DNS names beginning with `127.`.  
   **Required fix:** Validate configured loopback hosts with the same strict numeric loopback rules as metadata (or an explicit loopback-only DNS resolution path for `localhost`); do not use prefix matching for hostnames. Treat `127.*` DNS names that are not valid IPv4 loopback literals as explicit non-loopback or invalid configured targets, not recoverable local targets.

2. **Severity:** High  
   **Location:** `packages/extension/src/index.ts:99`  
   **Requirement/pattern violated:** No-client startup recovery: if no configured URL and no active metadata exists at session start, an extension-level local supervisor should keep checking and create/register a client when metadata later appears; live retargeting remains Unit 05.  
   **Issue:** `startRegistration()` resolves once, sets `Postbox unavailable`, and returns when the target is unavailable. There is no extension-level retry/supervisor timer in `index.ts` (only existing lifecycle/client timers elsewhere), so a session started before metadata exists will never auto-register when a local server publishes metadata later.  
   **Required fix:** Add a narrowly scoped no-client active-local supervisor for eligible local cases only, with bounded polling/backoff and cleanup on session shutdown/deactivation. It should create/register a `PostboxClient` once a target appears and should not retarget an already-connected client. Add fake-timer/startup recovery coverage.

## Claude reviewer

- Result: Claude reviewer unavailable/skipped to avoid known hang from prior runs 906de82d/c5237741, per task allowance. No nested Claude command was run.

## Validation notes

- Commands run, read-only unless noted for artifact creation:
  - `git status --short && printf '\n--- DIFF STAT ---\n' && git diff --stat && printf '\n--- TARGET DIFF ---\n' && git diff -- packages/extension/src/activeLocalTargetResolver.ts packages/extension/src/index.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/src/config.ts packages/extension/src/tools/askPostbox.ts packages/protocol/src/activeLocal.ts packages/protocol/src/health.ts`
  - `nl -ba packages/extension/src/index.ts | sed -n '85,130p' && printf '\n--- resolver selected lines ---\n' && nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '1,240p'`
  - `nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '236,275p' && grep -R "supervisor\|setInterval\|setTimeout\|activeLocalPollingEnabled" -n packages/extension/src packages/extension/test | sed -n '1,120p'`
  - `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts` — passed, 3 files / 15 tests.
  - `npm run typecheck -w @pi-postbox/extension` — passed.
  - `node -e 'const u=new URL("http://127.evil.example:32187/"); console.log(u.hostname, u.hostname.toLowerCase().startsWith("127."), u.toString())'` — showed the current prefix check would classify `127.evil.example` as loopback-like.
  - `if [ -z "$(git diff --cached --name-only)" ]; then echo "no staged files"; else git diff --cached --name-only; fi` — no staged files.
- Scope checked: Unit 04 dossier, RED/GREEN artifacts, parent U4 plan, resolver/startup/tests, protocol health/active-local helpers, diagnostics and startup recovery behavior.

## commandsRun

```text
git status --short && printf '\n--- DIFF STAT ---\n' && git diff --stat && printf '\n--- TARGET DIFF ---\n' && git diff -- packages/extension/src/activeLocalTargetResolver.ts packages/extension/src/index.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/src/config.ts packages/extension/src/tools/askPostbox.ts packages/protocol/src/activeLocal.ts packages/protocol/src/health.ts
nl -ba packages/extension/src/index.ts | sed -n '85,130p' && printf '\n--- resolver selected lines ---\n' && nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '1,240p'
nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '236,275p' && grep -R "supervisor\|setInterval\|setTimeout\|activeLocalPollingEnabled" -n packages/extension/src packages/extension/test | sed -n '1,120p'
npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts
npm run typecheck -w @pi-postbox/extension
node -e 'const u=new URL("http://127.evil.example:32187/"); console.log(u.hostname, u.hostname.toLowerCase().startsWith("127."), u.toString())'
if [ -z "$(git diff --cached --name-only)" ]; then echo "no staged files"; else git diff --cached --name-only; fi
```

## noFileEdits

Implementation and test files were not edited by this reviewer. The review artifact `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/04-review.md` was written as requested.
