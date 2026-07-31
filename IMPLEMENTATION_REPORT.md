# Android Question Chat UI overhaul report

## Scope completed

Completed on the current branch, test-first:
- Reworked the native Android Question Chat workspace layout to follow the existing web/mobile web hierarchy instead of the previous native/prototype structure.
- Moved Question/Question Chat navigation to a bottom workspace bar after activation.
- Collapsed the Chat header into the web-style hierarchy: title, coarse state chip, optional context-only disclosure, separate offline/stale banner, transcript, starters, composer/actions, model disclosure.
- Replaced full-width labeled message cards with web-style transcript bubbles/rows.
- Replaced the old tool section with compact bounded tool rows using friendly web labels (`Read`, `Grep`, `Find`, `List`) and separate details/review actions.
- Removed duplicate starter rows and kept starters only in the empty-chat state.
- Changed active-turn controls to web-style `Send` + separate `Stop` instead of the prior stacked `Stop` + `Steer` buttons.
- Kept existing owner/transport/state contracts intact; only Compose presentation and test seams changed.

## Source inspection performed before editing

Inspected the complete relevant web implementation and state/layout behavior:
- `apps/web/src/components/QuestionChatActivation.svelte`
- `apps/web/src/components/QuestionDetail.svelte`
- `apps/web/src/components/QuestionWorkspace.test.ts`
- `apps/web/src/lib/layout.svelte.ts`
- `apps/web/src/components/QuestionLayoutSpotlight.svelte`
- `apps/web/src/styles.css`

Inspected native Android implementation/prototype inputs:
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShell.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `docs/prototypes/2026-07-29-android-question-chat-workspace.md`
- `docs/prototypes/assets/android-question-chat-workspace/*`

Assumption recorded:
- Where the accepted Android prototype and current web/mobile web hierarchy diverged, I followed the user’s explicit instruction to copy the existing web Question Chat hierarchy/placement as faithfully as made sense on mobile while preserving the Android postal theme.

## Changed files

- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `IMPLEMENTATION_REPORT.md`

## Screenshot evidence

Captured seeded deterministic before/after PNGs under:
- `/tmp/android-chat-ui-evidence/`

Files:
- `before-empty-ready.png`
- `before-streaming-tools.png`
- `before-terminal-response.png`
- `after-empty-ready.png`
- `after-streaming-tools.png`
- `after-terminal-response.png`

Notes:
- Baseline screenshots were captured from a detached worktree at the pre-change branch HEAD using manual installed instrumentation execution.
- Screenshots were not committed.

## Commands run

- `env | sort | grep '^PI_' || true`
- repo/file inspection with `find`, `grep`, and `read`
- `cd apps/android && adb devices -l`
- `cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest' --tests 'dev.pi.postbox.question.QuestionChatUiTest'`
- `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.pi.postbox.question.QuestionChatUiTest`
- `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionWorkflowScreenTest#pendingQuestionShowsStartQuestionChatEntryAndStartsWhenTapped,dev.pi.postbox.question.QuestionWorkflowScreenTest#exactForkFailureRequiresExplicitContextOnlyConfirmation,dev.pi.postbox.question.QuestionWorkflowScreenTest#activatedQuestionChatShowsTabsStartersAndComposerCallbacks,dev.pi.postbox.question.QuestionWorkflowScreenTest#activatedQuestionChatPinsWorkspaceTabsNearTheBottomEdge'`
- `cd apps/android && ./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest`
- `cd apps/android && ./gradlew installDebug installDebugAndroidTest`
- `adb shell am instrument -w -e class dev.pi.postbox.question.QuestionChatEvidenceTest dev.pi.postbox.test/androidx.test.runner.AndroidJUnitRunner` (manual evidence capture; helper removed afterward)
- equivalent temporary baseline install/instrument commands from a detached worktree for pre-change screenshots

## Validation status

Passed:
- `cd apps/android && ./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest`
- Connected focused emulator tests on `emulator-5554`:
  - `dev.pi.postbox.question.QuestionChatUiTest`
  - `QuestionWorkflowScreenTest#pendingQuestionShowsStartQuestionChatEntryAndStartsWhenTapped`
  - `QuestionWorkflowScreenTest#exactForkFailureRequiresExplicitContextOnlyConfirmation`
  - `QuestionWorkflowScreenTest#activatedQuestionChatShowsTabsStartersAndComposerCallbacks`
  - `QuestionWorkflowScreenTest#activatedQuestionChatPinsWorkspaceTabsNearTheBottomEdge`

Not run:
- Full connected Android test suite; only focused Question Chat coverage was requested/run.

## Residual risks / notes

- Existing unrelated Android instrumentation flake/coverage outside the focused Question Chat slice was not broadened here.
- Existing `LocalClipboardManager` deprecation warnings remain outside this slice.
- No transport/domain contract changes were made.
- No push performed.
- No PR opened.
