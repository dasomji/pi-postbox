## Findings

1. **Severity:** High  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerUrlNormalizer.kt:16`  
   **Requirement/pattern violated:** Unit 02 security posture: prefer Tailnet HTTPS, with localhost/emulator HTTP allowed; Postbox has no app-level auth.  
   **Issue:** The normalizer accepts every explicit `http://` URL and only returns a warning (`ServerUrlNormalizer.kt:38-42`). That means `http://postbox.example:32187` or any other non-local cleartext endpoint can be health-verified and persisted for later API use, even though the intended exception is localhost/emulator development. The warning is also not surfaced by the ViewModel/UI. Separately, `AndroidManifest.xml:4-8` has no local-only network security config, so targetSdk 36 Android builds may block the intended local cleartext emulator path while still failing to enforce the intended non-local HTTPS boundary at validation time.  
   **Required fix:** Reject non-HTTPS URLs unless the host is an explicit loopback/emulator host (for example `localhost`, `127.0.0.1`, `::1`, and `10.0.2.2` if emulator support is intended). Surface the non-HTTPS/local-dev warning in onboarding state/UI, and add a local-only cleartext network-security config if Android runtime validation requires it. Add tests covering non-local HTTP rejection and the allowed localhost/emulator path.

2. **Severity:** Medium  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt:56`  
   **Requirement/pattern violated:** Unit 02 scope: “Allow editing/replacing the saved URL from settings” (`docs/plans/2026-06-24-postbox-native-android/units/02-server-url-onboarding.md:12`).  
   **Issue:** Once `loadSavedServerUrl()` sets `Ready`, `PostboxApp` routes directly to `ConnectedPlaceholder`, and that screen only displays the connected URL plus later-workflow placeholder text (`MainActivity.kt:140-162`). There is no settings/edit affordance, no ViewModel method to return to editing, and no store clear/replace flow beyond overwriting during first-run verification. A developer who saved a stale or wrong URL is stuck without app data clearing.  
   **Required fix:** Add a minimal settings/edit path in this unit (even if it is just an “Edit server URL” action from the connected placeholder) that returns to the URL form, verifies the replacement, and overwrites the saved base URL. Add a behavior test for editing/replacing a previously saved URL.

3. **Severity:** Medium  
   **Location:** `apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerOnboardingViewModel.kt:69`  
   **Requirement/pattern violated:** Unit 02 scope: “Call `GET /healthz` and show service/version/connection result” (`docs/plans/2026-06-24-postbox-native-android/units/02-server-url-onboarding.md:10`).  
   **Issue:** `OkHttpPostboxHealthVerifier` parses and returns `service`, `version`, and `protocolVersion` (`PostboxHealthVerifier.kt:57-62`), but `handleVerificationResult` discards those fields and stores only `Ready(normalizedBaseUrl)` (`ServerOnboardingViewModel.kt:69-72`, `ServerOnboardingViewModel.kt:106`). The connected UI therefore shows only `Connected to $baseUrl` (`MainActivity.kt:153-160`) and never shows the service/version health result required by the unit.  
   **Required fix:** Carry the verified health metadata into `Ready` state and display at least service and version/protocol version on the success/connected screen. Add a ViewModel/UI-level test or state assertion proving the parsed health metadata is preserved.

## Claude reviewer

- Result: Actionable findings reported. Deduplicated into the main findings above: service/version discarded, no edit/replace path for saved URL, and non-HTTPS warning computed but not surfaced. Claude did not independently flag non-local HTTP acceptance or Android cleartext configuration.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --stat` — inspected initial status; Android plan/app files are untracked, no tracked diff stat.
  - `git diff -- apps/android apps/androidScaffold.test.ts docs/plans/2026-06-24-postbox-native-android | sed -n '1,240p'` — no output because reviewed files are untracked.
  - `git status --short --untracked-files=all | sed -n '1,240p'` — listed untracked Android scaffold, Unit 02 source/tests, and plan artifacts.
  - `timeout 120s claude -p --tools "" --no-session-persistence` with a review packet on stdin — completed and returned actionable findings.
  - `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — passed.
  - `npx vitest run apps/androidScaffold.test.ts` — passed.
  - `git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,240p'` — no staged files; listed untracked files.
