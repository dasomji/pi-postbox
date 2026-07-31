# Android Question Chat web parity repair report

## Scope completed

Completed on the current branch, test-first:
- Moved the pre-activation `Chat` entry out of the question body and into the existing Question action cluster, matching mobile web placement while keeping tabs hidden until activation.
- Replaced the old inline Question Chat starter card with inline activation/failure states on the Question surface, including explicit context-only confirmation copy aligned to web behavior.
- Changed proposal follow-up copy from `Review in Question` to `View in Question`.
- Removed the non-web `Jump to latest` affordance while keeping the existing near-bottom transcript auto-scroll behavior.
- Added/updated Compose assertions for:
  - pre-activation Question action placement with hidden tabs
  - returning to the Question after tab switching
  - exact-fork failure plus explicit context-only confirmation
  - proposal action copy and absence of the jump affordance
- Refreshed after screenshots under `/tmp/android-chat-ui-evidence`, including the requested Question/failure states.
- Repaired the queue pull-to-refresh instrumentation seam so the full connected Android test suite passes on emulator-5554.

## Source inspection performed before editing

Inspected the review and the relevant web/native implementations:
- `/tmp/android-chat-web-parity-review.md`
- `apps/web/src/components/QuestionDetail.svelte`
- `apps/web/src/components/QuestionLayoutSpotlight.svelte`
- `apps/web/src/components/QuestionChatActivation.svelte`
- `apps/web/src/components/QuestionWorkspace.test.ts`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShellTest.kt`

## Changed files

- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `IMPLEMENTATION_REPORT.md`

Note:
- A temporary instrumentation helper was created only to capture screenshots, then removed before final validation.

## Screenshot evidence

Captured readable after PNGs under:
- `/tmp/android-chat-ui-evidence/`

Files:
- `after-question-before-activation.png`
- `after-question-after-tab-return.png`
- `after-exact-fork-failure-context-only-confirmation.png`
- `after-empty-ready.png`
- `after-streaming-tools.png`
- `after-terminal-response.png`

## Commands run

- `env | grep '^PI_' | sort || true`
- repo/file inspection with `ls`, `grep`, and `read`
- `cd apps/android && adb devices -l`
- red phase:
  - `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionWorkflowScreenTest,dev.pi.postbox.question.QuestionChatUiTest'`
- focused green phase:
  - `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionWorkflowScreenTest#pendingQuestionShowsChatActionInTheQuestionClusterAndKeepsTabsHiddenBeforeActivation,dev.pi.postbox.question.QuestionWorkflowScreenTest#exactForkFailureKeepsQuestionVisibleAndRequiresExplicitContextOnlyConfirmation,dev.pi.postbox.question.QuestionWorkflowScreenTest#activatedQuestionChatShowsTabsLetsYouReturnToQuestionAndPreservesChatCallbacks,dev.pi.postbox.question.QuestionChatUiTest#proposalActionsUseWebCopyAndTranscriptOverflowShowsNoJumpAffordance,dev.pi.postbox.question.QuestionChatUiTest#generatingChatMatchesTheWebActionHierarchy'`
- focused connected validation on emulator-5554:
  - `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionChatUiTest,dev.pi.postbox.question.QuestionWorkflowScreenTest#pendingQuestionShowsChatActionInTheQuestionClusterAndKeepsTabsHiddenBeforeActivation,dev.pi.postbox.question.QuestionWorkflowScreenTest#exactForkFailureKeepsQuestionVisibleAndRequiresExplicitContextOnlyConfirmation,dev.pi.postbox.question.QuestionWorkflowScreenTest#activatedQuestionChatShowsTabsLetsYouReturnToQuestionAndPreservesChatCallbacks,dev.pi.postbox.question.QuestionWorkflowScreenTest#activatedQuestionChatPinsWorkspaceTabsNearTheBottomEdge'`
- screenshot capture:
  - `cd apps/android && ./gradlew installDebug installDebugAndroidTest`
  - `adb shell am instrument -w -e class dev.pi.postbox.question.QuestionChatEvidenceCaptureTest dev.pi.postbox.test/androidx.test.runner.AndroidJUnitRunner`
  - `adb exec-out run-as dev.pi.postbox cat /data/user/0/dev.pi.postbox/files/android-chat-ui-evidence/<file> > /tmp/android-chat-ui-evidence/<file>`
- full Android test/lint/build/APK gates:
  - `cd apps/android && ./gradlew testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug assembleDebugAndroidTest installDebug installDebugAndroidTest`

## Validation status

Passed:
- Focused connected tests on `emulator-5554` for the affected Question Chat/UI assertions
- `cd apps/android && ./gradlew testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug assembleDebugAndroidTest installDebug installDebugAndroidTest`

## Residual risks / notes

- `LocalClipboardManager` deprecation warnings remain outside this slice.
- Screenshot helpers were not committed.
- No push performed.
- No PR opened.
