# 02 — RED: Server URL onboarding and health verification

## changedFiles
- `apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerUrlNormalizerTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/onboarding/PostboxHealthVerifierTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerOnboardingViewModelTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/02-red.md`

## testsAddedOrUpdated
- `ServerUrlNormalizerTest.normalizesExplicitHttpsServerUrlForHealthChecks`
  - Asserts whitespace is trimmed, an explicit HTTPS base URL is normalized with trailing `/`, `/healthz` is derived from that base URL, and no warning is shown for preferred HTTPS.
- `ServerUrlNormalizerTest.acceptsHttpLoopbackAsExplicitDeveloperUrlButMarksItNonPreferred`
  - Asserts explicit HTTP loopback is still usable for developer scenarios, normalizes to a trailing-slash base URL, derives `/healthz`, and carries a non-HTTPS warning.
- `ServerUrlNormalizerTest.rejectsHostTextWithoutExplicitSchemeBeforeNetworkUse`
  - Asserts host-only text is rejected as `MISSING_SCHEME` before any network caller can use it.
- `ServerUrlNormalizerTest.rejectsUnsupportedSchemesBeforeNetworkUse`
  - Asserts non-HTTP(S) schemes are rejected as `UNSUPPORTED_SCHEME`.
- `PostboxHealthVerifierTest.verifiesValidPostboxHealthAndIgnoresUnknownFields`
  - Uses a JVM-only local socket HTTP fixture to assert the verifier requests `/healthz`, accepts `service: "pi-postbox"` health JSON, preserves service/version/protocolVersion in the success result, and ignores unknown fields.
- `PostboxHealthVerifierTest.rejectsHealthyJsonFromANonPostboxService`
  - Asserts a 200 JSON response from another service is rejected as `NON_POSTBOX_HEALTH`.
- `PostboxHealthVerifierTest.rejectsMalformedPostboxHealthJson`
  - Asserts incomplete Postbox-looking JSON is rejected as `MALFORMED_HEALTH_RESPONSE`.
- `PostboxHealthVerifierTest.reportsUnreachableServersAsRetryableConnectionFailures`
  - Asserts a closed local endpoint becomes `HealthVerificationResult.Unreachable` rather than a saved/valid server.
- `ServerOnboardingViewModelTest.invalidUrlShowsValidationErrorAndDoesNotCallHealthVerifier`
  - Asserts invalid input updates UI/view-model state to `InvalidUrl`, does not call health verification, and does not save.
- `ServerOnboardingViewModelTest.unreachableUrlShowsRetryableErrorWithoutSaving`
  - Asserts a normalized URL is passed to health verification, unreachable health produces retryable `Unreachable` state, and no URL is saved.
- `ServerOnboardingViewModelTest.nonPostboxHealthShowsRejectedServerErrorWithoutSaving`
  - Asserts non-Postbox health produces `NonPostboxServer` state and no save.
- `ServerOnboardingViewModelTest.validPostboxHealthSavesNormalizedUrlAndEntersTheApp`
  - Asserts valid health saves the normalized URL and transitions to `Ready` app state.
- `ServerOnboardingViewModelTest.savedVerifiedUrlIsLoadedOnRestartWithoutRecheckingHealth`
  - Asserts a previously saved verified URL loads into `Ready` state on restart without another health request.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — failed initially because the local HTTP fixture used `com.sun.net.httpserver`, which is unavailable to this Android JVM test compile; the fixture was rewritten to plain `java.net.ServerSocket`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — failed as expected for RED with unresolved onboarding production APIs.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew assembleDebug` — passed, confirming the Android project itself still builds and the RED failure is isolated to the missing onboarding behavior/tests.
- `git status --short && git diff --cached --stat` — passed; showed untracked working files from the Android plan/scaffold and no staged files.

## validationOutput
Targeted RED command after fixing the test-only socket fixture:

```text
> Task :app:compileDebugUnitTestKotlin FAILED
e: .../PostboxHealthVerifierTest.kt:30:26 Unresolved reference 'OkHttpPostboxHealthVerifier'.
e: .../PostboxHealthVerifierTest.kt:33:34 Unresolved reference 'HealthVerificationResult'.
e: .../ServerOnboardingViewModelTest.kt:13:25 Unresolved reference 'ServerOnboardingViewModel'.
e: .../ServerOnboardingViewModelTest.kt:106:9 Unresolved reference 'PostboxHealthVerifier'.
e: .../ServerOnboardingViewModelTest.kt:117:9 Unresolved reference 'VerifiedServerUrlStore'.
e: .../ServerUrlNormalizerTest.kt:11:22 Unresolved reference 'ServerUrlNormalizer'.
e: .../ServerUrlNormalizerTest.kt:13:30 Unresolved reference 'ServerUrlValidationResult'.
e: .../ServerUrlNormalizerTest.kt:36:22 Unresolved reference 'InvalidServerUrlReason'.

FAILURE: Build failed with an exception.
* What went wrong:
Execution failed for task ':app:compileDebugUnitTestKotlin'.
```

Project build sanity check:

```text
cd apps/android && ./gradlew assembleDebug
BUILD SUCCESSFUL in 1s
35 actionable tasks: 35 up-to-date
```

## whyThisIsRED
The targeted Android unit-test task reaches `:app:compileDebugKotlin` successfully and fails only when compiling the new onboarding tests. The unresolved symbols are the intentional missing Unit 02 public behavior surface: URL normalization/validation, Postbox health verification/parsing, verified server URL storage, and onboarding view-model state. `assembleDebug` still passes, so the failure is not because the Android scaffold/build is broken.

## residualRisks
- The persistence behavior is specified through the onboarding store interface and an in-memory test fixture so it can run as a fast JVM test before a concrete DataStore/SharedPreferences choice exists. GREEN should add/keep a small concrete preferences test if it chooses a persistence implementation with meaningful edge cases.
- The tests define a natural public API shape because Unit 01 has only a placeholder activity and no onboarding architecture yet. If GREEN chooses different internal names, it should preserve these behaviors through equivalent public adapters or update the RED contract deliberately.
- HTTP loopback is accepted with a warning based on the plan language “prefer Tailnet HTTPS URLs” rather than “require HTTPS.” If product later requires HTTPS-only on Android, adjust that single normalization test.

## noStagedFiles
true

`git diff --cached --stat` produced no output.
