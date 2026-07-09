# 03 — GREEN: Postbox protocol client and state stream

## changedFiles
- `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocol.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocolClient.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxStateStream.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/03-green.md`

## testsAddedOrUpdated
- None in GREEN. Reused the Unit 03 RED tests:
  - `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolDtoTest.kt`
  - `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolClientTest.kt`
  - `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxStateStreamTest.kt`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'` — passed; targeted Unit 03 JVM tests are green.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed; full Android unit-test/build/lint gate is green.
- `python3 - <<'PY' ...` over `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.*.xml` — passed; confirmed Unit 03 test counts from XML reports.
- `git status --short && git diff --cached --stat` — passed; confirmed no staged files.

## validationOutput
Targeted Unit 03 Gradle test:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'
BUILD SUCCESSFUL in 3s
22 actionable tasks: 5 executed, 17 up-to-date
```

Unit 03 test reports:

```text
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxProtocolClientTest.xml: tests=5 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxProtocolDtoTest.xml: tests=1 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxStateStreamTest.xml: tests=2 failures=0 errors=0
```

Full Android gate:

```text
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 10s
74 actionable tasks: 20 executed, 54 up-to-date
```

No staged files:

```text
git status --short && git diff --cached --stat
?? apps/android/
?? apps/androidScaffold.test.ts
?? docs/plans/2026-06-24-postbox-native-android/
```

`git diff --cached --stat` produced no output.

## implementationNotes
- Added app-owned kotlinx.serialization DTOs for `/api/state`, sessions, asks, options, handoff context, fork references, health, answer, and cancel payloads.
- Configured the protocol JSON surface to ignore unknown server fields, matching the shared TypeScript protocol compatibility guidance.
- Added `OkHttpPostboxProtocolClient` for `/healthz`, `/api/state`, answer, and cancel endpoints, including request-id path encoding and HTTP 409 mapping to `PostboxRequestAlreadyResolvedException`.
- Added an app-owned `OkHttpPostboxStateStream` wrapper over OkHttp streaming responses for `/api/state/events`, with SSE `event: state` parsing, malformed-event recovery, failure status emission, and reconnect/backoff behavior behind `PostboxStateStreamStatus`.
- Kept scope to the client/state layer; no question UI was added.

## residualRisks
- No emulator/device runtime smoke was run in this environment; validation is JVM unit tests, debug assembly, and lint.
- The state stream wrapper uses a small start-up await to make the first runtime stream status available promptly to collectors; future UI integration should call `start()` from a ViewModel/coroutine boundary rather than directly from Compose rendering.

## noStagedFiles
true
