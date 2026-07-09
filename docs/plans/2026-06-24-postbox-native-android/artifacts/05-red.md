# 05 — RED: Notifications and developer install workflow

## changedFiles
- `apps/android/app/src/test/java/dev/pi/postbox/notification/PendingQuestionNotificationTrackerTest.kt`
- `apps/androidDeveloperInstallDocs.test.ts`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/05-red.md`

## testsAddedOrUpdated
- `PendingQuestionNotificationTrackerTest.newlyObservedPendingRequestIdsEmitOneNotificationWithQuestionTapTarget`
  - Specifies that the first observed state establishes a no-notification baseline.
  - Specifies that a later newly observed pending request id emits exactly one local notification event.
  - Specifies notification title/message and a representable tap target/deep link/action for opening the question.
- `PendingQuestionNotificationTrackerTest.replayedOrPreviouslySeenRequestIdsDoNotDuplicateNotifications`
  - Specifies idempotent state/SSE replay handling.
  - Specifies that resolved snapshots and later reappearance of the same request id do not duplicate notifications.
- `PendingQuestionNotificationTrackerTest.deniedNotificationPermissionDisablesOnlyNotificationsNotTheQuestionWorkflow`
  - Specifies that Android 13+ notification denial disables posting notifications but keeps the question workflow usable and non-blocked.
- `apps/androidDeveloperInstallDocs.test.ts` — `native Android developer install documentation > documents build/install commands, server URL guidance, emulator fallback, and evidence limitations`
  - Specifies `apps/android/README.md` as the developer handoff doc location.
  - Checks for Gradle build/test command guidance, `adb install -r` debug APK command, Tailnet HTTPS URL guidance, emulator `10.0.2.2` localhost fallback, evidence limitations, and native/Web Push limitation notes.

## commandsRun
- `git status --short --untracked-files=all && git diff --cached --stat` — passed; no staged files. Worktree contains untracked Android/docs plan files from Units 01-05.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*'` — failed as expected for RED.
- `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — failed as expected for RED.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew assembleDebug` — passed; production Android debug APK assembly remains green because Unit 05 tests are test-source only.
- `npx vitest run apps/androidScaffold.test.ts` — passed; existing Android scaffold static checks remain green.
- `test ! -f apps/android/README.md && echo 'apps/android/README.md missing as expected for RED' && git diff --cached --stat` — passed; confirmed missing docs and no staged files.

## validationOutput
Targeted notification JVM RED:

```text
> Task :app:compileDebugUnitTestKotlin FAILED
e: .../PendingQuestionNotificationTrackerTest.kt:15:23 Unresolved reference 'PendingQuestionNotificationTracker'.
e: .../PendingQuestionNotificationTrackerTest.kt:16:32 Unresolved reference 'NotificationTapTargetFactory'.
e: .../PendingQuestionNotificationTrackerTest.kt:24:23 Unresolved reference 'PendingQuestionNotification'.
e: .../PendingQuestionNotificationTrackerTest.kt:44:13 Unresolved reference 'NotificationTapTarget'.
e: .../PendingQuestionNotificationTrackerTest.kt:95:28 Unresolved reference 'NotificationPermissionState'.
BUILD FAILED in 1s
```

This is the expected RED because the Unit 05 app notification/event layer, tap target model, and permission availability model do not exist yet.

Developer install docs RED:

```text
FAIL  apps/androidDeveloperInstallDocs.test.ts > native Android developer install documentation > documents build/install commands, server URL guidance, emulator fallback, and evidence limitations
AssertionError: apps/android/README.md should exist for developer APK install handoff: expected false to be true
Test Files  1 failed (1)
Tests  1 failed (1)
```

This is the expected RED because no developer install handoff doc exists at `apps/android/README.md` yet.

Feasibility/pass evidence:

```text
cd apps/android && ./gradlew assembleDebug
BUILD SUCCESSFUL in 924ms
35 actionable tasks: 35 up-to-date
```

```text
npx vitest run apps/androidScaffold.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)
```

## residualRisks
- Existing Android JVM tests cannot be run while the new Unit 05 notification tests intentionally fail at test compilation; `assembleDebug` was run instead to confirm production build remains green.
- The notification public interface is test-specified as a small app-owned decision layer (`PendingQuestionNotificationTracker`, `PendingQuestionNotification`, `NotificationTapTarget`, `NotificationPermissionState`). The GREEN implementer may choose equivalent names only if tests are updated intentionally with the same behavior.
- No emulator/device notification tap smoke is possible in this RED pass; this remains covered by JVM decision tests plus future Android implementation/build evidence.

## noStagedFiles
true

`git diff --cached --stat` produced no output during the RED checks. This artifact was written but not staged.
