# Pi Postbox Android developer install

This is a developer-installable native Android client for a Postbox server reachable from your Tailnet. It is intentionally outside the npm package/workspace release path.

## Build and test

Install a JDK and Android SDK first, then run from the repository root:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

cd apps/android
./gradlew test assembleDebug lintDebug
```

The debug APK is written to:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

## Install on a real device

Enable Developer Options and USB or Wireless debugging, then confirm the device is visible:

```bash
adb devices
```

Install or replace the debug build:

```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

If you are already inside `apps/android`, use:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Server URL guidance

For a real phone or tablet, enter the Tailnet HTTPS URL for the Postbox server, for example:

```text
https://postbox.your-tailnet.ts.net/
```

The app verifies the server with `GET /healthz` before saving the URL. Keep the existing Tailnet-private trust model: do not expose the Postbox server publicly for this prototype.

Android 0.4.7 (build 11) supports Postbox protocol 0.1.10 exactly. The app displays this identity before and after connection, rechecks saved endpoints, and blocks state, Answer, cancel, refresh, Question Chat, and push registration when the active endpoint reports missing or different protocol evidence. Regenerate the shared contract with `npm run generate:android-protocol-contract`; CI uses `npm run check:android-protocol-contract` plus Android unit/lint/assembly gates to reject drift.

## Emulator localhost fallback

Android emulators cannot reach the host machine at `localhost`. If the Postbox server is running on the development machine and you are testing in an emulator, use `10.0.2.2` as the host, for example:

```text
http://10.0.2.2:45795/
```

Prefer the Tailnet HTTPS URL for real-device evidence; use the emulator fallback only for local development.

## Notifications and FCM push

The native app does not reuse browser Web Push subscriptions. Two notification paths share the same notifier and per-request notification ids, so the same question does not produce duplicate per-question notifications:

1. **In-app observation**: while the connected question screen is active, fetched/SSE state snapshots are observed and newly seen pending request ids post one Android local notification.
2. **FCM push (app closed or backgrounded)**: when Firebase is configured, the app registers its FCM token with the verified Postbox server, and the server pushes new pending questions as data-only FCM messages that `PostboxFirebaseMessagingService` renders through the same notifier. Its best-effort state prefetch also reconciles the full pending queue.

In addition to per-question notifications, every authoritative pending snapshot maintains one quiet, ongoing summary notification for the complete Android queue. The summary carries the pending count with Android's standard `setNumber` metadata and drives the launcher app-icon badge when the launcher supports notification badges. Launchers and OEMs control the presentation: some display the number and others display only a dot. Resolving the final pending question removes the summary and badge source.

All notification content is privacy-preserving and omits Question prompts. Tapping a per-question notification reopens the app and selects that Question if it is still present in the latest observed state; tapping the summary opens the app.

On Android 13+, the app requests `POST_NOTIFICATIONS` and gates posting on the runtime permission. If permission is denied—or launcher/channel badges are disabled—the notification-backed launcher badge is unavailable, but the question workflow remains usable: loading, viewing, answering, and cancelling Questions are not blocked.

### Firebase setup

FCM needs per-developer Firebase artifacts that are not committed:

1. Create a Firebase project at <https://console.firebase.google.com> and add an Android app with package name `dev.pi.postbox`.
2. Download `google-services.json` into `apps/android/app/` (gitignored). The Gradle build applies the `google-services` plugin only when this file exists, so builds without it still work — they just never initialize Firebase and fall back to in-app notifications only.
3. In Firebase project settings → Service accounts, generate a service-account key JSON and start the Postbox server with `--fcm-service-account /path/to/key.json` (or `PI_POSTBOX_FCM_SERVICE_ACCOUNT`). See `docs/configuration.md`.

Token registration happens automatically whenever the connected question workflow starts against a verified server URL, and again on FCM token rotation.

## Evidence limitations

Current automated evidence is JVM tests, Gradle build/lint, and debug APK assembly. Emulator or real device smoke requires working `adb devices`, a reachable Tailnet HTTPS Postbox URL, and hardware/KVM availability. Until that is run, install/tap behavior should be treated as not yet installed on a physical device.
