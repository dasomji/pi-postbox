# Unit 04 — Client notification subscription UI

Current state: WAITING ON Unit 01/03.

Acceptance criteria:
- User can enable notifications from an explicit button/toggle.
- UI shows unsupported/unavailable/permission denied/subscribed/unsubscribed states.
- Browser permission is not requested on page load.
- Subscription is sent to server and can be removed.
- Uses public VAPID key from `/api/push/config`.

Likely files:
- `apps/web/src/api/postboxApi.ts`
- `apps/web/src/components/*` for notification control, likely sidebar/header/footer.
- tests for helper/API behavior where feasible.