- Scope checked: Unit 02 requirements, Unit 02 RED/GREEN artifacts, Unit 01 artifacts, preflight, Android onboarding production code/tests, manifest/build configuration, protocol health docs/server contract, and package-safety scaffold test.
- No staged files: confirmed before writing this artifact; artifact write itself was requested by the task and was not staged.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed Unit 02 implementation against the unit scope without making code changes or widening scope; findings are limited to URL security posture, saved URL replacement, and health result display."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "This artifact records changed files inspected, tests present, commands run, validation output, residual risks, and staged-file status for independent acceptance review."
    }
  ],
  "changedFiles": [
    "apps/android/app/build.gradle.kts",
    "apps/android/app/src/main/AndroidManifest.xml",
    "apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt",
    "apps/android/app/src/main/java/dev/pi/postbox/onboarding/PostboxHealthVerifier.kt",
    "apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerOnboardingViewModel.kt",
    "apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerUrlNormalizer.kt",
    "apps/android/app/src/main/java/dev/pi/postbox/onboarding/VerifiedServerUrlStore.kt",
    "apps/android/app/src/test/java/dev/pi/postbox/onboarding/PostboxHealthVerifierTest.kt",
    "apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerOnboardingViewModelTest.kt",
    "apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerUrlNormalizerTest.kt",
    "docs/plans/2026-06-24-postbox-native-android/artifacts/02-green.md",
    "docs/plans/2026-06-24-postbox-native-android/artifacts/02-red.md",
    "docs/plans/2026-06-24-postbox-native-android/artifacts/02-review.md"
  ],
  "testsAddedOrUpdated": [
    "apps/android/app/src/test/java/dev/pi/postbox/onboarding/PostboxHealthVerifierTest.kt",
    "apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerOnboardingViewModelTest.kt",
    "apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerUrlNormalizerTest.kt"
  ],
  "commandsRun": [
    {
      "command": "git status --short && git diff --stat",
      "result": "passed",
      "summary": "Showed untracked Android/plan files and no tracked diff stat."
    },
    {
      "command": "timeout 120s claude -p --tools \"\" --no-session-persistence",
      "result": "passed",
      "summary": "Nested read-only Claude reviewer returned actionable findings that were deduplicated into this review."
    },
    {
      "command": "cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'",
      "result": "passed",
      "summary": "Targeted Unit 02 Android JVM tests passed."
    },
    {
      "command": "npx vitest run apps/androidScaffold.test.ts",
      "result": "passed",
      "summary": "Unit 01 scaffold/package-safety Vitest passed."
    },
    {
      "command": "git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,240p'",
      "result": "passed",
      "summary": "No staged files; untracked Android source/tests and plan artifacts listed."
    }
  ],
  "validationOutput": [
    "./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*': BUILD SUCCESSFUL in 2s; 22 actionable tasks: 1 executed, 21 up-to-date.",
    "npx vitest run apps/androidScaffold.test.ts: Test Files 1 passed; Tests 4 passed; Duration 5.63s.",
    "git diff --cached --stat produced no output before artifact write."
  ],
  "residualRisks": [
    "No emulator/device smoke was run; preflight documents KVM/device limitations.",
    "SharedPreferences persistence implementation remains compile-tested but lacks a concrete Android/Robolectric persistence test.",
    "Review artifact was written as requested and not staged."
  ],
  "noStagedFiles": true,
  "diffSummary": "Unit 02 adds Android server URL normalization, health verification, SharedPreferences-backed URL storage, onboarding ViewModel/state, Compose onboarding UI, INTERNET permission, and JVM tests for normalization/health/ViewModel behavior.",
  "reviewFindings": [
    "high: apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerUrlNormalizer.kt:16 - arbitrary non-local HTTP URLs are accepted and the local HTTP emulator exception is not enforced/surfaced safely.",
    "medium: apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt:56 - saved server URL cannot be edited or replaced from settings/connected UI.",
    "medium: apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerOnboardingViewModel.kt:69 - parsed service/version health result is discarded and not displayed."
  ],
  "manualNotes": "Nested Claude reviewer completed; its findings were advisory and deduplicated."
}
```
