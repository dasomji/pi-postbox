# 03 — REPAIR: accepted reviewer findings

## changedFiles
- `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocol.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxStateStream.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolDtoTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxProtocolFixtures.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxStateStreamTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/03-repair.md`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'` — failed during repair before adapting state-stream tests to the now-nonblocking `start()` lifecycle; `runTest` virtual-time timeouts exposed that collectors needed real-time `runBlocking` for this IO-backed stream.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.PostboxStateStreamTest.stateStreamRecoversFromMalformedSseEventAndConsumesNextValidState' --info` — failed during diagnosis for the same virtual-time timeout; Gradle output explicitly noted `Timed out after 2s of _virtual_ (kotlinx.coroutines.test) time`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.PostboxStateStreamTest.stateStreamConsumesInitialAndUpdateEventsAsLatestState'` — failed during diagnosis before the test harness was changed from `runTest` to `runBlocking`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'` — passed after repair.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
- `python3 - <<'PY' ... apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.*.xml ... PY` — passed; summarized targeted protocol XML test counts.
- `git status --short --untracked-files=all && git diff --cached --stat` — passed; confirmed no staged files.

## validationOutput
Targeted protocol test after repair:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'
BUILD SUCCESSFUL in 4s
22 actionable tasks: 2 executed, 20 up-to-date
```

Protocol test reports:

```text
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxProtocolClientTest.xml: tests=5 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxProtocolDtoTest.xml: tests=3 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxStateStreamTest.xml: tests=4 failures=0 errors=0
```

Full Android gate:

```text
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 12s
74 actionable tasks: 16 executed, 58 up-to-date
```

No staged files:

```text
git diff --cached --stat
# no output
```

## residualRisks
- No emulator/device runtime smoke was run; validation remains JVM unit tests, debug assembly, and lint.
- The Android app and plan files are still untracked in this workspace from prior units, so git diff does not show a tracked patch for these files.
- `AskResult.status = unavailable` is now representable for decoded state snapshots; request-card `AskRequestSnapshot.status` intentionally remains limited to shared `AskStatusSchema` (`pending`, `answered`, `cancelled`, `expired`).

## noStagedFiles
true
