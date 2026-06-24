# Unit 04 RED — Client notification subscription UI

## changedFiles
- `apps/web/src/api/postboxApi.push.test.ts`
- `apps/web/src/clientNotificationUi.static.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/04-red.md`

## testsAddedOrUpdated
- `apps/web/src/api/postboxApi.push.test.ts`
  - `client push API helpers > exports focused helpers for browser push config, subscription save, and subscription delete`
    - Expects `postboxApi` to export `fetchPushConfig`, `savePushSubscription`, and `deletePushSubscription` for the notification UI.
  - `client push API helpers > fetches /api/push/config and returns the parsed browser push config`
    - Expects `fetchPushConfig()` to call `fetch("/api/push/config")` and return the protocol-shaped config.
  - `client push API helpers > POSTs the browser PushSubscription JSON to /api/push/subscriptions`
    - Expects `savePushSubscription(subscription)` to POST JSON to `/api/push/subscriptions`.
  - `client push API helpers > DELETEs the subscription endpoint from /api/push/subscriptions`
    - Expects `deletePushSubscription(endpoint)` to DELETE JSON `{ endpoint }` from `/api/push/subscriptions`.
- `apps/web/src/clientNotificationUi.static.test.ts`
  - `Unit 04 client notification subscription UI static contract > mounts a notification subscription control in app chrome without requesting permission during startup`
    - Expects a notification control component to be mounted in app chrome and no startup `Notification.requestPermission()` call.
  - `Unit 04 client notification subscription UI static contract > exposes user-visible states for unsupported, unavailable, permission denied, subscribed, and unsubscribed notifications`
    - Expects user-visible state coverage for unsupported/unavailable/permission-denied/subscribed/unsubscribed.
  - `Unit 04 client notification subscription UI static contract > requests notification permission only from an explicit enable action`
    - Expects permission request wiring behind an explicit enable button/toggle, not mount-time lifecycle.
  - `Unit 04 client notification subscription UI static contract > subscribes with the VAPID public key from /api/push/config and POSTs the resulting browser subscription`
    - Expects config fetch, service worker readiness, `pushManager.subscribe`, `userVisibleOnly: true`, VAPID public-key conversion, and server save.
  - `Unit 04 client notification subscription UI static contract > unsubscribes the current browser subscription and DELETEs it from the server`
    - Expects existing subscription lookup, browser `unsubscribe()`, and server DELETE by endpoint.

## commandsRun
- `npx vitest run apps/web/src/api/postboxApi.push.test.ts apps/web/src/clientNotificationUi.static.test.ts`
  - Result: failed as expected (RED).
- `git diff --cached --quiet; echo $?`
  - Result: `0` (no staged files).
- `git status --short`
  - Result: showed existing unstaged/untracked work from prior units plus the two new Unit 04 test files and this artifact; nothing staged.

## validationOutput
Targeted Vitest command failed with 2 failed files / 9 failed tests:

- `apps/web/src/api/postboxApi.push.test.ts`: all 4 tests failed because `postboxApi` does not yet export `fetchPushConfig`, `savePushSubscription`, or `deletePushSubscription`.
- `apps/web/src/clientNotificationUi.static.test.ts`: all 5 tests failed because there is no `NotificationSubscriptionControl.svelte`/push UI helper yet, no visible state handling, no explicit permission action wiring, no client subscribe flow using VAPID + service worker readiness, and no unsubscribe/delete flow.

Key passing signal inside the failures: startup sources still do **not** call `Notification.requestPermission()`, so the RED is focused on missing Unit 04 behavior rather than an existing permission-on-load regression.

## residualRisks
- Static UI tests are intentionally source-contract focused because this repo's Vitest environment is Node-only and no DOM/Svelte testing harness is present.
- The helper/component names (`NotificationSubscriptionControl.svelte`, `fetchPushConfig`, `savePushSubscription`, `deletePushSubscription`, optional `lib/pushNotifications.ts`) define the expected public seam for GREEN; implementation can satisfy via these names without broader architecture changes.
- Existing unstaged/untracked files from earlier units were present before this RED pass and were not modified except for adding the Unit 04 tests/artifact listed above.

## noStagedFiles
true
