# 03 — RED: Postbox protocol client and state stream

## changedFiles
- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolFixtures.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolDtoTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolClientTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxStateStreamTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/03-red.md`

## testsAddedOrUpdated
- `PostboxProtocolDtoTest.parsesRepresentativeStateSnapshotAndIgnoresUnknownFields`
  - Specifies an app-owned Kotlin protocol JSON parser/DTO surface for representative `/api/state` snapshots.
  - Asserts session, project icon, semantic/presence state, request, question, option, handoff context, and fork-reference fields parse while unknown root/nested fields are tolerated.
- `PostboxProtocolClientTest.fetchStateRequestsApiStateAndDecodesSnapshot`
  - Specifies `GET /api/state` through the Android protocol client and verifies decoded snapshot contents.
- `PostboxProtocolClientTest.answerRequestPostsSelectedValuesAndOptionalNoteAndRationale`
  - Specifies `POST /api/requests/:requestId/answer`, request-id path encoding, JSON content type, selected values, note, and rationale payload.
- `PostboxProtocolClientTest.cancelRequestPostsOptionalNoteAndRationale`
  - Specifies `POST /api/requests/:requestId/cancel`, JSON content type, note, and rationale payload.
- `PostboxProtocolClientTest.answerConflictMapsToAlreadyResolvedDomainError`
  - Specifies HTTP `409` answer conflicts become `PostboxRequestAlreadyResolvedException` with request id and server error code.
- `PostboxProtocolClientTest.cancelConflictMapsToAlreadyResolvedDomainError`
  - Specifies HTTP `409` cancel conflicts become the same already-resolved domain error.
- `PostboxStateStreamTest.stateStreamConsumesInitialAndUpdateEventsAsLatestState`
  - Specifies an app-owned `OkHttpPostboxStateStream`/`PostboxStateStreamStatus` interface that consumes initial and update `event: state` SSE messages from `/api/state/events` and exposes each latest state.
- `PostboxStateStreamTest.stateStreamExposesReconnectOrErrorStateWhenSseConnectionFails`
  - Specifies failed SSE connection attempts surface `Reconnecting` or `Disconnected` app-owned status with an error reason instead of crashing.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'` — failed as expected (RED).
- `npx vitest run apps/androidScaffold.test.ts` — passed; Unit 01 scaffold/package-safety test remains green.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew assembleDebug` — passed; production Android debug build still compiles.
- `git status --short && git diff --cached --stat` — passed; confirmed no staged files.

## validationOutput
Targeted Unit 03 RED output:

```text
> Task :app:compileDebugUnitTestKotlin FAILED
e: .../PostboxProtocolClientTest.kt:29:22 Unresolved reference 'OkHttpPostboxProtocolClient'.
e: .../PostboxProtocolClientTest.kt:47:23 Unresolved reference 'AskAnswerPayload'.
e: .../PostboxProtocolClientTest.kt:72:23 Unresolved reference 'AskCancelPayload'.
e: .../PostboxProtocolClientTest.kt:99:25 Unresolved reference 'PostboxRequestAlreadyResolvedException'.
e: .../PostboxProtocolDtoTest.kt:9:24 Unresolved reference 'PostboxProtocolJson'.
e: .../PostboxProtocolDtoTest.kt:23:22 Unresolved reference 'SemanticState'.
e: .../PostboxProtocolDtoTest.kt:24:22 Unresolved reference 'PresenceState'.
e: .../PostboxProtocolDtoTest.kt:31:22 Unresolved reference 'AskMode'.
e: .../PostboxProtocolDtoTest.kt:32:22 Unresolved reference 'AskStatus'.
e: .../PostboxStateStreamTest.kt:40:22 Unresolved reference 'OkHttpPostboxStateStream'.
e: .../PostboxStateStreamTest.kt:41:45 Unresolved reference 'PostboxStateStreamStatus'.
BUILD FAILED
```

Why this is the expected RED: the Android project has Unit 01/02 onboarding code only. No Unit 03 protocol DTO package, protocol JSON parser, protocol HTTP client, conflict domain error, or app-owned SSE state stream exists yet, so the behavior tests fail at test compilation on the missing public Unit 03 API.

Existing gates checked where feasible:

```text
npx vitest run apps/androidScaffold.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)
```

```text
cd apps/android && ./gradlew assembleDebug
BUILD SUCCESSFUL in 1s
35 actionable tasks: 35 up-to-date
```

No staged files:

```text
git status --short && git diff --cached --stat
?? apps/android/
?? apps/androidScaffold.test.ts
?? docs/plans/2026-06-24-postbox-native-android/
```

## residualRisks
- The new RED tests intentionally prevent `testDebugUnitTest` from compiling until Unit 03 production APIs are added, so targeted Unit 02 JVM tests cannot be re-run independently in the same Gradle test compile task while RED remains unresolved.
- The tests choose a concrete public API shape for GREEN: `PostboxProtocolJson`, DTO enums (`SemanticState`, `PresenceState`, `AskMode`, `AskStatus`), `OkHttpPostboxProtocolClient`, `AskAnswerPayload`, `AskCancelPayload`, `PostboxRequestAlreadyResolvedException`, `OkHttpPostboxStateStream`, and `PostboxStateStreamStatus`. Implementer should either satisfy this API or coordinate a deliberate test update if a better app-owned boundary is chosen.
- MockWebServer and kotlinx-coroutines-test were added as test dependencies only; no production behavior was implemented.

## noStagedFiles
true

`git diff --cached --stat` produced no output.
