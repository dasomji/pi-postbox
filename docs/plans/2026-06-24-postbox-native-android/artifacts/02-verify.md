# 02 — VERIFY: Server URL onboarding after repair

## result
FAIL

Unit 02 behavior is covered by passing targeted JVM tests, the debug APK builds, package-safety checks pass, and the repaired reviewer findings appear satisfied. However, the independently discovered Android lint gate fails with blocking `NetworkSecurityConfig` errors in the new local-cleartext configuration, so this verification cannot pass until that gate is repaired or explicitly waived.

## requirementsChecked
- **First-run server URL input:** Source inspection shows `MainActivity.kt` routes non-ready states to `ServerOnboardingScreen` with a `Server URL` text field and `Verify server` action.
- **Normalize and validate explicit URLs / prefer Tailnet HTTPS:** `ServerUrlNormalizerTest` passes coverage for HTTPS normalization, missing scheme rejection, unsupported scheme rejection, non-local HTTP rejection, and local/emulator HTTP warnings.
- **Call `GET /healthz` and validate Postbox health:** `PostboxHealthVerifierTest` passes coverage for requesting `/healthz`, accepting `service: "pi-postbox"` with unknown fields, rejecting non-Postbox JSON, rejecting malformed health JSON, and reporting unreachable endpoints as retryable failures.
- **Show service/version/connection result:** `ServerOnboardingViewModelTest.validPostboxHealthSavesNormalizedUrlAndEntersTheApp` passes assertions that `Ready.health` preserves service/version/protocol metadata; source inspection shows `ConnectedPlaceholder` displays `service version (protocol protocolVersion)` when present.
- **Persist verified base URL:** `ServerOnboardingViewModelTest.validPostboxHealthSavesNormalizedUrlAndEntersTheApp` passes assertion that the normalized URL is saved; `VerifiedServerUrlStore.kt` provides SharedPreferences persistence and is compile/build validated.
- **Saved URL loaded on restart:** `ServerOnboardingViewModelTest.savedVerifiedUrlIsLoadedOnRestartWithoutRecheckingHealth` passes and confirms no health verifier call on load.
- **Allow editing/replacing saved URL:** `ServerOnboardingViewModelTest.editServerUrlAllowsReplacingPreviouslySavedUrl` passes; source inspection shows `ConnectedPlaceholder` exposes an `Edit server URL` button wired to `editServerUrl()` and replacement save.
- **No automatic discovery / port scanning / package-local autostart / Android metadata fallback:** Source inspection found only explicit URL input, normalization, `/healthz` verification, and persistence for Unit 02.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — **passed**. `BUILD SUCCESSFUL in 2s`; 22 actionable tasks, 1 executed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug` — **passed**. `BUILD SUCCESSFUL in 1s`; 64 actionable tasks, 1 executed.
- `npx vitest run apps/androidScaffold.test.ts` — **passed**. 1 file / 4 tests passed; package-safety scaffold test still green.
- `python3 - <<'PY' ...` over Unit 02 JUnit XML plus APK stat and git status — **passed**. Confirmed onboarding test names/counts and `apps/android/app/build/outputs/apk/debug/app-debug.apk` exists with size `17725589` bytes.
- `npm test` — **passed**. 43 files / 236 tests passed.
- `npm run typecheck` — **passed**. `tsc -b` completed with exit code 0.
- `npm run build` — **passed**. TypeScript build, web Vite production build, and copy to `packages/server/dist/public` completed; no tracked diff resulted.
- `npm run smoke` — **passed**. Local smoke verified `/healthz`, UI shell, fake extension registration, SSE, answer, state, and history.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew lintDebug` — **failed**. Android lint found 4 errors and 8 warnings; first failure is `network_security_config.xml:5` missing `includeSubdomains`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; adb devices; emulator -accel-check || true` — **completed for evidence feasibility**. No attached devices; emulator acceleration reports KVM/vmx/svm unavailable.
- `git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,260p'` — **passed** before artifact write. `git diff --cached --stat` produced no output.

## evidenceArtifacts
- Targeted Unit 02 JUnit XML:
  - `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.PostboxHealthVerifierTest.xml` — 4 tests, 0 failures, 0 errors.
  - `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.ServerOnboardingViewModelTest.xml` — 7 tests, 0 failures, 0 errors.
  - `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.ServerUrlNormalizerTest.xml` — 6 tests, 0 failures, 0 errors.
- CLI test evidence from XML summary included the passing behavior test names for valid health, non-Postbox rejection, malformed health rejection, unreachable retry, invalid URL no-network-call, local HTTP warning, edit/replace, and restart load.
- Debug APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk` exists, `17725589` bytes.
- Android lint report: `apps/android/app/build/intermediates/lint_intermediate_text_report/debug/lintReportDebug/lint-results-debug.txt` records the blocking lint errors.
- Smoke transcript in command output: `Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.`
- UI/device evidence: blocked/skipped; see `skippedGates`.

## skippedGates
- Emulator/device UI smoke — skipped because preflight and fresh feasibility check show no attached Android device (`adb devices` empty) and emulator acceleration unavailable (`KVM requires a CPU that supports vmx or svm`). This environment can only provide JVM/unit/build/CLI evidence for Unit 02.
- Instrumented Android tests — not present/discovered for this unit; no device/emulator available.

## issuesFound
1. **Severity: High / Blocking validation**  
   **Location:** `apps/android/app/src/main/res/xml/network_security_config.xml:5-8`  
   **Issue:** `./gradlew lintDebug` fails with 4 `NetworkSecurityConfig` errors because every `<domain>` entry in the new network security config is missing an explicit `includeSubdomains` attribute:
   - line 5: `<domain>localhost</domain>`
   - line 6: `<domain>127.0.0.1</domain>`
   - line 7: `<domain>::1</domain>`
   - line 8: `<domain>10.0.2.2</domain>`
   **Impact:** Android lint treats the network security config as invalid and aborts. This blocks a clean Android QA/CI-style gate even though unit tests and APK assembly pass.  
   **Suggested repair:** Add explicit `includeSubdomains` attributes appropriate for each local/emulator host (or otherwise adjust/suppress with justification), then rerun `./gradlew lintDebug` plus the Unit 02 targeted tests and Android build.

## residualRisks
- No real device or stable emulator UI verification was possible in this host environment.
- SharedPreferences persistence is compile/build validated and behavior is tested through the store interface/in-memory fixture, but there is still no concrete Android/Robolectric persistence test.
- Restart loads the saved base URL without rechecking health and therefore has no persisted prior health metadata; this matches the Unit 02 repair note but remains a product limitation.
- Android network security runtime behavior for IP-literal local hosts remains unproven on device; lint currently fails before this can be treated as clean.
- Lint warnings also remain for dependency freshness, unused `app_name`, missing application icon, and `SharedPreferences.edit` KTX style; these are non-blocking compared with the lint errors.

## noStagedFiles
true

`git diff --cached --stat` produced no output before this verification artifact was written. This artifact itself was written as requested and was not staged.
