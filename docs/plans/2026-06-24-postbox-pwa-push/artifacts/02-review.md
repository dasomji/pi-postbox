## Findings

1. **Severity:** Medium  
   **Location:** `packages/protocol/src/push.ts:18`  
   **Requirement/pattern violated:** Security/least-privilege review for server-side push fanout: persisted subscription endpoints become outbound server requests from `PushNotifier` (`packages/server/src/services/pushNotifier.ts:21-32`).  
   **Issue:** `PushSubscriptionPayloadSchema` accepts any syntactically valid URL for `endpoint`, then Unit 02 sends notifications to every persisted endpoint. A client that can reach the no-auth Postbox server can register non-Web-Push endpoints such as loopback/private/internal HTTPS URLs and cause the server to POST to them on the next ask. The plan allows the existing Tailnet/no-auth trust model, but it does not require accepting arbitrary outbound destinations as push subscriptions.  
   **Required fix:** Tighten subscription endpoint validation before persistence/sending, at minimum to `https:` Web Push endpoints and reject localhost/private/link-local literal hosts; add a regression test that malformed/non-Web-Push endpoints are rejected.

## Claude reviewer

- Result: Claude reviewer unavailable/skipped because this task explicitly requested skipping nested Claude due prior hangs. No `claude -p` command was run.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --stat && git diff --name-only` — inspected worktree and tracked diff summary.
  - `git diff -- packages/protocol/src/index.ts packages/server/src/app.ts packages/server/src/db/database.ts packages/server/src/ws/extensionSocket.ts package.json packages/server/package.json` — inspected tracked implementation diff.
  - `nl -ba packages/protocol/src/push.ts | sed -n '1,80p'` — captured line numbers for endpoint validation.
  - `nl -ba packages/server/src/services/pushNotifier.ts | sed -n '1,120p'` — captured line numbers for outbound send fanout.
  - `npm run typecheck && npx vitest run packages/server/test/pushRoutes.test.ts packages/server/test/pushNotifications.test.ts packages/protocol/src/push.test.ts && git diff --cached --quiet && echo no staged files` — passed; typecheck, 3 Vitest files / 9 tests, no staged files.
  - `git status --short && printf '\n-- unstaged diff stat --\n' && git diff --stat && printf '\n-- untracked review-relevant files --\n' && find packages/server/src/routes packages/server/src/services packages/server/test packages/protocol/src docs/plans/2026-06-24-postbox-pwa-push -path '*/node_modules' -prune -o \( -name '*push*' -o -path 'docs/plans/2026-06-24-postbox-pwa-push/*' \) -type f -print | sort` — inspected full status including untracked plan/test/source files.
- Scope checked: Unit 02 requirements, plan/index privacy decisions, RED/GREEN artifacts, push protocol/schema, push routes/store/notifier, websocket ask.create hook, relevant tests, tracked diff/stat, and no-staged-files state.
