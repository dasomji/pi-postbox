## Findings

1. **Severity:** High  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocol.kt:164`  
   **Requirement/pattern violated:** Protocol compatibility with `packages/protocol/src/ask.ts:77-105` and `AskRequestSnapshotSchema.result` at `packages/protocol/src/ask.ts:119`; Android state/SSE clients must parse shared protocol snapshots.  
   **Issue:** `AskResult.status` reuses `AskStatus`, whose enum only supports `pending`, `answered`, `cancelled`, and `expired` (`PostboxProtocol.kt:100-106`). The shared protocol's result union also includes terminal `"unavailable"`. `ignoreUnknownKeys` does not tolerate unknown enum values, so a `/api/state` or SSE state snapshot containing `result: { "status": "unavailable", ... }` will fail the entire state decode or be treated as a malformed SSE event.  
   **Required fix:** Use a separate result-status enum/model for `AskResult` that includes `answered`, `cancelled`, `expired`, and `unavailable` while keeping request-card `status` aligned to `AskStatusSchema`. Add coverage for terminal results, including `unavailable`.

2. **Severity:** Medium  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxStateStream.kt:56`  
   **Requirement/pattern violated:** Coroutine/thread safety for the state stream.  
   **Issue:** `start()` checks and assigns `streamJob` without synchronization, and `streamJob` is not volatile/atomic. Concurrent or rapid lifecycle calls can pass the `isActive` check before either assigns `streamJob`, starting multiple SSE loops. Because `currentCall` stores only one call, `close()` may cancel only the last call, leaving another blocking read alive until the server closes it. `start()` also blocks the caller for up to 500 ms at line 82, which is unsafe if called from a Compose/ViewModel main-thread boundary.  
   **Required fix:** Make start/close idempotent and thread-safe with a synchronized section/atomic job guard, ensure all active calls are cancelled or only one can exist, and remove the blocking latch wait or move it behind a suspend/test-only boundary.

3. **Severity:** Medium  
   **Location:** `apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxStateStreamTest.kt:29`  
   **Requirement/pattern violated:** Unit 03 test scenario: “SSE initial event updates state; malformed events are logged/recovered without crashing,” plus representative protocol-state coverage.  
   **Issue:** The SSE tests cover only two valid `state` events and an HTTP 503 connection failure (`PostboxStateStreamTest.kt:29-97`). No test sends a malformed `data:` event followed by a valid one to prove recovery. The representative fixture also never includes a terminal `result` (`PostboxProtocolFixtures.kt:90-93`), which is why the missing `unavailable` result status above remains green.  
   **Required fix:** Add an SSE recovery test that emits malformed state data followed by valid state and asserts the stream recovers to `Connected`. Extend DTO fixtures/tests to cover terminal request results, including `answered` payload fields and `unavailable`.

## Claude reviewer

