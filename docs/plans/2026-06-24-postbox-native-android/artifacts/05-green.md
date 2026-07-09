# 05 — GREEN: Notifications and developer install workflow

## changedFiles
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/dev/pi/postbox/notification/PendingQuestionNotificationTracker.kt`
- `apps/android/README.md`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/05-green.md`

## testsAddedOrUpdated
- None in GREEN. Reused Unit 05 RED tests:
  - `apps/android/app/src/test/java/dev/pi/postbox/notification/PendingQuestionNotificationTrackerTest.kt`
  - `apps/androidDeveloperInstallDocs.test.ts`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*'` — passed.
- `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — passed.
- `npx vitest run apps/androidScaffold.test.ts apps/androidDeveloperInstallDocs.test.ts` — passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed before the manifest permission addition.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed after adding `POST_NOTIFICATIONS` to the manifest.
- `python3 - <<'PY' ...` over Android test XML reports — passed; confirmed notification and full debug unit-test counts.
- `git status --short --untracked-files=all && git diff --cached --stat` — passed; confirmed no staged files.

## validationOutput
Targeted Unit 05 notification JVM tests:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*'
BUILD SUCCESSFUL in 2s
22 actionable tasks: 7 executed, 15 up-to-date
```

Docs Vitest:

```text
npx vitest run apps/androidDeveloperInstallDocs.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
```

Relevant root Vitest checks:

```text
npx vitest run apps/androidScaffold.test.ts apps/androidDeveloperInstallDocs.test.ts
Test Files  2 passed (2)
Tests  5 passed (5)
```

Full Android gate with explicit SDK env:

```text
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 5s
74 actionable tasks: 16 executed, 58 up-to-date
```

Android debug unit-test report summary:

```text
debug unit test classes: 8
tests: 41 failures: 0 errors: 0
TEST-dev.pi.postbox.notification.PendingQuestionNotificationTrackerTest.xml: tests=3 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.PostboxHealthVerifierTest.xml: tests=4 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.ServerOnboardingViewModelTest.xml: tests=7 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.ServerUrlNormalizerTest.xml: tests=6 failures=0 errors=0
TEST-dev.pi.postbox.protocol.PostboxProtocolClientTest.xml: tests=5 failures=0 errors=0
TEST-dev.pi.postbox.protocol.PostboxProtocolDtoTest.xml: tests=3 failures=0 errors=0
TEST-dev.pi.postbox.protocol.PostboxStateStreamTest.xml: tests=4 failures=0 errors=0
TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml: tests=9 failures=0 errors=0
```

No staged files:

```text
git status --short --untracked-files=all && git diff --cached --stat
?? apps/android/.gitignore
?? apps/android/README.md
?? apps/android/app/build.gradle.kts
?? apps/android/app/src/main/AndroidManifest.xml
?? apps/android/app/src/main/java/dev/pi/postbox/notification/PendingQuestionNotificationTracker.kt
... existing untracked Android/docs plan files from Units 01-05 ...
--- staged ---
```

`git diff --cached --stat` produced no output.

## implementationNotes
- Added a side-effect-free `PendingQuestionNotificationTracker` that treats the first observed app state as a baseline, emits local notification decision events only for later newly observed pending request ids, and records all observed request ids so SSE/state replays or resolved/reappearing snapshots do not duplicate events.
- Added `PendingQuestionNotification`, `NotificationTapTarget.OpenQuestion`, deep-link URI rendering (`postbox://questions/<requestId>`), and the explicit intent action string `dev.pi.postbox.OPEN_QUESTION` as a representable tap target without implementing OS notification posting yet.
- Added `NotificationPermissionState`/`NotificationAvailability` so denied Android 13+ notification permission disables posting notifications while keeping the question workflow usable and non-blocking.
- Declared `android.permission.POST_NOTIFICATIONS` in the Android manifest for the future local notification posting path; no runtime prompt, foreground service, background push, FCM, or notification channel/posting implementation was added in this unit.
- Added `apps/android/README.md` with Android SDK env setup, Gradle test/build/lint command, debug APK path/install command, Tailnet HTTPS server URL guidance, emulator `10.0.2.2` fallback, evidence limitations, and native/Web Push limitations.

## residualRisks
- The new layer decides which notification events should be posted, but Android notification channel creation, permission prompt UI, PendingIntent construction, and actual notification posting remain deferred.
- Notification tap selection is represented as an action/deep link, but no emulator/device smoke was run to verify launching and focusing the relevant question from a system notification.
- No foreground sync, background push, FCM, or foreground service was implemented by design.
- The README documents install workflow, but real-device/emulator installation evidence still depends on working `adb devices`, reachable Tailnet URL, and hardware/KVM availability.

## noStagedFiles
true
