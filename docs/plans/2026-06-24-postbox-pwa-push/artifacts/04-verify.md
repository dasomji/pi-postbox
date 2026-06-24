# Unit 04 VERIFY — Client notification subscription UI (re-verify after repair)

## result
PASS

## requirementsChecked
- Explicit user action permission: PASS. `Notification.requestPermission()` is only used inside `enableNotifications()` and the static contract confirms it is wired to the visible `Enable notifications` button, not app startup (`apps/web/src/components/NotificationSubscriptionControl.svelte:62-80`, `:146-153`; `apps/web/src/clientNotificationUi.static.test.ts`).
- No permission request on load: PASS. `onMount()` only calls `refreshNotificationState()`; targeted static test verifies startup/chrome sources do not call `Notification.requestPermission()`.
- States unsupported/unavailable/denied/subscribed/unsubscribed: PASS. Component/helper define and render those states, covered by the static contract test.
- Subscribe uses VAPID public key + service worker PushManager + POST: PASS. The enable flow fetches `/api/push/config`, subscribes via `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ... })`, then saves through `savePushSubscriptionWithBrowserRollback(subscription, savePushSubscription)`; API helper tests verify POST to `/api/push/subscriptions`.
- Unsubscribe + DELETE: PASS. Disable flow uses `unsubscribeFromBrowserPush()` and deletes by endpoint; API/static tests verify browser unsubscribe and DELETE `/api/push/subscriptions`.
- Server-save failure consistency: PASS. The repaired flow routes the browser subscription through `savePushSubscriptionWithBrowserRollback()`. On save rejection, the helper awaits `rollbackSubscription()` (default `unsubscribeFromBrowserPush()`) and rethrows the original save error; the UI catch sets `unavailable` and does not set `subscribed`. Regression test `apps/web/src/lib/pushNotifications.test.ts` verifies rollback is called on save failure and not called on save success.
- Live region: PASS. The async notification status message is rendered with `role="status"` and `aria-live="polite"`, covered by the static contract test.

## commandsRun
- `npx vitest run apps/web/src/api/postboxApi.push.test.ts apps/web/src/clientNotificationUi.static.test.ts apps/web/src/lib/pushNotifications.test.ts` — PASS. 3 files passed, 13 tests passed. Log: `/tmp/unit04-reverify-vitest.log`.
- `npm run typecheck -w @pi-postbox/web` — PASS. `svelte-check found 0 errors and 0 warnings`. Log: `/tmp/unit04-reverify-web-typecheck.log`.
- `npm run build -w @pi-postbox/web` — PASS. Vite transformed 156 modules and built successfully. Log: `/tmp/unit04-reverify-web-build.log`.
- `node /home/dev/.pi/agent/git/github.com/dasomji/pi-daniel-skills/skills/general/web-browser/scripts/start.js` — BLOCKED for browser evidence. Failed with `spawn /usr/bin/google-chrome ENOENT`. Log: `/tmp/unit04-reverify-chrome-start.log`.
- `npm run dev -w @pi-postbox/web` plus `curl -fsS http://127.0.0.1:5173/` — PASS fallback product-serving check. Dev server returned HTTP 200; app shell includes manifest link, title, and `#app` mount node. Artifacts: `/tmp/unit04-reverify-curl-headers.txt`, `/tmp/unit04-reverify-curl-index.html`, `/tmp/unit04-reverify-vite.log`.
- `git diff --cached --quiet; echo "cached_diff_exit=$?"` — PASS/no staged files. Output: `cached_diff_exit=0`.

## evidenceArtifacts
- Unit 04 targeted test log: `/tmp/unit04-reverify-vitest.log`.
- Web typecheck log: `/tmp/unit04-reverify-web-typecheck.log`.
- Web build log: `/tmp/unit04-reverify-web-build.log`.
- Browser evidence attempt log: `/tmp/unit04-reverify-chrome-start.log` (blocked by missing `/usr/bin/google-chrome`).
- Fallback product-serving evidence: `/tmp/unit04-reverify-curl-headers.txt`, `/tmp/unit04-reverify-curl-index.html`, `/tmp/unit04-reverify-vite.log`.

## skippedGates
- Live browser permission/subscription workflow and screenshot: blocked because the available web-browser skill requires `/usr/bin/google-chrome`, which is not installed in this environment.
- Full-root `npm test`, root `npm run typecheck`, root `npm run build`, and smoke: outside this Unit 04 re-verification request; targeted Unit 04 tests plus web typecheck/build were run.

## issuesFound
None blocking for Unit 04 re-verification.

## residualRisks
- Unit 04 verification is unit/static/source-level for rollback behavior; no real browser permission prompt or actual PushManager subscription was exercised because Chrome/CDP was unavailable.
- If browser-level `unsubscribe()` itself fails during rollback, the helper logs that rollback failure and preserves the original server-save error; a local browser subscription may remain in that rare browser failure case.
- The working tree contains broader PWA push dirty/untracked files from prior units; this pass only re-verified Unit 04 repair scope.

## noStagedFiles
true
