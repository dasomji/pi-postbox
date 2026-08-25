# Android Question Chat polish pass v3 report

## Scope completed

Completed on the current branch after inspecting the interrupted diff first and keeping only the useful production/test work:
- While generating, the composer action now swaps in-place from Send/Steer to a Stop icon button in the same circular slot, with accessible label `Stop` and no separate Stop button.
- The chat transcript is now a bounded weighted `LazyColumn` history above a bottom composer, with one production IME inset ownership path on the composer.
- Starter answers are now compact visual pills with preserved button semantics and 48dp minimum interactive height.
- The Question action row now uses web-matching copy and hierarchy: `Submit` + icon and `Add note` + icon on one responsive row, with `Cancel` below.
- Added focused Compose/instrumentation coverage for:
  - send/stop action swapping in one slot
  - compact starter semantics vs visual size
  - one-row Submit/Add note copy and layout
  - bounded real-IME probe/geometry seam with bounded skip instead of hanging the emulator
- Preserved the useful screenshot/evidence harness, removed the unused `TestComposeImeActivity` / androidTest manifest experiment, and kept the minimal debug host activity actually used by the committed instrumentation.

## Library rationale

Researched maintained chat UI kits before editing.

Not adopted:
- GetStream `stream-chat-android-ai-compose` / `ChatComposer`

Reason:
- it is maintained and does cover keyboard/composer/chat concerns,
- but it pulls in Stream-specific licensing/ecosystem assumptions plus attachment/voice/message abstractions and a visual/state model this app would mostly override,
- while backend-neutral maintained Compose chat kits remain sparse for this narrow app-owned Question Chat.

Decision:
- keep the app-owned UI,
- use the standard bounded `LazyColumn` + anchored composer pattern from current Compose inset guidance,
- preserve the existing deep owner / safe renderer architecture.

Compose insets reference consulted before editing:
- fetched Compose inset-consumption guidance under `/tmp/rpiv-fetch-S93HR6/content.txt` (nested `imePadding` / inset consumption behavior)
- accepted workspace contract in `docs/prototypes/2026-07-29-android-question-chat-workspace.md`
- current interrupted task brief in `/tmp/android-chat-polish3.md`
- rereview findings in `/tmp/android-chat-t1-rereview-report.md`

## Diff inspection performed first

Inspected the full interrupted working tree before changing anything:
- `git status --short`
- `git diff --stat`
- full diffs for all modified tracked files
- contents of the new androidTest/debug harness files
- current production/test files and the web action row source

## Changed files

Production:
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/ui/theme/PostalDecorations.kt`

Compose/instrumentation tests:
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatImeGeometryTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatEvidenceCaptureTest.kt`
- `apps/android/app/src/debug/AndroidManifest.xml`
- `apps/android/app/src/debug/java/dev/pi/postbox/question/QuestionTestHostActivity.kt`

Docs:
- `IMPLEMENTATION_REPORT.md`

## Evidence

Evidence directory:
- `/tmp/android-chat-ui-evidence-v3/`

Captured after screenshots:
- `after-idle-composer.png`
- `after-generating-stop-composer.png`
- `after-starter-pills.png`
- `after-question-action-row.png`

Retained before screenshots:
- `before-idle-composer.png`
- `before-generating-stop-composer.png`
- `before-starter-pills.png`
- `before-question-action-row.png`
- `before-keyboard-visible.png`

Important IME note:
- The committed `QuestionChatImeGeometryTest` performs a bounded real-IME probe on `emulator-5554` and skips instead of hanging when this API-26 headless emulator never surfaces a software keyboard.
- I did **not** fabricate an `after-keyboard-visible.png` screenshot on this runner.
- See `/tmp/android-chat-ui-evidence-v3/NOTES.md`.

## Commands run

Environment / repo inspection:
- `env | sort | grep '^PI_'`
- `git status --short`
- `git diff --stat`
- full `git diff ...` over the interrupted file set
- `read`, `grep`, `find`, `ls`

Focused verification:
- `cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.QuestionWorkflowQuestionChatTest' --tests 'dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest'`
- `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class='dev.pi.postbox.question.QuestionChatUiTest,dev.pi.postbox.question.QuestionWorkflowScreenTest,dev.pi.postbox.question.QuestionChatImeGeometryTest'`

Evidence capture:
- `cd apps/android && ./gradlew installDebug installDebugAndroidTest`
- `adb -s emulator-5554 shell am instrument -w -e class dev.pi.postbox.question.QuestionChatEvidenceCaptureTest -e prefix after dev.pi.postbox.test/androidx.test.runner.AndroidJUnitRunner`
- `adb -s emulator-5554 exec-out run-as dev.pi.postbox cat /data/user/0/dev.pi.postbox/files/android-chat-ui-evidence-v3/<file> > /tmp/android-chat-ui-evidence-v3/<file>`

Emulator recovery / bounded retry work:
- restarted the API-26 emulator with bounded waits after System UI ANR loops during IME experiments:
  - `/home/dev/Android/Sdk/emulator/emulator @postbox_api26_tcg -no-window -no-snapshot-load -no-snapshot-save -gpu swiftshader_indirect -accel off`

Final Android gates:
- `cd apps/android && ./gradlew testDebugUnitTest connectedDebugAndroidTest lintDebug assembleDebug assembleDebugAndroidTest`

Diff hygiene:
- `git diff --check`

## Validation status

Passed:
- focused JVM tests for `QuestionWorkflowQuestionChatTest` and `QuestionChatWorkspaceShellTest`
- focused connected tests for `QuestionChatUiTest` and `QuestionWorkflowScreenTest`
- full Android gates:
  - `testDebugUnitTest`
  - `connectedDebugAndroidTest`
  - `lintDebug`
  - `assembleDebug`
  - `assembleDebugAndroidTest`

Skipped by design after bounded probing:
- `QuestionChatImeGeometryTest`
- `QuestionChatEvidenceCaptureTest` cases in the default full suite (they require explicit evidence prefix)

## Residual notes

- The API-26 headless emulator on this runner never surfaced a real IME under bounded automation, even after switching soft keyboards and restarting the emulator without snapshots. The committed IME probe now skips rather than hanging the suite or fabricating proof.
- `LocalClipboardManager` deprecation warnings remain outside this polish slice.
- No push performed.
- No PR opened.
