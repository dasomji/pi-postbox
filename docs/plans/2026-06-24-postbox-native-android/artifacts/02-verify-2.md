# 02 — VERIFY 2: Server URL onboarding after lint repair

## result
PASS

Unit 02 satisfies the specified server URL onboarding scope after the network-security lint repair. The exact requested Android gate (`lintDebug test assembleDebug`) passes with explicit Android SDK environment variables, targeted onboarding JVM tests pass, package-safety Vitest passes, broader repo gates pass, and no files are staged.

## requirementsChecked
- **First-run server URL input:** `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt` routes non-ready states to `ServerOnboardingScreen`, which renders a `Server URL` text field and `Verify server` action.
- **Normalize and validate explicit URLs / prefer Tailnet HTTPS:** `ServerUrlNormalizerTest` passes coverage for HTTPS normalization, explicit scheme requirement, unsupported-scheme rejection, non-local HTTP rejection, and local/emulator HTTP warnings.
- **Call `GET /healthz` and validate Postbox health:** `PostboxHealthVerifierTest` passes coverage for requesting `/healthz`, accepting `service: "pi-postbox"` while ignoring unknown fields, rejecting non-Postbox JSON, rejecting malformed health JSON, and reporting unreachable endpoints as retryable failures.
- **Show service/version/connection result:** `ServerOnboardingViewModelTest.validPostboxHealthSavesNormalizedUrlAndEntersTheApp` passes assertions that `Ready.health` preserves service/version/protocol metadata; source inspection shows `ConnectedPlaceholder` displays that metadata when present and onboarding errors show retryable/rejected connection results.
- **Persist verified base URL:** `ServerOnboardingViewModelTest.validPostboxHealthSavesNormalizedUrlAndEntersTheApp` passes assertion that the normalized verified URL is saved; `SharedPreferencesVerifiedServerUrlStore` is compile/build validated.
- **Saved URL loaded on restart:** `ServerOnboardingViewModelTest.savedVerifiedUrlIsLoadedOnRestartWithoutRecheckingHealth` passes and confirms saved URL load does not make a health request.
- **Allow editing/replacing saved URL:** `ServerOnboardingViewModelTest.editServerUrlAllowsReplacingPreviouslySavedUrl` passes; `ConnectedPlaceholder` exposes an `Edit server URL` button wired to `editServerUrl()` and replacement verification/save.
- **Lint repair for local cleartext policy:** `network_security_config.xml` now has `includeSubdomains="false"` on `localhost`, `127.0.0.1`, `::1`, and `10.0.2.2`; `./gradlew lintDebug` passes with 0 errors.
- **No automatic discovery / port scanning / package-local autostart / Android metadata fallback:** Source inspection found only explicit URL input, normalization, `/healthz` verification, and persisted base URL storage for Unit 02.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew lintDebug test assembleDebug` — **passed**. `BUILD SUCCESSFUL in 1s`; 74 actionable tasks, 1 executed, 73 up-to-date. Lint report: 0 errors, 8 warnings.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — **passed**. `BUILD SUCCESSFUL in 1s`; 22 actionable tasks, 1 executed, 21 up-to-date.
- `npx vitest run apps/androidScaffold.test.ts` — **passed**. 1 file / 4 tests passed; includes npm workspace/files allowlist checks and `npm pack --dry-run --json` package exclusion check.
- `python3 - <<'PY' ...` over Unit 02 JUnit XML plus lint summary — **passed**. Confirmed Unit 02 test counts and lint summary.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; adb devices; emulator -accel-check || true; stat apps/android/app/build/outputs/apk/debug/app-debug.apk` — **completed for product-evidence feasibility**. No attached devices; emulator acceleration unavailable; debug APK exists.
- `npm test` — **passed**. 43 files / 236 tests passed.
- `npm run typecheck` — **passed**. `tsc -b` completed.
- `npm run build` — **passed**. TypeScript build, web Vite production build, and server public asset copy completed.
- `npm run smoke` — **passed**. Local smoke verified `/healthz`, UI shell, fake extension registration, SSE, answer, state, and history.
- `git diff --stat; git diff --cached --stat; git status --short --untracked-files=all | sed -n '1,380p'` — **passed before artifact write**. No tracked diff output and no staged diff output; Unit 01/02 Android and plan files remain untracked.

## evidenceArtifacts
- Android lint report: `apps/android/app/build/intermediates/lint_intermediate_text_report/debug/lintReportDebug/lint-results-debug.txt` — `0 errors, 8 warnings`; previous `NetworkSecurityConfig` errors are gone.
- Targeted Unit 02 JUnit XML:
  - `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.PostboxHealthVerifierTest.xml` — 4 tests, 0 failures, 0 errors, 0 skipped.
  - `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.ServerOnboardingViewModelTest.xml` — 7 tests, 0 failures, 0 errors, 0 skipped.
  - `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.ServerUrlNormalizerTest.xml` — 6 tests, 0 failures, 0 errors, 0 skipped.
- Debug APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk` exists, 17,725,589 bytes.
- Smoke transcript in command output: `Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.`
- Device/UI evidence: attempted but blocked; see `skippedGates`.

## skippedGates
- Emulator/device UI smoke — skipped because `adb devices` showed no attached devices and `emulator -accel-check` reported `KVM requires a CPU that supports vmx or svm`. This environment can provide JVM/unit/build/APK evidence but cannot run the app UI on Android hardware/emulator.
- Instrumented Android tests — not present/discovered for this unit, and no device/emulator is available.

## issuesFound
- None blocking or actionable for Unit 02 verification.

## residualRisks
- No real-device or stable-emulator runtime networking/UI validation was possible in this host environment.
- `SharedPreferencesVerifiedServerUrlStore` is compile/build validated and behavior is covered through the store interface with an in-memory fixture, but there is no concrete Android/Robolectric persistence test.
- Restart loads the saved base URL without rechecking health or persisting prior health metadata; this matches the recorded Unit 02 repair behavior but remains a product limitation.
- Android lint still reports 8 non-blocking warnings: dependency freshness, unused `app_name`, missing application icon, and `SharedPreferences.edit` KTX style.
- Android implementation files are currently untracked, so diff assessment is based on source inspection/status rather than a tracked diff against HEAD.

## noStagedFiles
true

`git diff --cached --stat` produced no output before this verification artifact was written. This artifact itself was written as requested and was not staged.
