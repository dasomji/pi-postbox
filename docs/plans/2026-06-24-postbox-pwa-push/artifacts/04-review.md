## Findings

1. **Severity:** Medium  
   **Location:** `apps/web/src/components/NotificationSubscriptionControl.svelte:89`  
   **Requirement/pattern violated:** Unit 04 requires the browser subscription to be sent to the server and removable (`docs/plans/2026-06-24-postbox-pwa-push/units/04-client-notification-ui.md:9`); the overall plan expects the client to store the subscription server-side after subscribing.  
   **Issue:** `enableNotifications()` creates the browser push subscription before `savePushSubscription()`, but the catch path only marks notifications unavailable if the POST fails. That leaves a local browser subscription with no server record. On the next refresh, `getCurrentPushSubscription()` will make the UI report `subscribed` based only on the local subscription, even though the server cannot send notifications to it.  
   **Required fix:** Roll back the local browser subscription when `savePushSubscription()` fails (or otherwise keep enough state to retry the server save before reporting subscribed), and add targeted coverage for POST failure so a stale local-only subscription is not reported as subscribed.

2. **Severity:** Low  
   **Location:** `apps/web/src/components/NotificationSubscriptionControl.svelte:121`  
   **Requirement/pattern violated:** Unit 04 review scope includes accessibility fit for the notification state control.  
   **Issue:** The visible status text changes asynchronously after support checks and enable/disable actions, but the status/message area has no live-region semantics. Screen-reader users may not be notified when the control moves between unavailable, denied, subscribed, and unsubscribed states.  
   **Required fix:** Mark the status text/container as a polite live region (for example `role="status"` or `aria-live="polite"`) and consider `aria-busy` while the action is in progress.

## Validation notes

- Commands run, if any:
  - `git diff -- apps/web/src/api/postboxApi.ts apps/web/src/lib/pushNotifications.ts apps/web/src/components/NotificationSubscriptionControl.svelte apps/web/src/components/Sidebar.svelte apps/web/src/api/postboxApi.push.test.ts apps/web/src/clientNotificationUi.static.test.ts docs/plans/2026-06-24-postbox-pwa-push/artifacts/04-red.md docs/plans/2026-06-24-postbox-pwa-push/artifacts/04-green.md docs/plans/2026-06-24-postbox-pwa-push/units/04-client-notification-ui.md | sed -n '1,240p'`
  - `git status --short -- <Unit 04 paths>`
  - `nl -ba apps/web/src/components/NotificationSubscriptionControl.svelte | sed -n '1,180p'` plus line-number reads for `pushNotifications.ts` and `postboxApi.ts`
- Scope checked: Unit 04 dossier/artifacts, `postboxApi.ts`, `pushNotifications.ts`, `NotificationSubscriptionControl.svelte`, `Sidebar.svelte`, `postboxApi.push.test.ts`, and `clientNotificationUi.static.test.ts`. Nested Claude and long commands were not run per instruction.
