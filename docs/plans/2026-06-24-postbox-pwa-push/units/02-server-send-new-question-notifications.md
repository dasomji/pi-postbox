# Unit 02 — Notify subscribers for new pending questions

Current state: WAITING ON Unit 01.

Acceptance criteria:
- New non-duplicate pending ask creation triggers notification fanout to active subscriptions.
- Duplicate/idempotent `requestId` create does not send duplicate notification.
- Notification payload includes project/session context when available but not prompt text.
- Expired/gone subscriptions are pruned on push-service 404/410 failures.
- Tests use a mocked/injected push sender; no external network calls.

Likely files:
- `RequestStore.create` return semantics or app route/socket hook.
- `extensionSocket` ask create path.
- push notification service tests.
