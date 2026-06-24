# Unit 02 GREEN — Notify subscribers for new pending questions

## changedFiles
- `packages/server/src/app.ts`
- `packages/server/src/services/pushNotifier.ts`
- `packages/server/src/services/pushStore.ts`
- `packages/server/src/ws/extensionSocket.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/02-green.md`

## testsAddedOrUpdated
- No tests changed during GREEN; used the RED tests in `packages/server/test/pushNotifications.test.ts`.

## commandsRun
- `npx vitest run packages/server/test/pushNotifications.test.ts` — failed before implementation as expected; 3 tests failed because `pushSender.sendNotification` was never called.
- `npx vitest run packages/server/test/pushNotifications.test.ts` — passed after implementation; 1 file / 3 tests.
- `npm run typecheck` — passed; `tsc -b` completed without diagnostics.
- `npx vitest run packages/server/test/pushRoutes.test.ts packages/server/test/pushNotifications.test.ts` — passed; 2 files / 7 tests.
- `git diff --cached --name-only && git status --short` — passed; no staged files, with unstaged/untracked Unit 01/02 worktree files present.
- `git diff --cached --quiet && echo no staged files` — passed; printed `no staged files`.

## validationOutput
- Targeted Unit 02 Vitest: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.
- Push route + notification regression Vitest: `Test Files  2 passed (2)`, `Tests  7 passed (7)`.
- Typecheck: `> tsc -b` completed without diagnostics.
- Staged-file check: `git diff --cached --name-only` returned no paths; `git diff --cached --quiet && echo no staged files` printed `no staged files`.

## implementationNotes
- Added a typed `pushSender` injection seam to `createPostboxApp`.
- Added `PushNotifier` to build privacy-preserving new-ask push payloads and fan out to persisted browser subscriptions.
- Payloads include request/session identity plus project/session labels when available, and intentionally omit question prompt text.
- The websocket `ask.create` path now notifies only when `RequestStore.create` is creating a previously unseen pending request, preserving idempotent duplicate `requestId` behavior.
- Push-service 404/410 failures delete the failed endpoint before later fanout.

## residualRisks
- Notification delivery uses an asynchronous best-effort send after the websocket `ask.created` acknowledgement; non-404/410 sender failures are logged but not surfaced to the ask creator.
- The VAPID subject is a fixed `mailto:pi-postbox@example.invalid`; future production configuration may want an explicit subject option.

## noStagedFiles
true
