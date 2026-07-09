# Unit 05 — Notifications and developer install workflow

## Goal
Make the native app useful as a developer-installed APK and define a realistic first notification story.

## Scope
- Add Android notification permission handling for Android 13+.
- First pass: local notifications for newly observed pending questions while the app is active or while an explicit foreground sync mode is enabled.
- If foreground sync is included, show a persistent foreground-service notification and make it opt-in.
- Document sideload/debug install flow.
- Add a release/debug build note for later Play Store readiness.

## Test scenarios
- Notification permission denied leaves app functional and explains that notifications are disabled.
- New pending question observed from state/SSE triggers one local notification.
- Replayed/idempotent state does not duplicate notifications for the same request id.
- Tapping a notification opens the relevant question when still present.
- Developer can build and install a debug APK with documented commands once Android tooling is installed.

## Notes
Native Android cannot directly reuse browser Web Push subscriptions. True background push should be a later explicit decision, likely involving FCM or a separate push channel in the server.
