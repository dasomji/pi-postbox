## Findings

1. **Severity:** Blocker  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt:168`  
   **Requirement/pattern violated:** Unit 05 scope requires “local notifications for newly observed pending questions while the app is active” and test scenarios require a new pending question observed from state/SSE to trigger one local notification and notification taps to open the relevant question.  
   **Issue:** The shipped app never wires the new notification tracker into the running state/SSE workflow and never posts Android notifications. `ConnectedQuestionWorkflow` constructs only `QuestionWorkflowViewModel` with protocol/stream clients and passes UI callbacks; there is no `PendingQuestionNotificationTracker`, permission checker/request path, notification channel/poster, `PendingIntent`, or tap-intent handling. The tracker itself documents that callers must feed snapshots into `observe()` and post returned events through Android notification APIs (`PendingQuestionNotificationTracker.kt:12-14`), but grep of main/test/docs excluding build shows `PendingQuestionNotificationTracker` and `OPEN_QUESTION` only in the tracker/tests, plus only the manifest permission. As a result, an installed debug APK will emit zero local notifications and notification tap targets cannot open questions.  
   **Required fix:** Wire notification decisions into the real snapshot path (for fetched and SSE snapshots), gate posting on Android 13+ permission state without blocking the question workflow, create/post a local notification with a channel and a tap `PendingIntent`, and handle the tap by selecting the relevant question if still present. Add behavior tests around the integration, not only the side-effect-free decision model.

2. **Severity:** Low  
   **Location:** `apps/android/README.md:66`  
   **Requirement/pattern violated:** Developer install docs must accurately describe current limitations and avoid misleading notification claims.  
   **Issue:** The README says “This pass only models local notifications for newly observed pending questions while the app is active or otherwise explicitly observing state,” but the app currently only contains an unused decision model and no OS notification posting or running-app integration. The green artifact is clearer that notification channel creation, permission prompt UI, PendingIntent construction, and actual posting remain deferred; the developer install doc does not make that absence explicit.  
   **Required fix:** If actual posting remains deferred, state plainly that the APK does not post notifications yet and only contains unconnected decision logic. If Finding 1 is fixed by adding posting, update the limitation text to match the implemented behavior and remaining tap/device-smoke limitations.

## Claude reviewer

- Result: One actionable advisory finding: `apps/android/README.md:64-68` overstates current notification behavior because only a side-effect-free decision layer exists and it is never wired into the app; developer docs should state that no notifications are posted yet. Claude also noted no blocking issues in dedupe, permission model shape, manifest permission, background-push claim, or representable tap-target model. Deduplicated into the findings above.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --stat` — passed; worktree contains untracked Android/docs plan files and no tracked diff stat.
  - `grep -RIn --exclude-dir=build -E 'PendingQuestionNotificationTracker|NotificationManager|NotificationCompat|notify\(|POST_NOTIFICATIONS|requestPermissions|ActivityResultContracts|OPEN_QUESTION|postbox://questions|onNewIntent' apps/android/app/src apps/android/README.md apps/androidDeveloperInstallDocs.test.ts || true` — passed; confirmed notification model is not referenced by app runtime and no Android posting/permission/tap handling APIs are present.
  - `nl -ba ...` over Unit 05 dossier, notification tracker, tests, manifest, MainActivity, and README — passed; used for line evidence.
  - `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*'` — passed; `BUILD SUCCESSFUL in 1s`, 22 actionable tasks, 1 executed.
  - `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — passed; 1 test file / 1 test passed.
  - Nested Claude reviewer command: packet piped to `timeout 120s claude -p --tools "" --no-session-persistence` — completed; advisory output summarized above.
- Scope checked: Unit 05 dossier, RED/GREEN artifacts, app notification tracker/tests, Android manifest, app workflow integration points, developer install docs, docs test, and targeted validation evidence.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Recorded two actionable findings with severity and file/line locations, plus residual risks and validation notes in docs/plans/2026-06-24-postbox-native-android/artifacts/05-review.md."
    }
  ],
  "changedFiles": [
    "docs/plans/2026-06-24-postbox-native-android/artifacts/05-review.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff --stat",
      "result": "passed",
      "summary": "Confirmed untracked Android/docs plan files; no tracked diff stat."
    },
    {
      "command": "grep -RIn --exclude-dir=build -E 'PendingQuestionNotificationTracker|NotificationManager|NotificationCompat|notify\\(|POST_NOTIFICATIONS|requestPermissions|ActivityResultContracts|OPEN_QUESTION|postbox://questions|onNewIntent' apps/android/app/src apps/android/README.md apps/androidDeveloperInstallDocs.test.ts || true",
      "result": "passed",
      "summary": "Found no runtime notification posting, permission request, or tap handling; tracker/action only appear in tracker/tests and manifest permission."
    },
    {
      "command": "export ANDROID_HOME=\"$HOME/Android/Sdk\"; export ANDROID_SDK_ROOT=\"$ANDROID_HOME\"; export PATH=\"$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH\"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*'",
      "result": "passed",
      "summary": "Notification JVM tests passed: BUILD SUCCESSFUL in 1s."
    },
    {
      "command": "npx vitest run apps/androidDeveloperInstallDocs.test.ts",
      "result": "passed",
      "summary": "Developer install docs test passed: 1 test file / 1 test passed."
    },
    {
      "command": "timeout 120s claude -p --tools \"\" --no-session-persistence < review packet",
      "result": "passed",
      "summary": "Nested Claude reviewer completed and reported the README current-notification-behavior limitation issue."
    }
  ],
  "validationOutput": [
    "Gradle notification tests: BUILD SUCCESSFUL in 1s; 22 actionable tasks: 1 executed, 21 up-to-date.",
    "Vitest docs test: Test Files 1 passed; Tests 1 passed.",
    "Runtime grep showed no NotificationManager/NotificationCompat/notify/requestPermissions/ActivityResultContracts/onNewIntent usage in app source."
  ],
  "residualRisks": [
    "Review was source/static plus targeted JVM/Vitest validation only; no emulator or device smoke was run.",
    "Because the Android app tree is untracked, git diff --stat does not show a conventional tracked-file diff."
  ],
  "noStagedFiles": true,
  "diffSummary": "Unit 05 adds an Android notification decision model/test, POST_NOTIFICATIONS manifest permission, and developer install README/docs test, but does not wire actual local notification posting into the app runtime.",
  "reviewFindings": [
    "blocker: apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt:168 - notification decision layer is not wired into fetched/SSE state and no Android local notifications, permission request, PendingIntent, or tap handling are implemented, so Unit 05 local notification/tap scenarios do not work in the installed APK.",
    "low: apps/android/README.md:66 - developer docs do not explicitly disclose that the APK currently does not post notifications and only contains unconnected decision logic."
  ],
  "manualNotes": "Nested Claude reviewer was available and completed with no tools enabled; its advisory finding was deduplicated into the main findings."
}
```
