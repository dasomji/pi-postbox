# Android Question Chat tracer implementation report

## Scope completed

This continuation repairs all three findings from `/tmp/android-chat-t1-final-review.md` test-first.

Completed in this continuation:
- Rejected post-offline non-transport live events so stale stream deltas cannot mutate the retained offline transcript.
- Added dedicated synchronization-attempt identity plus cancellation so superseded same-key retries cannot let older snapshot results clobber newer state.
- Promoted starter actions to native Material buttons with 48dp minimum targets and migrated Markdown links from deprecated `ClickableText`/raw string annotations to current `LinkAnnotation.Url` + `withLink` semantics while preserving explicit confirmation and safe revalidation.
- Added regressions for offline late-event rejection, same-generation retry supersession, safe `LinkAnnotation` generation/click handling, unsafe-link inert rendering, and starter touch-target/button semantics.

## Research / API verification

- Verified the current Compose link API against Android Developers' current `LinkAnnotation` / `withLink` guidance and the local Compose `ui-text` API surface resolved from this repo's BOM (`androidx.compose:compose-bom:2025.05.01`, `ui-text-android:1.8.2`).

## Changed files

- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatOwner.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatOwnerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionChatUiMarkdownTest.kt`
- `apps/android/app/src/androidTest/java/dev/pi/postbox/question/QuestionChatUiTest.kt`
- `IMPLEMENTATION_REPORT.md`

## Commands run

- `env | grep '^PI_' | sort`
- targeted file reads/greps for Question Chat owner/UI/tests/docs
- Android docs/API verification for `LinkAnnotation` / `withLink`, plus local `javap` inspection of Compose `ui-text`
- `cd apps/android && ./gradlew testDebugUnitTest --tests dev.pi.postbox.questionchat.QuestionChatOwnerTest --tests dev.pi.postbox.question.QuestionChatUiMarkdownTest`
- `cd apps/android && adb devices -l`
- `cd apps/android && ./gradlew assembleDebugAndroidTest`
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`

## Validation status

Passed:
- focused JVM regressions for Question Chat owner synchronization/offline behavior and Markdown link annotations
- Android instrumentation test APK assembly including `QuestionChatUiTest`
- `cd apps/android && ./gradlew test lintDebug assembleDebug assembleDebugAndroidTest`

Not run:
- connected Android instrumentation execution (`adb devices -l` showed no attached device/emulator)

## Residual risks / notes

- `QuestionChatUiTest` has compile/assembly coverage only because no device/emulator was available for connected execution.
- Existing Compose clipboard deprecation warnings (`LocalClipboardManager`) remain outside this slice.
- Existing CommonMark `startNumber` deprecation warnings remain outside this slice.
- No push performed.
- No PR opened.
