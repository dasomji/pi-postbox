# 04 — REPAIR: Native question UI accepted findings

## changedFiles
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/04-repair.md`

## testsAddedOrUpdated
- Added `QuestionWorkflowViewModelTest.answerSubmitIsDisabledWhileRequestIsInFlightAndDoesNotPostTwice` to hold the answer request suspended, prove submit state becomes disabled while in flight, and prove a second submit call does not send another answer POST.
- Added `QuestionWorkflowViewModelTest.alreadyResolvedCancelConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion` to prove cancel 409/`PostboxRequestAlreadyResolvedException` refreshes latest state, keeps the conflicted question visible when present, disables submit, and shows an already-resolved terminal message.
- Extended the recording protocol fake with a suspend hook for in-flight answer tests and `cancelError` for cancel-conflict tests.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — failed as expected after adding regression tests before the production repair: 9 tests run, 2 failed (duplicate answer in-flight state; cancel conflict handling).
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — failed during test tightening after the production repair because the duplicate-submit test over-asserted post-completion refresh timing; no production change was needed for that assertion.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — passed after narrowing the duplicate-submit regression to the accepted finding behavior.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
- `python3 - <<'PY' ... TEST-dev.pi.postbox.question.*.xml ... PY; git status --short --untracked-files=all | sed -n '1,260p'; git diff --cached --stat` — passed; confirmed Unit 04 test report counts and no staged files.

## validationOutput
```text
Initial targeted RED after repair tests:
QuestionWorkflowViewModelTest > answerSubmitIsDisabledWhileRequestIsInFlightAndDoesNotPostTwice FAILED
QuestionWorkflowViewModelTest > alreadyResolvedCancelConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion FAILED
9 tests completed, 2 failed
```

```text
Targeted Unit 04 final:
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'
BUILD SUCCESSFUL in 2s
22 actionable tasks: 2 executed, 20 up-to-date
```

```text
Full Android gate:
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 9s
74 actionable tasks: 16 executed, 58 up-to-date
```

```text
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml: tests=9 failures=0 errors=0
```

`git diff --cached --stat` produced no output.

## implementationNotes
- `submitAnswer()` now rejects calls while `isSubmitting` is true and recomputes submit eligibility with `.withSubmitState()` when entering the in-flight state, so `canSubmit` flips false immediately.
- The Compose submit button is now gated by both `actionsEnabled` and `question.canSubmit`.
- `cancelQuestion()` now catches `PostboxRequestAlreadyResolvedException` before generic `IOException` handling and mirrors answer-conflict behavior by refreshing state with `ALREADY_RESOLVED` terminal state and a terminal message.

## residualRisks
- No emulator/device or Compose instrumentation test was run; this repair is covered by JVM ViewModel tests plus debug assembly and lint.
- The Android app and plan files remain untracked in this workspace from the broader plan, so staged-file verification used `git diff --cached --stat` rather than tracked diff status.

## noStagedFiles
true
