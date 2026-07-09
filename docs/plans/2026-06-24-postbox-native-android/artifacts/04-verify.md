# 04 — VERIFY: Native question UI/prototype workflow after repair

## result
PASS for Unit 04 native question list/detail/answer UI after repair.

## requirementsChecked
- **Verified-server workflow loads state and streams updates:** `QuestionWorkflowViewModel.start()` starts the `PostboxStateStream` and fetches `/api/state`; covered by `QuestionWorkflowViewModelTest.afterVerifiedServerUrlLoadsStateAndDisplaysPendingQuestionsAndSessions` and passing targeted JVM test XML (`tests=9 failures=0 errors=0`).
- **Active sessions and pending questions are exposed in native UI state and rendered by Compose:** `QuestionWorkflowScreen.kt` renders session summaries, open question list, selected detail, loading/empty/error/terminal/disconnected states; compile/lint/build gates passed.
- **Single-select answer flow:** submit disabled until one value is selected, selection replacement works, answer payload includes note/rationale, and refresh removes/updates the pending question; covered by `singleSelectAnswerIsDisabledUntilExactlyOneOptionIsSelectedThenSubmitsAndRefreshes`.
- **Multi-select answer flow:** submit disabled until at least one value is selected, multiple selected values are preserved in order, and toggling all values off disables submit again; covered by `multiSelectAnswerRequiresAtLeastOneSelectedOptionAndAllowsMultipleValues`.
- **In-flight answer repair:** second submit while the answer request is suspended is rejected and does not send a duplicate POST; covered by `answerSubmitIsDisabledWhileRequestIsInFlightAndDoesNotPostTwice`.
- **Cancel flow and cancel-conflict repair:** cancel posts `AskCancelPayload`, refreshes latest state, shows cancelled terminal state on success, and maps 409/already-resolved cancel conflicts to refresh + `ALREADY_RESOLVED` terminal message; covered by `cancelQuestionPostsCancelPayloadAndRefreshesToLatestState` and `alreadyResolvedCancelConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion`.
- **Already-resolved answer conflict:** 409 answer conflict refreshes state, keeps the conflicted question visible, disables submit, and shows a non-destructive terminal message; covered by `alreadyResolvedAnswerConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion`.
- **Long prompt/context and fixed actions:** long prompt, question context, handoff problem context, and rich context remain in detail state; Compose detail card scrolls content with action buttons outside the scroll area; covered by `longQuestionAndContextRemainAvailableInVisibleQuestionState` plus source inspection.
- **Offline/disconnected preservation:** disconnected stream status updates connection state/message without clearing visible question or in-progress selection; covered by `disconnectedStreamStatePreservesCurrentlyVisibleQuestion`.
- **APK/package evidence:** debug APK exists at `apps/android/app/build/outputs/apk/debug/app-debug.apk` with package `dev.pi.postbox`, version `0.1.0`, minSdk 26, targetSdk 36, and `android.permission.INTERNET`; package dry-run summary reports `apps/android entries=0`.

