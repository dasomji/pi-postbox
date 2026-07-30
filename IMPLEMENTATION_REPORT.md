# Android Question Chat tracer implementation report

## Scope completed

Stopped again at a clean tested atomic boundary instead of attempting the full #50 + #51 tracer in one unsafe pass.

Completed in this continuation:
- Wired the dedicated `QuestionChatOwner` into `QuestionWorkflowViewModel` with:
  - per-question `QuestionChatBindingKey` binding
  - a thin keyed `QuestionChatWorkspaceShell`
  - foreground handoff on workflow `start()` / `close()`
  - workflow methods for exact activation start and Android Back-to-Question shell handling
- Added deterministic JVM coverage for workflow/shell coordination:
  - discovery reveals tabs but keeps Question selected
  - activation selects Chat
  - Android Back returns to Question first
- Added bounded app-owned safe Markdown foundation using CommonMark Java 0.29.0 as parser only:
  - finite `SafeMarkdownDocument` / block / inline model
  - safe HTTP(S)-only link policy
  - inert HTML/image handling with readable fallback text
  - bounded plain-text fallback on unsafe/oversized input
- Extended `QuestionChatOwner` to derive ordinary-memory terminal assistant renderings for final/stopped/interrupted assistant messages.
- Added JVM tests for safe Markdown parsing and owner terminal rendering.

Still not completed:
- Compose Question Chat workspace and tab UI
- hidden-until-complete Start entry wiring in `QuestionWorkflowScreen`
- context-only confirmation UI/disclosure
- starters/freeform composer UI
- authoritative transcript/tool/disclosure presentation
- link confirmation / code presentation accessibility UI
- final user-visible first-turn tracer
- requested final Android lint/APK/androidTest suite

## Commits

- `cc4ab9b` — Add Android Question Chat transport foundation
- `fd1dbbc` — test(android): wire question chat shell into workflow
- `be9e170` — feat(android): add safe markdown chat rendering foundation

## Changed files

- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatModels.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatHttpClient.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatEventTransport.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatOwner.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShell.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/SafeMarkdown.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowQuestionChatTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatTransportTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatOwnerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShellTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/SafeMarkdownParserTest.kt`

## Commands run

- `env | grep '^PI_' | sort`
- `gh issue view 50 --json ...`
- `gh issue view 51 --json ...`
- `gh issue view 59..64 --json ...`
- multiple file reads for Android/protocol/server/planning docs
- prior run commands retained from `cc4ab9b`
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest`
  - passed
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest`
  - passed
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest --tests dev.pi.postbox.question.QuestionWorkflowViewModelTest`
  - passed
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.SafeMarkdownParserTest`
  - passed
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.questionchat.SafeMarkdownParserTest`
  - passed
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.questionchat.SafeMarkdownParserTest --tests dev.pi.postbox.question.QuestionWorkflowViewModelTest`
  - passed

## Acceptance criteria not yet met

Issue #50:
- owner now wired into workflow state and keyed shell exists, but no Compose workspace/tabs UI is rendered yet
- no context-only confirmation UI yet
- no temporary hiding / terminal-before-release behavior coverage yet
- no Compose/emulator coverage yet

Issue #51:
- safe Markdown model/parser foundation exists, but it is not yet surfaced in Compose
- no user-visible starters/composer yet
- no send acknowledgement surfaced in UI
- no streamed transcript/tool/disclosure UI yet
- no link confirmation/code rendering accessibility UI yet
- no Compose/emulator coverage yet

Merge gate not met:
- did **not** run `lintDebug`, `assembleDebug`, `assembleDebugAndroidTest`, or instrumentation
- did **not** run final requested combined suite because the tracer is not yet fully integrated/user-visible

## Residual risks / continuation notes

- Workflow/viewmodel now owns keyed binding + shell state, but Compose still does not render the workspace.
- The CommonMark parser is now installed and bounded behind an app-owned model, but the render path is not yet connected to UI.
- The SSE parser and HTTP client remain custom; future work should add more boundary tests as the UI/reducer contracts solidify.
- Start Question Chat remains hidden because the usable path is still incomplete.
- Next exact unit: render the locked Question/Question Chat mobile workspace in Compose (hidden Start entry, activation failure/confirmation surfaces, tabs, Back handling, starter/composer first-turn path, authoritative transcript/tool/disclosure presentation) on top of the committed workflow/shell + safe-Markdown foundations.

## Notes

- CommonMark Java 0.29.0 was added following the repository's canonical research ticket `docs/research/2026-07-29-android-question-chat-markdown.md`; no separate Context7 tool was available in this harness.
- No push performed.
- No PR opened.
