# Final repair — cancel in-flight re-entry guard

## changedFiles
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/final-repair.md`

## testsAddedOrUpdated
- Added `QuestionWorkflowViewModelTest.cancelIsIgnoredWhileRequestIsInFlightAndDoesNotPostTwice`.
- Extended `RecordingPostboxProtocolClient` with `beforeCancelCompletes` so the cancel request can remain suspended while asserting that a second cancel call does not POST again.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'` — passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
- `python3 - <<'PY' ... TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml ... PY` — passed; parsed question workflow test report counts.
- `git status --short --untracked-files=all && git diff --cached --stat && git diff --stat` — passed; no staged files and no tracked diff output because the Android/prototype plan tree remains untracked.

## validationOutput
```text
Targeted question class:
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'
BUILD SUCCESSFUL in 2s
22 actionable tasks: 5 executed, 17 up-to-date
```

```text
Targeted question package:
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'
BUILD SUCCESSFUL in 1s
22 actionable tasks: 1 executed, 21 up-to-date
```

```text
Full Android gate:
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 9s
74 actionable tasks: 16 executed, 58 up-to-date
```

```text
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml: tests=14 failures=0 errors=0 skipped=0
```

`git diff --cached --stat` produced no output.

## implementationNotes
- Added the same public-boundary in-flight guard to `cancelQuestion()` that `submitAnswer()` already had: a second cancel returns immediately while `visible.isSubmitting` is true.
- Kept answer duplicate prevention intact; the targeted question suite still includes and passes `answerSubmitIsDisabledWhileRequestIsInFlightAndDoesNotPostTwice`.
- Did not widen scope into lifecycle, notification, UI, or protocol changes.

## residualRisks
- No physical Android device or reliable emulator was available here, so runtime notification/UI behavior remains JVM/build/lint verified rather than device-smoke verified.
- The Android app and plan artifacts remain untracked in this workspace, so conventional tracked diff summaries are limited.

## noStagedFiles
true
