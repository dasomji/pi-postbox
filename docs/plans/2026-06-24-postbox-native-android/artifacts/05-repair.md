# 05 — REPAIR: Active-app local notifications

## changedFiles
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/notification/AndroidPendingQuestionNotifier.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/notification/PendingQuestionNotificationTracker.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/res/drawable/ic_postbox_notification.xml`
- `apps/android/app/src/test/java/dev/pi/postbox/notification/PendingQuestionNotificationTrackerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt`
- `apps/android/README.md`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/05-repair.md`

## testsAddedOrUpdated
- `PendingQuestionNotificationTrackerTest.tapTargetDeepLinkRoundTripsUrlEncodedRequestIds`
- `PendingQuestionNotificationTrackerTest.android13NotificationPermissionPolicyRequestsPermissionAndDenialDoesNotBlockWorkflow`
- `PendingQuestionNotificationTrackerTest.preAndroid13NotificationPermissionPolicyDoesNotRequireRuntimePermission`
- `QuestionWorkflowViewModelTest.fetchedBaselineAndSseSnapshotsNotifyOnlyForNewlyObservedPendingQuestions`
- `QuestionWorkflowViewModelTest.notificationTapSelectsRelevantQuestionWhenItIsStillPresent`
- `QuestionWorkflowViewModelTest.deniedNotificationPermissionIsShownWithoutBlockingQuestionWorkflow`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*' --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'` — failed once for a transient syntax error in `QuestionWorkflowScreen.kt`, then passed after fixing the extra parenthesis.
- `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
- `git diff --cached --stat && git status --short --untracked-files=all | grep -E '05-repair|AndroidPendingQuestionNotifier|ic_postbox_notification|MainActivity|QuestionWorkflowViewModel|QuestionWorkflowScreen|PendingQuestionNotificationTracker|README.md|AndroidManifest'` — passed; `git diff --cached --stat` produced no output and the touched files are unstaged/untracked in this workspace.

## validationOutput
Targeted notification/question JVM tests after repair:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*' --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'
BUILD SUCCESSFUL in 2s
22 actionable tasks: 5 executed, 17 up-to-date
```

Docs Vitest:

```text
npx vitest run apps/androidDeveloperInstallDocs.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
```

Full Android gate with explicit SDK env:

```text
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 12s
74 actionable tasks: 28 executed, 46 up-to-date
```

## implementationNotes
- `QuestionWorkflowViewModel` now accepts a `PendingQuestionNotificationTracker` and notification callback, observes every fetched/SSE snapshot, and posts only newly observed pending request ids after the first baseline snapshot.
- `MainActivity` wires the tracker to an Android notifier while the connected workflow is active, requests Android 13+ notification permission, keeps permission denial non-blocking, and handles notification tap intents via `onCreate`/`onNewIntent`.
- `AndroidPendingQuestionNotifier` creates a notification channel, checks `POST_NOTIFICATIONS`, posts privacy-preserving local notifications with a small icon, and uses an explicit `PendingIntent` back to `MainActivity` carrying the request id.
- Notification taps call `openQuestionFromNotification`, which selects the relevant question when it is available in the latest/next observed snapshot.
- The README now describes the implemented active-app local notification behavior and states that there is still no FCM, background push, foreground service, or always-on sync.

## residualRisks
- No emulator or physical-device smoke was run; notification tray rendering and tap delivery are validated by build/JVM wiring tests only.
- Local notifications only work while the app is running the connected question workflow and observing fetched/SSE state; no FCM/background push/foreground service is implemented.
- Android 13+ users can deny notification permission; the app shows disabled status and remains usable, but no notification is posted until permission is granted in system settings.
- The Android app tree remains untracked in this repository state, so `git diff` does not show a conventional tracked diff for these files.

No staged files check:

```text
git diff --cached --stat
# no output
```

## noStagedFiles
true
