# Android Question Chat polish pass v2 report

## Scope completed

Completed on the current branch, test-first:
- Removed the visible `Question Chat` header/title and the ready/state pill.
- Replaced chat status chrome with a single accessibility-described workspace border:
  - green when connected/usable
  - red when offline/stale/unavailable/not yet usable
- Removed the large outer white chat card and used the screen background directly.
- Replaced the text `Send` action with a circular send bubble icon while preserving accessible `Send` / `Steer` labels.
- Kept `Stop` available in generating/stopping states.
- Made the bottom `Question` / `Chat` nav always visible for pending questions before activation.
- Renamed the second tab to `Chat` and removed the dedicated in-question Chat button.
- Wired preactivation Chat tab taps to explicit exact-fork activation, with loading/error/context-fallback states rendered inside the Chat tab.
- Styled `Add a note` to match the web spotlight action more closely.
- Switched the activity to `adjustResize` and removed the extra composer IME padding so the composer stays anchored above the resized bottom area instead of double-padding upward.
- Updated JVM + Compose/instrumentation seams for:
  - workspace/tab behavior before activation
  - explicit activation selection
  - border status behavior
  - send/steer accessibility labels
  - removal of legacy header/pill/button chrome
  - preserved callbacks and bottom placement

## Source inspection performed before editing

Inspected the relevant native/web/source evidence first:
- `CONTEXT.md`
- `IMPLEMENTATION_REPORT.md`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShell.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowQuestionChatTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShellTest.kt`
- `apps/web/src/components/QuestionLayoutSpotlight.svelte`
- `apps/web/src/components/QuestionDetail.svelte`
- `apps/web/src/components/QuestionChatActivation.svelte`
- `apps/web/src/styles.css`
- existing screenshot evidence under `/tmp/android-chat-ui-evidence/`

## Changed files

- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShell.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/ui/theme/PostalDecorations.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowQuestionChatTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShellTest.kt`
- `IMPLEMENTATION_REPORT.md`

Note:
- Temporary screenshot-only instrumentation helpers were created, used, and removed before final validation.
- A temporary detached-HEAD worktree was used to capture the `before-*` evidence from the pre-change code.

## Screenshot evidence

Captured readable before/after screenshots under:
- `/tmp/android-chat-ui-evidence-v2/`

Files:
- `before-ready.png`
- `after-ready.png`
- `before-disconnected.png`
- `after-disconnected.png`
- `before-composer-ime.png`
- `after-composer-ime.png`
- `before-preactivation-question-bottom-nav.png`
- `after-preactivation-question-bottom-nav.png`

IME note:
- The composer focus/inset evidence was captured on `emulator-5554` after tapping the composer on API 26 with `show_ime_with_hard_keyboard=1` and resize mode enabled.
- On this emulator build, the reserved IME space was reflected in the app layout during capture, but the software keyboard surface itself was not included in the screenshot output.

## Commands run

- environment / repo inspection:
  - `env | grep '^PI_' | sort`
  - `git status --short --branch`
  - `ls`, `find`, `grep`, `read`
- focused red phase:
  - `cd apps/android && ./gradlew testDebugUnitTest connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionChatUiTest,dev.pi.postbox.question.QuestionWorkflowScreenTest'`
- focused JVM validation:
  - `cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.QuestionWorkflowQuestionChatTest' --tests 'dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest'`
- focused connected validation:
  - `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionChatUiTest,dev.pi.postbox.question.QuestionWorkflowScreenTest'`
- before evidence capture from temporary worktree at pre-change `HEAD`:
  - `git worktree add /tmp/pi-postbox-android-chat-before HEAD`
  - `adb -s emulator-5554 shell settings put secure show_ime_with_hard_keyboard 1`
  - `cd /tmp/pi-postbox-android-chat-before/apps/android && ./gradlew installDebug installDebugAndroidTest`
  - `adb -s emulator-5554 shell am instrument -w -e class dev.pi.postbox.question.QuestionChatEvidenceCaptureTest -e prefix before dev.pi.postbox.test/androidx.test.runner.AndroidJUnitRunner`
  - `adb -s emulator-5554 exec-out run-as dev.pi.postbox cat /data/user/0/dev.pi.postbox/files/android-chat-ui-evidence-v2/<before-file> > /tmp/android-chat-ui-evidence-v2/<before-file>`
  - `git worktree remove /tmp/pi-postbox-android-chat-before --force`
- after evidence capture on current code:
  - `cd apps/android && ./gradlew installDebug installDebugAndroidTest`
  - `adb -s emulator-5554 shell am instrument -w -e class dev.pi.postbox.question.QuestionChatEvidenceCaptureTest -e prefix after dev.pi.postbox.test/androidx.test.runner.AndroidJUnitRunner`
  - `adb -s emulator-5554 exec-out run-as dev.pi.postbox cat /data/user/0/dev.pi.postbox/files/android-chat-ui-evidence-v2/<after-file> > /tmp/android-chat-ui-evidence-v2/<after-file>`
- final full Android gates:
  - `cd apps/android && ./gradlew testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug assembleDebugAndroidTest`
- diff hygiene:
  - `git diff --check`

## Validation status

Passed:
- Focused JVM tests for `QuestionWorkflowQuestionChatTest` and `QuestionChatWorkspaceShellTest`
- Focused connected Compose/instrumentation tests for `QuestionChatUiTest` and `QuestionWorkflowScreenTest` on `emulator-5554`
- Full Android gates:
  - `cd apps/android && ./gradlew testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug assembleDebugAndroidTest`

## Residual risks / notes

- `LocalClipboardManager` deprecation warnings remain outside this UI slice.
- The old in-question activation helper functions were removed from the active path; Chat activation now happens through the persistent bottom nav / workspace shell path.
- No push performed.
- No PR opened.
