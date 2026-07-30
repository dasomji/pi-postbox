# Android Question Chat tracer implementation report

## Scope completed

This continuation repairs all four findings from `/tmp/android-chat-t1-rereview-report.md` while preserving the existing no-persistence and lifecycle boundaries.

Completed in this continuation:
- Moved terminal assistant Markdown parsing onto an explicit injectable off-main single-lane dispatcher inside `QuestionChatOwner`, with regression coverage proving the injected parser lane is used.
- Anchored the Question Chat composer/action row with IME + navigation-bar padding (`imePadding().navigationBarsPadding()`) and added a focused Compose regression test seam that verifies bottom controls respect injected inset padding.
- Tightened transport-state parsing so only `online|offline` are accepted; any other value is now rejected as malformed/stale transport input instead of being misread as `offline`.
- Dispatched `QuestionBecameTerminal` before authoritative terminal/disappearance unbind/rebind transitions, with workflow tests covering local terminal rebind, remote disappearance unbind, and an explicit non-terminal pending-question switch guard.

## Changed files

- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatHttpClient.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatOwner.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/SafeMarkdown.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowQuestionChatTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatOwnerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatTransportTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`

## Commands run

- `env | grep '^PI_' | sort`
- multiple targeted file reads/greps for Android Question Chat code, tests, and docs
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.questionchat.QuestionChatTransportTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest`
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.questionchat.QuestionChatTransportTest --tests dev.pi.postbox.question.QuestionWorkflowQuestionChatTest assembleDebugAndroidTest`
- `cd apps/android && adb devices -l`
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`

## Validation status

Passed:
- focused Question Chat owner / transport / workflow JVM regressions
- Android test APK assembly including `QuestionChatUiTest`
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`

Not run:
- connected Android instrumentation execution (`adb devices -l` showed no attached device/emulator)

## Residual risks / notes

- `QuestionChatUiTest` currently has compile/assembly coverage only because no device/emulator was available for connected execution.
- Existing Compose deprecation warnings around clipboard / `ClickableText` remain unchanged in this continuation.
- Existing CommonMark `startNumber` deprecation warnings remain unchanged.
- No push performed.
- No PR opened.
