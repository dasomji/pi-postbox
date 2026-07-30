# Android Question Chat tracer implementation report

## Scope completed

Reached another clean committed boundary with a user-visible Compose tracer on top of the existing owner/shell/safe-Markdown foundation.

Completed in this continuation:
- Extended `QuestionChatOwner` with:
  - owner-generated Stop command ids
  - authoritative send acknowledgement copy (`turn` / `steer` messaging)
  - gap-triggered fresh snapshot resynchronization
  - bounded event application caps for assistant text/messages/tools
- Rendered the mobile Question/Question Chat workspace in Compose:
  - hidden-until-usable **Start Question Chat** entry on the Question surface
  - explicit exact-fork failure + context-only confirmation flow
  - Question / Question Chat tab row after activation or discovery
  - Android Back from Chat to Question through the existing shell/viewmodel seam
  - anchored bounded multiline composer with Send / Steer / Stop
  - deterministic Elaborate / Pro–Cons / Teach me starters
  - authoritative plain-text streaming transcript
  - terminal safe-Markdown rendering for final/stopped/interrupted assistant messages
  - exact/context/model disclosure card
  - collapsed tool activity with Review-in-Question action wiring
  - first-link native confirmation dialog and bounded code copy/expand controls
  - coarse status banners, ordinary-memory composer focus restore, and near-bottom Jump to latest behavior
- Wired all Compose callbacks through `MainActivity` and `QuestionWorkflowViewModel` without exposing transport details to Compose.
- Added focused Compose screen tests for:
  - pre-activation Start entry
  - explicit context-only confirmation
  - activated tabs / starters / composer callbacks

## Commits

- `cc4ab9b` — Add Android Question Chat transport foundation
- `fd1dbbc` — test(android): wire question chat shell into workflow
- `be9e170` — feat(android): add safe markdown chat rendering foundation
- `873c14b` — test(android): cover chat stop and gap resync
- `5993dc2` — feat(android): render question chat workspace tracer

## Changed files

- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionWorkflowScreenTest.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatModels.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatHttpClient.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatEventTransport.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatOwner.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShell.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/SafeMarkdown.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowQuestionChatTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatOwnerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatTransportTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShellTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/SafeMarkdownParserTest.kt`

## Commands run

- `env | grep '^PI_' | sort`
- `gh issue view 50 --json ...`
- `gh issue view 51 --json ...`
- `gh issue view 61 --json ...`
- `gh issue view 63 --json ...`
- `gh issue view 64 --json ...`
- multiple file reads for Android/protocol/PRD/prototype/research docs
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest`
  - passed
- `cd apps/android && ./gradlew compileDebugAndroidTestKotlin`
  - passed
- `cd apps/android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.pi.postbox.question.QuestionWorkflowScreenTest`
  - failed: no connected devices
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest --tests dev.pi.postbox.question.QuestionWorkflowViewModelTest`
  - passed
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest --tests dev.pi.postbox.questionchat.SafeMarkdownParserTest --tests dev.pi.postbox.questionchat.QuestionChatTransportTest compileDebugAndroidTestKotlin`
  - passed
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`
  - passed
- `adb devices -l`
  - no connected devices

## Acceptance criteria still not fully closed

Issue #50:
- Compose now renders the Start entry, confirmation flow, tabs, and Back path, but shell-owned suggested-option highlight/review focus tokens are still minimal rather than fully explicit.
- I did not add deterministic coverage for terminal-before-release dispatch or temporary same-key hiding beyond the existing shell tests.
- Instrumentation execution was not possible because no device/emulator was available.

Issue #51:
- The first-turn tracer is now rendered, but the new Compose behaviors (streaming-to-terminal replacement, link confirmation, code controls, collapsed tools, jump-to-latest, accessibility/focus behavior) were only compile-validated; the added Compose tests could not be executed without a device.
- The link renderer currently uses deprecated Compose text/clipboard APIs that passed lint/build but should be modernized when the app adopts the newer replacement APIs.

## Residual risks / exact continuation

If continuing from this boundary, the next exact unit should be:
1. finish shell-owned suggested-option review/highlight/focus return on the Question tab;
2. add deterministic JVM/Compose coverage for the new tool/link/code/disclosure behaviors;
3. run the focused instrumentation tests on an API 26+ emulator/device and repair any IME/focus/scroll issues that only appear on device.

## Notes

- CommonMark Java 0.29.0 remains parser-only behind the app-owned safe model.
- The requested Android JVM/lint/APK/androidTest APK gate passed.
- Connected Android tests were **not** run because no device/emulator was attached.
- No push performed.
- No PR opened.
