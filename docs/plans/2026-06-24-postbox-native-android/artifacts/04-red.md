# 04 — RED: Native question list/detail/answer UI

## changedFiles
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowFixtures.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/04-red.md`

## testsAddedOrUpdated
- `QuestionWorkflowViewModelTest.afterVerifiedServerUrlLoadsStateAndDisplaysPendingQuestionsAndSessions`
  - Specifies that a workflow started from a verified server URL fetches `/api/state` via `PostboxProtocolClient`, starts the state stream, exits loading, exposes connected state, lists sessions, filters/display pending questions, and shows the first pending question as the visible detail.
- `QuestionWorkflowViewModelTest.singleSelectAnswerIsDisabledUntilExactlyOneOptionIsSelectedThenSubmitsAndRefreshes`
  - Specifies single-select detail state starts with submit disabled, selecting an option enables submit, choosing another option replaces the selection, submit posts `AskAnswerPayload` through the protocol client, then refreshes state and removes the answered question from pending UI.
- `QuestionWorkflowViewModelTest.multiSelectAnswerRequiresAtLeastOneSelectedOptionAndAllowsMultipleValues`
  - Specifies multi-select detail state enables submit after at least one option, preserves selected order, supports multiple selected values, and disables submit again when all values are toggled off.
- `QuestionWorkflowViewModelTest.cancelQuestionPostsCancelPayloadAndRefreshesToLatestState`
  - Specifies cancel posts `AskCancelPayload` through the protocol client, refreshes state, removes the cancelled question from pending UI, and exposes a cancelled terminal detail state.
- `QuestionWorkflowViewModelTest.alreadyResolvedAnswerConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion`
  - Specifies HTTP 409/`PostboxRequestAlreadyResolvedException` during answer is non-destructive: the view-model refreshes state, keeps the conflicted question visible, disables submit, exposes `ALREADY_RESOLVED`, and shows a terminal message containing the server conflict text.
- `QuestionWorkflowViewModelTest.longQuestionAndContextRemainAvailableInVisibleQuestionState`
  - Specifies long prompt, question context, handoff problem context, and rich context content remain untruncated and accessible in visible question UI state while submit/cancel actions remain represented.
- `QuestionWorkflowViewModelTest.disconnectedStreamStatePreservesCurrentlyVisibleQuestion`
  - Specifies a disconnected SSE stream status updates connection state/message without clearing the visible question or the in-progress selection.
- `QuestionWorkflowFixtures.kt`
  - Adds test-only protocol DTO fixtures for live/offline sessions, single/multi pending requests, answered/cancelled terminal snapshots, and long context requests.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*' --tests 'dev.pi.postbox.onboarding.*'` — passed before adding Unit 04 RED tests; confirms Unit 02/03 JVM tests were green at the starting point.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — failed as expected for RED with missing Unit 04 question workflow public API.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew assembleDebug` — passed after RED tests were added; production Android build remains intact.
- `npx vitest run apps/androidScaffold.test.ts` — passed after RED tests were added; Unit 01 scaffold/package-safety test remains intact.
- `git status --short && git diff --cached --stat` — passed; shows only untracked worktree files and no staged files.

## validationOutput
Targeted Unit 02/03 pre-RED sanity:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*' --tests 'dev.pi.postbox.onboarding.*'
BUILD SUCCESSFUL in 3s
22 actionable tasks: 1 executed, 21 up-to-date
```

Targeted Unit 04 RED:

```text
> Task :app:compileDebugUnitTestKotlin FAILED
e: .../QuestionWorkflowViewModelTest.kt:28:25 Unresolved reference 'QuestionWorkflowViewModel'.
e: .../QuestionWorkflowViewModelTest.kt:41:22 Unresolved reference 'QuestionConnectionState'.
e: .../QuestionWorkflowViewModelTest.kt:135:22 Unresolved reference 'QuestionTerminalState'.
e: .../QuestionWorkflowViewModelTest.kt:194:129 Unresolved reference 'QuestionAction'.
e: .../QuestionWorkflowViewModelTest.kt:227:8 Unresolved reference 'QuestionWorkflowViewModel'.

FAILURE: Build failed with an exception.
* What went wrong:
Execution failed for task ':app:compileDebugUnitTestKotlin'.
```

The full compiler output also includes cascaded unresolved members (`state`, `selectQuestion`, `toggleOption`, `submitAnswer`, `cancelQuestion`, and typed list item properties) because the expected Unit 04 public view-model/UI-state surface does not exist yet. This is the intended RED failure.

Production Android build after RED tests:

```text
cd apps/android && ./gradlew assembleDebug
BUILD SUCCESSFUL in 960ms
35 actionable tasks: 35 up-to-date
```

Unit 01 scaffold/package-safety check after RED tests:

```text
npx vitest run apps/androidScaffold.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)
```

No staged files:

```text
git status --short && git diff --cached --stat
?? apps/android/
?? apps/androidScaffold.test.ts
?? docs/plans/2026-06-24-postbox-native-android/
```

`git diff --cached --stat` produced no output.

## whyThisIsRED
The targeted Unit 04 JVM test task reaches `:app:compileDebugKotlin` successfully and fails only when compiling the new question workflow tests. The unresolved symbols are the missing Unit 04 public behavior surface: `QuestionWorkflowViewModel`, UI connection/terminal/action state types, and their public methods/properties for loading state, selecting questions/options, submitting/cancelling, conflict handling, long context exposure, and disconnected-state preservation. `assembleDebug` still passes, so the failure is isolated to the missing native question UI/view-model behavior rather than a broken Android project.

## residualRisks
- These are JVM view-model/state tests only. I did not add Compose UI tests because the current project has no Compose test dependencies or device/emulator-stable instrumentation path, and the requested behavior can be specified through UI state without widening scope.
- The tests define a concrete app-owned public API shape for GREEN: `QuestionWorkflowViewModel`, `QuestionConnectionState`, `QuestionTerminalState`, `QuestionAction`, and UI-state models with session, pending-question, visible-question, terminal-message, and connection fields. GREEN may adjust names only by deliberately updating the RED contract while preserving behavior.
- Because RED tests intentionally fail at test compilation, full Android `testDebugUnitTest` cannot run green again until Unit 04 production APIs exist. Prior Unit 02/03 targeted tests were run before adding RED and production `assembleDebug` still passes afterward.

## noStagedFiles
true

`git diff --cached --stat` produced no output.
