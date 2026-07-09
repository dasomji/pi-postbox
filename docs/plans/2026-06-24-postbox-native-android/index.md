# Postbox native Android app

Current state: COMPLETE. Units 01-05 PASS; final full-change review/rereview PASS; final verification PASS. Native Android debug APK builds at `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

## Decision
Build the Android app in this repository under `apps/android`, but keep it outside the npm workspace and outside the published Pi package.

Why:
- The existing repo is already a monorepo with `packages/*` and `apps/*`.
- The root `package.json` publishes a single Pi/npm package via an explicit `files` allowlist, so `apps/android` will not ship in the npm tarball unless deliberately added.
- Keeping the app here keeps the HTTP/SSE protocol, docs, server changes, and mobile client in one reviewable place.
- A separate repo can wait until Android release/publishing cadence becomes materially different.

## Goal
Create a developer-installable native Android client for Pi Postbox that connects to an existing Postbox server over an explicit Tailscale HTTPS URL and supports the same core decision workflow as the current mobile/PWA dashboard.

## Product scope

### In scope for the first native pass
- Native Android app installable as a debug APK from this repo.
- First-run setup where the developer enters or scans a Postbox server URL.
- Verify the server with `GET /healthz` before saving it.
- Show live sessions and open questions from `GET /api/state` plus `GET /api/state/events` SSE.
- Answer and cancel pending questions with the existing HTTP endpoints.
- Preserve the current Tailnet-private trust model: no new public exposure and no app-level auth in this slice.
- Local Android notifications only for events observed while the app is active or while an explicitly enabled foreground sync mode is running.

### Deferred
- Google Play/App Store publication.
- App-level authentication or account model.
- FCM/native push notification infrastructure.
- Automatic Tailnet/server discovery or port scanning.
- Full feature parity with all dashboard history/admin controls.

## Architecture

### Repo layout
- `apps/android/` — self-contained Gradle Android project.
- `apps/android/gradlew`, `apps/android/gradle/wrapper/*` — committed Gradle wrapper so system Gradle is not required.
- `apps/android/app/src/main/...` — Android app source.
- No `apps/android/package.json`; do not add it to npm workspaces.
- Keep root npm `files` allowlist unchanged unless a later release explicitly needs Android artifacts.

### Android stack
- Kotlin + Jetpack Compose + Material 3 for native UI.
- Android Gradle Plugin project local to `apps/android`.
- `kotlinx.serialization` for JSON DTOs matching the existing protocol schemas.
- OkHttp for HTTP requests and the `/api/state/events` SSE stream.
- DataStore or equivalent lightweight preferences for the saved server URL.

### Protocol contract
Use `docs/protocol.md` and `packages/protocol/src/*` as the source of truth:
- `GET /healthz`
- `GET /api/state`
- `GET /api/state/events`
- `POST /api/requests/:requestId/answer`
- `POST /api/requests/:requestId/cancel`
- optional later: history and metadata rename endpoints

Android clients should:
- tolerate unknown JSON fields,
- treat stable ids as opaque strings,
- surface `409`/already-resolved conflicts clearly,
- not call extension WebSocket endpoints,
- not attempt package-local autostart or active-local loopback recovery.

## Tooling status on this machine
Checked on 2026-06-24:
- `java` not found on PATH.
- `gradle` not found on PATH.
- `adb` not found on PATH.
- `sdkmanager` not found on PATH.
- `ANDROID_HOME` and `ANDROID_SDK_ROOT` are unset.

This means I can plan and edit repository files now, but cannot yet build, run, or install a native Android APK from this environment.

## What Daniel needs to install/configure

### Minimum for me to build an APK here
1. Install a JDK, preferably JDK 21 or newer:
   - Ubuntu package route: `sudo apt-get update && sudo apt-get install -y openjdk-21-jdk`
   - After install: `java -version`
2. Install Android SDK command-line tools or Android Studio.
3. Set Android SDK environment variables:
   - `export ANDROID_HOME="$HOME/Android/Sdk"`
   - `export ANDROID_SDK_ROOT="$ANDROID_HOME"`
   - add `$ANDROID_HOME/cmdline-tools/latest/bin` and `$ANDROID_HOME/platform-tools` to PATH.
4. Install required SDK packages with `sdkmanager`, for example:
   - `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`
   - `sdkmanager --licenses`
5. After I scaffold the project, validate with:
   - `cd apps/android && ./gradlew test assembleDebug`

### Minimum for me to install/test on a real Android device
- Install `platform-tools` so `adb` is available.
- Enable Developer Options and USB debugging, or enable Wireless debugging.
- Make the device visible to this machine with `adb devices`.
- Ensure the phone can reach the Postbox server Tailnet HTTPS URL.
- Install debug builds with `adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk`.

### Optional for emulator testing
- Install Android Studio or SDK emulator packages.
- Ensure KVM acceleration is available on this host.
- Create an AVD for a current API level.

## Implementation units
1. [Android project scaffold and build pipeline](units/01-android-scaffold-build.md)
2. [Server URL onboarding and health verification](units/02-server-url-onboarding.md)
3. [Postbox protocol client and state stream](units/03-protocol-client-state-stream.md)
4. [Native question list/detail/answer UI](units/04-native-question-ui.md)
5. [Notifications and developer install workflow](units/05-notifications-install-workflow.md)

## Validation strategy
- Existing repo gates remain required: `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke`.
- Android unit tests: `cd apps/android && ./gradlew test`.
- Android debug build: `cd apps/android && ./gradlew assembleDebug`.
- Instrumented/device checks once `adb` is available:
  - install debug APK,
  - enter Tailnet URL,
  - verify `/healthz`,
  - observe sessions/questions,
  - answer a pending question,
  - confirm Pi receives the selected value.
- Package safety check: `npm pack --dry-run` should not include `apps/android`.

## Risks and open questions
- Native Android cannot reuse browser Web Push subscriptions. True background push likely requires FCM or a different server push design.
- Long-lived background SSE/polling is constrained by Android background execution rules; use explicit foreground sync if needed.
- The existing trust model has no app-level auth. Native clients must remain Tailnet-private unless a separate auth/security project is added.
- OkHttp SSE support is documented as experimental, so wrap it behind a small app-owned interface.
- Without local Android SDK/ADB, validation will initially stop at repository edits and Android plan/scaffold review.

## External references used during planning
- Android `sdkmanager` docs: command-line tools provide `sdkmanager`; install packages like `platform-tools`/`platforms;android-36`; accept licenses with `sdkmanager --licenses`.
- Jetpack Compose setup docs: Kotlin 2.x uses the Compose Compiler Gradle plugin; Compose dependencies should use the Compose BOM.
- OkHttp docs: OkHttp supports Android API 21+ and has an `okhttp-sse` artifact, but SSE API is experimental.
- kotlinx.serialization docs: use the Kotlin serialization compiler plugin plus `kotlinx-serialization-json` runtime dependency.