## commandsRun
- `git status --short --untracked-files=all && git diff --cached --stat` — passed; no staged files. Log: `/tmp/pi-postbox-unit04-verify/00-status-before.txt`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — passed (`BUILD SUCCESSFUL in 1s`). Log: `/tmp/pi-postbox-unit04-verify/01-gradle-question-tests.txt`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed (`BUILD SUCCESSFUL in 4s`). Log: `/tmp/pi-postbox-unit04-verify/02-gradle-test-assemble-lint.txt`.
- `npx vitest run apps/androidScaffold.test.ts` — passed (`1` file, `4` tests). Log: `/tmp/pi-postbox-unit04-verify/03-vitest-android-scaffold.txt`.
- `npm test` — passed (`43` files, `236` tests). Log: `/tmp/pi-postbox-unit04-verify/04-npm-test.txt`.
- `npm run typecheck` — passed (`tsc -b`). Log: `/tmp/pi-postbox-unit04-verify/05-npm-typecheck.txt`.
- `npm run build` — passed (TypeScript build, Vite web build, copied web assets). Log: `/tmp/pi-postbox-unit04-verify/06-npm-build.txt`.
- `npm run smoke` — passed (`Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.`). Log: `/tmp/pi-postbox-unit04-verify/07-npm-smoke.txt`.
- `npm pack --dry-run --ignore-scripts --json` plus JSON summary parse — passed; summary shows `entryCount=728`, `apps/android entries=0`, `apps entries=0`. Logs: `/tmp/pi-postbox-unit04-verify/08-npm-pack-dry-run.json`, `/tmp/pi-postbox-unit04-verify/09-pack-summary.txt`.
- APK evidence command (`ls -lh`, `sha256sum`, `aapt dump badging`, `unzip -l`) — passed; APK sha256 `70afcc22e494d7430881e0098b407ecac80b5c9d9312440a57d3f224ab1173ae`. Log: `/tmp/pi-postbox-unit04-verify/10-apk-evidence.txt`.
- Test XML summary parse — passed; Unit 04 debug and release XML both report `QuestionWorkflowViewModelTest: tests=9 failures=0 errors=0 skipped=0`. Log: `/tmp/pi-postbox-unit04-verify/11-test-xml-summary.txt`.
- Lint report summary parse — passed; `lintDebug` completed with report warnings only. Log: `/tmp/pi-postbox-unit04-verify/12-lint-summary.txt`.
- Device/emulator feasibility check (`java -version`, `adb version`, `emulator -version`, `emulator -accel-check`, `adb devices -l`, `emulator -list-avds`) — completed; KVM unavailable and no attached devices. Log: `/tmp/pi-postbox-unit04-verify/13-device-emulator-check.txt`.
- Final status check before this artifact write (`git status --short --untracked-files=all; git diff --cached --stat; git diff --stat`) — passed; no staged files and no tracked diff. Log: `/tmp/pi-postbox-unit04-verify/14-status-after-gates.txt`.

## evidenceArtifacts
- Debug APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk` (`17M`, sha256 `70afcc22e494d7430881e0098b407ecac80b5c9d9312440a57d3f224ab1173ae`).
- APK badging/unzip evidence: `/tmp/pi-postbox-unit04-verify/10-apk-evidence.txt`.
- Unit 04 JVM test report: `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml` (`tests=9 failures=0 errors=0 skipped=0`).
- Full Android JVM reports: `apps/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` and `apps/android/app/build/test-results/testReleaseUnitTest/TEST-*.xml`.
- Android lint reports: `apps/android/app/build/reports/lint-results-debug.{html,txt,xml}`.
- CLI validation logs: `/tmp/pi-postbox-unit04-verify/01-gradle-question-tests.txt` through `/tmp/pi-postbox-unit04-verify/14-status-after-gates.txt`.
- Root smoke CLI proof: `/tmp/pi-postbox-unit04-verify/07-npm-smoke.txt`.
- Package dry-run proof excluding Android app: `/tmp/pi-postbox-unit04-verify/09-pack-summary.txt`.

## skippedGates
- Emulator install/runtime UI smoke and screenshots: skipped because `emulator -accel-check` reports `KVM requires a CPU that supports vmx or svm`; starting a software emulator is not safe/reliable for this verification budget.
- Real-device install/runtime UI smoke: skipped because `adb devices -l` reported no attached devices.
- Compose instrumentation/UI tests: skipped because there is no stable emulator/device path and the project currently has JVM ViewModel tests rather than Android instrumentation tests for Unit 04.

## issuesFound
None blocking or actionable for Unit 04 after repair.

Non-blocking observations:
- `lintDebug` produced warnings but did not fail: dependency/Gradle update notices, unused `R.string.app_name`, missing explicit application icon, and a `SharedPreferences.edit` KTX suggestion. These are not Unit 04 workflow blockers and are captured in `apps/android/app/build/reports/lint-results-debug.xml`.

## residualRisks
- No runtime UI screenshot/video from an emulator or physical Android device was possible on this host; evidence is JVM workflow tests, Compose compile/lint/build, APK badging, and CLI/API smoke.
- The Compose UI is not covered by instrumentation tests; behavior is primarily verified through ViewModel state/action tests and source inspection of the Compose layout.
- Android app and plan files remain untracked in this workspace, so tracked `git diff` is not useful for base-vs-branch comparison.
- The debug APK is locally built but not installed on a device in this verification pass.

## noStagedFiles
true

`git diff --cached --stat` produced no output during pre/post validation checks. This artifact was written but not staged.
