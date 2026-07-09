# 05 — REPAIR 2: Lifecycle-gate notification/SSE observation

## result
PASS

Repaired the Unit 05 verification blocker without adding a foreground service. The native Android question workflow now starts SSE observation only while the Activity lifecycle is at least `STARTED`, closes the stream on `ON_STOP`, and can restart safely on the next `ON_START`. The view-model also carries an explicit active observation flag so snapshots that complete after the Activity has stopped do not update the notification tracker or post local notifications.

## changedFiles
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/05-repair-2.md`

## testsAddedOrUpdated
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt` — added `closingWorkflowStopsObservationSuppressesBackgroundNotificationsAndCanRestart`, covering inactive suppression, stream close, restart, and resumed foreground notification behavior.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'` — passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*' --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'` — passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
- `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — passed.

## validationOutput
- Targeted question workflow test: `BUILD SUCCESSFUL in 4s`, 22 actionable tasks, 5 executed.
- Targeted notification/question tests: `BUILD SUCCESSFUL in 1s`, 22 actionable tasks, 1 executed.
- Full Android gate: `BUILD SUCCESSFUL in 10s`, 74 actionable tasks, 17 executed. APK assembled at `apps/android/app/build/outputs/apk/debug/app-debug.apk`; lintDebug completed and wrote the normal HTML report.
- Docs Vitest: 1 file / 1 test passed in 233ms on final run.
- Gradle emitted existing coroutine test opt-in warnings from `QuestionWorkflowViewModelTest`; no new failure or lint blocker was reported.

## residualRisks
- No physical Android device or working emulator is attached in this environment, so installed-app lifecycle/notification tray behavior remains source/JVM/build verified rather than device-smoke verified.
- Android app files and plan artifacts are untracked in this workspace, matching the prior Unit 05 verification state, so conventional tracked-file diff tooling is limited.

## noStagedFiles
true
