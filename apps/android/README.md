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

## Emulator localhost fallback

Android emulators cannot reach the host machine at `localhost`. If the Postbox server is running on the development machine and you are testing in an emulator, use `10.0.2.2` as the host, for example:

```text
http://10.0.2.2:32187/
```

Prefer the Tailnet HTTPS URL for real-device evidence; use the emulator fallback only for local development.

## Notification and push limitations

The native app does not reuse browser Web Push subscriptions. While the connected question screen is active, fetched/SSE state snapshots are observed and newly seen pending request ids post one Android local notification. The notification content is privacy-preserving (it does not include the question prompt); tapping it reopens the app and selects the relevant question if that request is still present in the latest observed state.

On Android 13+, the app requests `POST_NOTIFICATIONS` and gates posting on the runtime permission. If permission is denied, notifications are disabled but the question workflow remains usable: loading, viewing, answering, and cancelling questions are not blocked.

No FCM, true native background push, foreground service, or always-on background sync is implemented. Notifications are only produced while the app is running the connected workflow and observing state.

## Evidence limitations

Current automated evidence is JVM tests, Gradle build/lint, and debug APK assembly. Emulator or real device smoke requires working `adb devices`, a reachable Tailnet HTTPS Postbox URL, and hardware/KVM availability. Until that is run, install/tap behavior should be treated as not yet installed on a physical device.
