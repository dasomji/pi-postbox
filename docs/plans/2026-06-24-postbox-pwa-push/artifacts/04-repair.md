# Unit 04 REPAIR — Client notification subscription UI

## result
PASS

## changedFiles
- `apps/web/src/components/NotificationSubscriptionControl.svelte`
- `apps/web/src/lib/pushNotifications.ts`
- `apps/web/src/lib/pushNotifications.test.ts`
- `apps/web/src/clientNotificationUi.static.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/04-repair.md`

## repairSummary
- Added save-with-rollback handling for browser push subscriptions: when the server POST save fails after `PushManager.subscribe()` succeeds, the current browser subscription is unsubscribed before the original save error is rethrown.
- Wired the notification UI enable flow through that rollback helper so it no longer leaves an unsaved local browser subscription that can later be reported as subscribed.
- Added `role="status"` and `aria-live="polite"` to the async notification status message.
- Added regression coverage for rollback behavior and updated the static Unit 04 contract to require rollback integration/live-region semantics.

## commandsRun
- `npx vitest run apps/web/src/lib/pushNotifications.test.ts` — PASS. 1 file passed, 2 tests passed. Initial RED before implementation failed with `savePushSubscriptionWithBrowserRollback is not a function`.
- `npx vitest run apps/web/src/api/postboxApi.push.test.ts apps/web/src/clientNotificationUi.static.test.ts apps/web/src/lib/pushNotifications.test.ts` — PASS. 3 files passed, 13 tests passed.
- `npm run typecheck -w @pi-postbox/web` — PASS. `svelte-check found 0 errors and 0 warnings`.
- `npm run build -w @pi-postbox/web` — PASS. Vite transformed 156 modules and built successfully.
- `git diff --cached --quiet; echo "cached_diff_exit=$?"` — PASS/no staged files. Output: `cached_diff_exit=0`.

## validationOutput
- Unit 04 targeted Vitest suite passes with rollback regression coverage.
- Web typecheck passes with no Svelte diagnostics.
- Web production build completes successfully.

## residualRisks
- No live browser permission prompt or real PushManager integration was exercised in this repair; validation remains unit/static plus web build/typecheck.
- If browser-level `unsubscribe()` itself fails during rollback, the helper logs the rollback failure and preserves the original server-save error; a local subscription may remain in that rare browser failure case.
- The working tree already contains broader PWA push dirty/untracked files from prior units; this repair only touched the Unit 04 client rollback/status files listed above.

## noStagedFiles
true
