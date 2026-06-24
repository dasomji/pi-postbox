# Notification enable debug notes

Current issue: user installed PWA via `https://coolify.tailf5ea68.ts.net:32187/`; after tapping Enable notifications the UI still shows the same Enable button / does not look saved.

What was checked:
- Initially `/api/push/config` on tailnet URL returned 404 because server was still running old build.
- Ran `npm run build`, killed old server PID `3937133`, started `node packages/server/dist/cli.js serve --active-local-role production` (PID `887004`) with logs at `/tmp/pi-postbox-server.log`.
- After restart, `GET https://coolify.tailf5ea68.ts.net:32187/api/push/config` returns 200 with generated VAPID public key.
- Server log after user activity shows many GETs for `/api/push/config`, `/sw.js`, `/manifest.webmanifest`, state/history/assets, but **no `POST /api/push/subscriptions`** entries in the tailed log. That suggests the client is failing before the server save step (likely Notification permission not granted, PushManager.subscribe failure, service worker readiness, or browser support quirk), not failing to persist on the server.

Relevant client behavior:
- `apps/web/src/components/NotificationSubscriptionControl.svelte`
  - `enableNotifications()` requests permission. If permission is not `granted`, sets state to `unsubscribed` with message `Notifications are unsubscribed until browser permission is granted.` This still renders the same Enable button.
  - If `subscribeToBrowserPush()` throws before POST, catch sets `unavailable`.
- `apps/web/src/lib/pushNotifications.ts`
  - `browserPushIsSupported()` requires `Notification`, `PushManager`, and `navigator.serviceWorker`.
  - `subscribeToBrowserPush(publicKey)` waits for `navigator.serviceWorker.ready` and calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.

Likely next debugging step:
- Improve diagnostics/UI so user can see whether permission was dismissed/default, denied, service worker not ready, PushManager.subscribe threw, or POST failed.
- Add logging/reporting for the exact caught error/message in the notification control (safe user-facing message + console details), and possibly a debug status line with `Notification.permission`, SW readiness, and whether PushManager exists.
- Since no POST appears, ask user if Brave permission prompt appeared and whether they tapped Allow. But prefer improving UI first.

Potential implementation direction:
- Add helper `describePushSubscribeError(error)` or more granular states/messages.
- In `enableNotifications`, if permission is `default`, display `Browser permission was not granted. Tap Enable and choose Allow.` rather than plain unsubscribed.
- Around `subscribeToBrowserPush`, catch `NotAllowedError`, `AbortError`, etc. and show actionable message.
- Add tests in `apps/web/src/lib/pushNotifications.test.ts` and/or static tests for clearer permission-default handling.

Current working tree is large WIP PWA/push work (not committed). Do not lose it.
