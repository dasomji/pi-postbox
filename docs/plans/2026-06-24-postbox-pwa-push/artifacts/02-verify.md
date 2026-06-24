# Unit 02 VERIFY — Notify subscribers for new pending questions

Verification result: **PASS** for PWA Push Unit 02 after validation repair.

## Requirements checked

- **New ask fanout:** Covered by `packages/server/test/pushNotifications.test.ts`; focused push tests passed. Implementation wires `PushNotifier` into the websocket ask-create path and sends for newly-created pending asks.
- **Duplicate no resend:** Covered by `packages/server/test/pushNotifications.test.ts`; focused push tests passed. The websocket path checks whether the request already existed before notifying.
- **404/410 prune:** Covered by `packages/server/test/pushNotifications.test.ts`; focused push tests passed. `PushNotifier` deletes endpoints when the sender throws status `404` or `410`.
- **Payload excludes prompt:** Covered by `packages/server/test/pushNotifications.test.ts`; focused push tests passed. `PushNotifier` builds payloads from request/session IDs and project/session labels, not prompt text.
- **Endpoint validation repair:** Satisfied by inspection of `packages/protocol/src/push.ts` and focused protocol tests. `normalizePushHostname()` lowercases, strips IPv6 brackets, and removes a trailing DNS root dot for non-IPv6 hosts before localhost checks. IPv6 handling parses hextets, rejects unspecified `::`, loopback `::1`, unique-local/link-local ranges, and rejects IPv4-compatible or IPv4-mapped literals when the embedded IPv4 address is private/local.
- **Regression coverage for validation repair:** `packages/protocol/src/push.test.ts` includes rejection cases for `https://localhost./push`, `https://foo.localhost./push`, `https://[::]/push`, `https://[::192.168.1.5]/push`, and `https://[::ffff:192.168.1.5]/push`.

## Commands run

- `npx vitest run packages/protocol/src/push.test.ts packages/server/test/pushRoutes.test.ts packages/server/test/pushNotifications.test.ts` — **passed**; 3 files / 12 tests.
- `npm run typecheck` — **passed**; `tsc -b` completed without diagnostics.
- `nl -ba packages/protocol/src/push.ts | sed -n '1,180p'` — **passed** for source inspection; confirmed repair is present at `packages/protocol/src/push.ts:29-72` and supporting parsing at `packages/protocol/src/push.ts:75-108`.
- `node --input-type=module <<'EOF' ... EOF` direct schema probe — **passed**; rejected `localhost.`, `foo.localhost.`, `[::]`, `[::192.168.1.5]`, and `[::ffff:192.168.1.5]`; accepted public FCM endpoint.
- `git diff --stat && git status --short && git diff --cached --name-only` — **passed** for worktree/staging inspection; no staged files.

## Evidence artifacts

- Verification artifact: `docs/plans/2026-06-24-postbox-pwa-push/artifacts/02-verify.md`.
- Direct schema probe transcript in verifier session:
  - `https://localhost./push rejected`
  - `https://foo.localhost./push rejected`
  - `https://[::]/push rejected`
  - `https://[::192.168.1.5]/push rejected`
  - `https://[::ffff:192.168.1.5]/push rejected`
  - `https://fcm.googleapis.com/fcm/send/test accepted`

## Skipped gates

- Full `npm test`, build, smoke, lint/format: skipped because the task explicitly requested focused push tests and typecheck only.
- Browser/UI/PWA evidence: out of Unit 02 scope and outside the requested validation gates.

## Issues found

- None blocking.

## Residual risks

- DNS names that resolve to private/link-local addresses are still not resolved or blocked; validation remains syntactic host validation only.
- Public IPv4-compatible or IPv4-mapped IPv6 literals are not rejected unless their embedded IPv4 address is private/local, matching the narrow repaired finding.
- Push delivery remains best-effort and asynchronous; non-404/410 sender failures are logged but not surfaced to the ask creator.

## Ledger/status updates

- Updated `docs/plans/2026-06-24-postbox-pwa-push/artifacts/02-verify.md` from FAIL to PASS after validation repair.

## Recommended next step

Proceed to the next planned PWA push unit or broader final verification when the full slice is complete.
