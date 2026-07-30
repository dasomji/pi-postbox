# Android Question Chat tracer implementation report

## Scope completed

This continuation repairs the accepted Android Question Chat tracer findings from `/tmp/android-chat-t1-review-report.md`.

Completed in this continuation:
- Hardened `QuestionChatOwner` so owner mutation/result paths are serialized and generation-guarded.
- On background loss, canceled active Question Chat work/calls, kept only in-memory stale state, and preserved foreground resume through a fresh synchronize path.
- On true teardown, routed Compose disposal through `QuestionWorkflowViewModel.dispose()` / `QuestionChatOwner.close()`.
- Made SSE line parsing UTF-8-correct with strict decoding instead of per-byte char coercion.
- Surfaced malformed / wrong-request SSE frames as stale facts and prevented false online state from buffered transport facts.
- Preserved typed unavailable results for snapshot/send/stop through the Android owner seam instead of collapsing them to generic exceptions.
- Added explicit shell-owned suggested-option review/highlight token wiring, Question-tab return, and focus/highlight presentation state.
- Added focused regression coverage for transport parsing, typed unavailable handling, lifecycle cancellation/resume, stale/resync handling, and suggested-option review tokens.

## Changed files

- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatEventTransport.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatHttpClient.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatModels.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatOwner.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShell.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowQuestionChatTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatOwnerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatTransportTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatWorkspaceShellTest.kt`

## Commands run

- `env | sort | grep '^PI_' || true`
- `git status --short`
- `git diff --stat`
- `gh issue view 50 --json number,title,body,state`
- `gh issue view 51 --json number,title,body,state`
- `gh issue view 64 --json number,title,body,state`
- multiple targeted file reads/greps for Android Question Chat code, tests, and docs
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatTransportTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.questionchat.QuestionChatWorkspaceShellTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest`
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`
- `cd apps/android && adb devices -l`

## Validation status

Passed:
- focused Question Chat JVM regression tests
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`

Not run:
- connected Android instrumentation execution (`adb devices -l` showed no attached device/emulator)

## Residual risks / notes

- Connected Android tests remain unexecuted because no device/emulator was available.
- Existing Compose deprecation warnings around clipboard / clickable text remain unchanged in this continuation.
- No push performed.
- No PR opened.
