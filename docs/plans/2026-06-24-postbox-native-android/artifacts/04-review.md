## Findings

1. **Severity:** High  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt:86`  
   **Requirement/pattern violated:** Unit 04 core answer workflow correctness and state-transition safety; submit should be disabled while a state-changing answer is in flight.  
   **Issue:** `submitAnswer()` sets `isSubmitting = true` but preserves the previous `canSubmit = true` instead of recomputing submit state. The Compose submit button is enabled solely from `question.canSubmit` at `QuestionWorkflowScreen.kt:360`, so a slow answer request leaves the button enabled with “Submitting…” text, and a second tap passes the ViewModel guard at `QuestionWorkflowViewModel.kt:84`, sending duplicate `answerRequest` calls for the same request. This can turn a successful user answer into a follow-up 409/already-resolved flow or duplicate network mutation.  
   **Required fix:** When entering the submitting state, set/recompute `canSubmit = false` (for example via `.withSubmitState()` or explicit copy), make the ViewModel guard reject `isSubmitting`, and gate the Compose submit button with both `actionsEnabled` and `question.canSubmit`. Add a regression test with a suspended answer call proving only one answer POST is sent while submission is in progress.

2. **Severity:** Medium  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt:136`  
   **Requirement/pattern violated:** Unit 04 conflict handling: already-resolved conflicts should be non-destructive, show a terminal message, and refresh state.  
   **Issue:** The protocol client maps HTTP 409 to `PostboxRequestAlreadyResolvedException` for both answer and cancel requests, but only `submitAnswer()` has a dedicated already-resolved catch/refresh path (`QuestionWorkflowViewModel.kt:98-107`). `cancelQuestion()` catches the same exception as a generic `IOException` at `QuestionWorkflowViewModel.kt:136-137`, so a late cancel does not refresh latest state, does not expose `ALREADY_RESOLVED`, and only leaves a submission error on the old pending question.  
   **Required fix:** Add a `PostboxRequestAlreadyResolvedException` catch in `cancelQuestion()` that mirrors the answer conflict path: refresh latest state, preserve/show the conflicted question when possible, disable actions, and publish an already-resolved terminal message. Add a cancel-conflict regression test.

## Claude reviewer

- Result: Unavailable/skipped for actionable review. Command completed, but the review packet was accidentally sent with unexpanded shell substitutions due a quoted heredoc, so Claude received placeholders instead of source content and attempted to request tools despite `--tools ""`. Per the one-attempt nested-review protocol, I did not rerun it.

## Validation notes

- Commands run, if any:
  - `pwd && git status --short && git diff --stat && find docs/plans/2026-06-24-postbox-native-android -maxdepth 3 -type f | sort | sed -n '1,200p'` — inspected workspace status and plan artifacts; files are untracked, so tracked diff stat is empty.
  - `find apps/android/app/src/main/java apps/android/app/src/test/java -type f | sort | sed -n '1,240p' && git status --short --untracked-files=all | sed -n '1,260p'` — listed Android source/tests and untracked worktree contents.
  - `nl -ba ...` / `read` commands over Unit 04 dossier, `04-red.md`, `04-green.md`, Unit 02/03 dossiers/artifacts, `QuestionWorkflowViewModel.kt`, `QuestionWorkflowScreen.kt`, `MainActivity.kt`, protocol code, and Unit 04 tests — inspected line-numbered evidence.
  - `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — passed.
  - `timeout 120s claude -p --tools "" --no-session-persistence` — completed but unusable for review because the packet contained unexpanded placeholders; not rerun.
  - `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed.
  - `python3 - <<'PY' ... TEST-dev.pi.postbox.question.*.xml ... PY; git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,260p'` — confirmed Unit 04 test XML counts and no staged files before writing this requested artifact.
- Scope checked: Unit 04 requirements and RED/GREEN artifacts; Unit 02/03 requirements, review/repair context, and protocol/client/stream interfaces; Android question ViewModel, Compose screen, MainActivity wiring, fixtures/tests; workflow state transitions, answer/cancel/conflict paths, disconnected preservation, long-context exposure, and lifecycle boundaries.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reported concrete actionable findings with severities and file/line evidence for duplicate answer submission state and cancel 409 conflict handling."
    }
  ],
  "changedFiles": [
    "docs/plans/2026-06-24-postbox-native-android/artifacts/04-review.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "pwd && git status --short && git diff --stat && find docs/plans/2026-06-24-postbox-native-android -maxdepth 3 -type f | sort | sed -n '1,200p'",
      "result": "passed",
      "summary": "Inspected workspace status and plan artifacts; tracked diff stat is empty because Android/plan files are untracked."
    },
    {
      "command": "find apps/android/app/src/main/java apps/android/app/src/test/java -type f | sort | sed -n '1,240p' && git status --short --untracked-files=all | sed -n '1,260p'",
      "result": "passed",
      "summary": "Listed Android source/tests and untracked worktree contents."
    },
    {
      "command": "nl -ba/read inspections of Unit 04/02/03 artifacts and relevant Android source/tests",
      "result": "passed",
      "summary": "Collected line evidence for ViewModel, Compose UI, MainActivity wiring, protocol client/stream, and Unit 04 tests."
    },
    {
      "command": "cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'",
      "result": "passed",
      "summary": "Targeted Unit 04 JVM tests passed."
    },
    {
      "command": "timeout 120s claude -p --tools \"\" --no-session-persistence",
      "result": "skipped",
      "summary": "Nested Claude invocation completed but received an unexpanded packet due quoted heredoc; unusable and not rerun per one-attempt protocol."
    },
    {
      "command": "cd apps/android && ./gradlew test assembleDebug lintDebug",
      "result": "passed",
      "summary": "Full Android JVM/build/lint gate passed."
    },
    {
      "command": "python3 - <<'PY' ... TEST-dev.pi.postbox.question.*.xml ... PY; git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,260p'",
      "result": "passed",
      "summary": "Question test XML reports 7 tests, 0 failures/errors; no staged files before artifact write."
    }
  ],
  "validationOutput": [
    "./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*': BUILD SUCCESSFUL in 1s; 22 actionable tasks: 1 executed, 21 up-to-date.",
    "./gradlew test assembleDebug lintDebug: BUILD SUCCESSFUL in 4s; 74 actionable tasks: 2 executed, 72 up-to-date.",
    "TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml: tests=7 failures=0 errors=0.",
    "git diff --cached --stat produced no output before writing the requested review artifact."
  ],
  "residualRisks": [
    "No emulator/device runtime smoke or Compose instrumentation test was run; review used source inspection plus JVM/build/lint gates.",
    "Files remain untracked in this workspace, so diff assessment was based on direct source/status inspection rather than tracked git diff output.",
    "Nested Claude reviewer did not produce usable advisory findings because the single allowed invocation received an unexpanded packet."
  ],
  "noStagedFiles": true,
  "diffSummary": "Unit 04 adds a native Android question workflow ViewModel, Compose list/detail/answer screen, and MainActivity integration for state fetch/SSE stream, single/multi answer selection, cancel, conflict, disconnected, and long-context behavior, with JVM ViewModel tests.",
  "reviewFindings": [
    "high: apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt:86 - submit remains enabled while an answer is in flight, allowing duplicate answer POSTs.",
    "medium: apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt:136 - cancel 409/already-resolved conflicts are handled as generic submission errors without refresh or terminal state."
  ],
  "manualNotes": "Review artifact was written as requested and not staged."
}
```
