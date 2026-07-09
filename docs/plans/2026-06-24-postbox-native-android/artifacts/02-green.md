# 02 — GREEN: Server URL onboarding and health verification

## changedFiles
- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerUrlNormalizer.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/onboarding/PostboxHealthVerifier.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/onboarding/VerifiedServerUrlStore.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerOnboardingViewModel.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/02-green.md`

## testsAddedOrUpdated
- None in GREEN. Reused the Unit 02 RED tests:
  - `apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerUrlNormalizerTest.kt`
  - `apps/android/app/src/test/java/dev/pi/postbox/onboarding/PostboxHealthVerifierTest.kt`
  - `apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerOnboardingViewModelTest.kt`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — passed; targeted Unit 02 JVM tests are green.
- `npx vitest run apps/androidScaffold.test.ts` — passed; Unit 01 scaffold/package-safety Vitest remains green.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug` — passed; Android unit tests and debug APK build are green.
- `python3 - <<'PY' ...` over `apps/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` — passed; confirmed Unit 02 test counts from XML reports.
- `git status --short && git diff --cached --stat` — passed; showed untracked worktree files and no staged files.

## validationOutput
Targeted Unit 02 test reports:

```text
TEST-dev.pi.postbox.onboarding.PostboxHealthVerifierTest.xml: tests=4 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.ServerOnboardingViewModelTest.xml: tests=5 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.ServerUrlNormalizerTest.xml: tests=4 failures=0 errors=0
```

Unit 01 Vitest:

```text
Test Files  1 passed (1)
Tests  4 passed (4)
Duration  5.19s
```

Android Gradle gate:

```text
cd apps/android && ./gradlew test assembleDebug
BUILD SUCCESSFUL in 3s
64 actionable tasks: 9 executed, 55 up-to-date
```

No staged files:

```text
git status --short && git diff --cached --stat
?? apps/android/
?? apps/androidScaffold.test.ts
?? docs/plans/2026-06-24-postbox-native-android/
```

## implementationNotes
- Added URL normalization/validation that requires an explicit `http://` or `https://` scheme, normalizes accepted server URLs to a root trailing-slash base URL, derives `/healthz`, and warns for non-HTTPS developer URLs.
- Added `OkHttpPostboxHealthVerifier`, backed by OkHttp and kotlinx serialization, that requests `/healthz`, ignores unknown JSON fields, accepts only healthy `service: "pi-postbox"` responses, rejects malformed/non-Postbox health JSON, and reports IO failures as retryable unreachable results.
- Added `VerifiedServerUrlStore` plus a SharedPreferences-backed implementation for persisted verified base URLs.
- Added onboarding state and `ServerOnboardingViewModel` for input, validation errors, retryable unreachable errors, rejected health responses, saving verified URLs, and loading saved URLs without rechecking health.
- Replaced the placeholder-only activity with a minimal Compose onboarding screen that accepts a server URL, verifies it off the main thread, saves it on success, and navigates to a connected placeholder for later question workflow units.
- Added Android `INTERNET` permission and an explicit coroutine dependency used by the Compose onboarding action.

## residualRisks
- No emulator/device runtime smoke was run; preflight documents no stable device/KVM in this environment.
- The concrete SharedPreferences store is compile/build validated but not covered by an Android/Robolectric persistence test in this unit.
- Editing/replacing an already saved URL from a full settings surface remains deferred; the post-success screen is intentionally only a later-workflow placeholder to keep Unit 02 scope narrow.

## noStagedFiles
true

`git diff --cached --stat` produced no output.