- Result: Actionable findings reported. Deduplicated into the main findings above: `AskResult.status` cannot represent protocol `unavailable`, malformed SSE/terminal-result coverage is missing, and `start()` blocks the caller. Claude also noted the malformed-event path emits `Reconnecting` while the socket remains live; treated as a non-blocking design note under finding 3 rather than a separate required fix.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --stat` — showed Android app and plan files are untracked; no tracked diff stat.
  - `git diff -- apps/android/app/src/main/java/dev/pi/postbox/protocol apps/android/app/src/test/java/dev/pi/postbox/protocol apps/android/app/build.gradle.kts docs/plans/2026-06-24-postbox-native-android/artifacts/03-red.md docs/plans/2026-06-24-postbox-native-android/artifacts/03-green.md | sed -n '1,260p'` — no output because reviewed files are untracked.
  - `nl -ba apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocol.kt | sed -n '1,220p'` and matching `nl -ba` reads for `PostboxProtocolClient.kt`, `PostboxStateStream.kt`, `PostboxStateStreamTest.kt`, `PostboxProtocolFixtures.kt`, `packages/protocol/src/ask.ts`, and the Unit 03 dossier — inspected line-numbered evidence.
  - `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'` — passed.
  - `timeout 120s claude -p --tools "" --no-session-persistence` with a read-only review packet on stdin — completed and returned actionable findings.
  - `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
  - `git status --short --untracked-files=all | sed -n '1,240p'; git diff --cached --stat` — no staged diff output; listed untracked Android/plan files.
- Scope checked: Unit 03 dossier, `03-red.md`, `03-green.md`, `docs/protocol.md`, prior Unit 00/02 artifacts, shared protocol schemas, server request/SSE routes, Android protocol production code, Android protocol tests, Gradle dependency changes, and validation outputs.
- Residual risks: No emulator/device runtime smoke was run; review used JVM/build/lint gates and source inspection. Files remain untracked, so diff assessment is based on direct source/status inspection rather than a tracked branch diff.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reported concrete actionable findings with severities and file/line evidence for protocol compatibility, state-stream thread safety, and Unit 03 test adequacy."
    }
  ],
  "changedFiles": [
    "docs/plans/2026-06-24-postbox-native-android/artifacts/03-review.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff --stat",
      "result": "passed",
      "summary": "Showed untracked Android app/plan files and no tracked diff stat."
    },
    {
      "command": "nl -ba apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocol.kt | sed -n '1,220p' and related line-number reads",
      "result": "passed",
      "summary": "Collected line evidence for protocol DTOs, state stream, tests, schemas, and dossier."
    },
    {
      "command": "cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*'",
      "result": "passed",
      "summary": "Targeted Unit 03 JVM protocol tests passed."
    },
    {
      "command": "timeout 120s claude -p --tools \"\" --no-session-persistence",
      "result": "passed",
      "summary": "Nested read-only Claude reviewer returned actionable findings that were deduplicated."
    },
    {
      "command": "cd apps/android && ./gradlew test assembleDebug lintDebug",
      "result": "passed",
      "summary": "Full Android JVM/build/lint gate passed."
    },
    {
      "command": "git status --short --untracked-files=all | sed -n '1,240p'; git diff --cached --stat",
      "result": "passed",
      "summary": "No staged diff output; untracked Android/plan files listed."
    }
  ],
  "validationOutput": [
    "./gradlew testDebugUnitTest --tests 'dev.pi.postbox.protocol.*': BUILD SUCCESSFUL in 2s; 22 actionable tasks: 1 executed, 21 up-to-date.",
    "./gradlew test assembleDebug lintDebug: BUILD SUCCESSFUL in 2s; 74 actionable tasks: 2 executed, 72 up-to-date.",
    "Nested Claude reviewer completed and reported actionable findings."
  ],
  "residualRisks": [
    "No emulator/device runtime smoke was run; source/JVM/build/lint review only.",
    "Files are untracked, so diff assessment was based on direct source inspection rather than tracked git diff output.",
    "Review artifact was written as requested and not staged."
  ],
  "noStagedFiles": true,
  "diffSummary": "Unit 03 adds Android protocol DTOs/JSON, OkHttp HTTP client, answer/cancel conflict mapping, and an app-owned SSE state stream plus protocol JVM tests.",
  "reviewFindings": [
    "high: apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxProtocol.kt:164 - AskResult.status cannot parse protocol terminal status 'unavailable'.",
    "medium: apps/android/app/src/main/java/dev/pi/postbox/protocol/PostboxStateStream.kt:56 - start()/close lifecycle is not thread-safe and start() blocks callers up to 500 ms.",
    "medium: apps/android/app/src/test/java/dev/pi/postbox/protocol/PostboxStateStreamTest.kt:29 - required malformed SSE recovery and terminal-result DTO coverage is missing."
  ],
  "manualNotes": "Nested Claude reviewer was run once with tools disabled and no session persistence; its output was advisory and deduplicated into the findings."
}
```
