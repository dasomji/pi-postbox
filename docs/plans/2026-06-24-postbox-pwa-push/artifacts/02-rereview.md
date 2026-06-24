## Findings

1. **Severity:** Medium  
   **Location:** `packages/protocol/src/push.ts:29`  
   **Requirement/pattern violated:** Prior SSRF repair requirement to accept only HTTPS Web Push endpoints with public hosts and reject localhost/private/local literal destinations before `PushNotifier` fans out outbound server requests.  
   **Issue:** The hostname normalization only lowercases and strips IPv6 brackets, so loopback localhost names with a trailing absolute-DNS dot still pass validation. Evidence: `PushSubscriptionPayloadSchema.safeParse(...)` rejects `https://localhost/push` but accepts both `https://localhost./push` and `https://foo.localhost./push`; those endpoints can then be persisted by `packages/server/src/routes/pushRoutes.ts:12-16` and later sent by `packages/server/src/services/pushNotifier.ts:24-32`. The same check also accepts non-public IPv6 literals such as `https://[::]/push` and IPv4-compatible private literals like `https://[::192.168.1.5]/push`, which undercuts the schema error message's "public host" guarantee.  
   **Required fix:** Canonicalize hostnames by removing a single trailing dot before localhost/private checks, reject `localhost`/`.localhost` after that canonicalization, and add regression coverage for trailing-dot localhost. Also tighten IPv6 literal handling to reject unspecified/IPv4-compatible non-public addresses or replace this bespoke parser with a vetted public-IP classification helper.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --stat && git diff -- packages/protocol/src/push.ts` — inspected worktree status and repaired endpoint-validation diff.
  - `nl -ba packages/protocol/src/push.ts | sed -n '1,120p' && node - <<'NODE' ...` — captured line numbers and confirmed WHATWG URL keeps `localhost.` / `foo.localhost.` as hostnames.
  - `npx tsx -e "import { PushSubscriptionPayloadSchema } from './packages/protocol/src/push.ts'; ..."` — confirmed schema rejects `https://localhost/push` but accepts `https://localhost./push`, `https://foo.localhost./push`, `https://[::]/push`, and `https://[::192.168.1.5]/push`.
- Scope checked: prior Unit 02 SSRF finding, endpoint validation in `packages/protocol/src/push.ts`, push route persistence path, push notifier outbound fanout path, push route/notification/protocol tests, and Unit 02 artifacts after repair.
- Nested Claude reviewer: skipped per task instruction.
