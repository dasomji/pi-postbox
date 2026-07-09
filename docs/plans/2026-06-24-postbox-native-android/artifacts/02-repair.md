# 02 — REPAIR: Accepted reviewer findings

## changedFiles
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerOnboardingViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/onboarding/ServerUrlNormalizer.kt`
- `apps/android/app/src/main/res/xml/network_security_config.xml`
- `apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerOnboardingViewModelTest.kt`
- `apps/android/app/src/test/java/dev/pi/postbox/onboarding/ServerUrlNormalizerTest.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/02-repair.md`

## testsAddedOrUpdated
- `ServerUrlNormalizerTest.acceptsHttpEmulatorHostAsExplicitDeveloperUrlButMarksItNonPreferred`
- `ServerUrlNormalizerTest.rejectsNonLocalHttpBeforeNetworkUse`
- `ServerOnboardingViewModelTest.validPostboxHealthSavesNormalizedUrlAndEntersTheApp` now asserts parsed service/version/protocol metadata is preserved in `Ready` state.
- `ServerOnboardingViewModelTest.localHttpDeveloperUrlCarriesWarningAfterVerification`
- `ServerOnboardingViewModelTest.editServerUrlAllowsReplacingPreviouslySavedUrl`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — failed as expected after adding repair tests, with unresolved `LOCAL_HTTP_ONLY`, `NON_LOCAL_HTTP`, `health`, `warning`, and `editServerUrl` symbols.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'` — passed after repair implementation.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug` — passed.
- `python3 - <<'PY' ...` over `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.*.xml` plus `git status --short --untracked-files=all` and `git diff --cached --stat` — passed; confirmed test counts and no staged files.

## validationOutput
Targeted RED after tests were added:

```text
> Task :app:compileDebugUnitTestKotlin FAILED
e: .../ServerOnboardingViewModelTest.kt:87:42 Unresolved reference 'health'.
e: .../ServerOnboardingViewModelTest.kt:109:39 Unresolved reference 'LOCAL_HTTP_ONLY'.
e: .../ServerOnboardingViewModelTest.kt:126:19 Unresolved reference 'editServerUrl'.
e: .../ServerUrlNormalizerTest.kt:47:45 Unresolved reference 'NON_LOCAL_HTTP'.
```

Targeted Unit 02 tests after repair:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*'
BUILD SUCCESSFUL in 6s
22 actionable tasks: 14 executed, 8 up-to-date
```

Unit 02 test XML counts:

```text
TEST-dev.pi.postbox.onboarding.PostboxHealthVerifierTest.xml: tests=4 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.ServerOnboardingViewModelTest.xml: tests=7 failures=0 errors=0
TEST-dev.pi.postbox.onboarding.ServerUrlNormalizerTest.xml: tests=6 failures=0 errors=0
```

Android Gradle gate:

```text
cd apps/android && ./gradlew test assembleDebug
BUILD SUCCESSFUL in 6s
64 actionable tasks: 18 executed, 46 up-to-date
```

No staged files check:

```text
git diff --cached --stat
# no output
```

## implementationNotes
- Restricted `http://` input to bounded local/emulator development hosts (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`); all other HTTP URLs now fail validation before health verification.
- Renamed the non-HTTPS warning to `LOCAL_HTTP_ONLY`, carried it through ViewModel network states and `Ready`, and surfaced it in the onboarding/connected UI.
- Added a local-only cleartext network security config and referenced it from the manifest so Android runtime cleartext policy is aligned with the validator.
- Added `VerifiedPostboxHealth` metadata to `Ready` state and display of service/version/protocol on the connected placeholder after successful verification.
- Added an `Edit server URL` action on the connected placeholder that returns to the URL form; verifying the replacement overwrites the saved base URL.

## residualRisks
- No emulator/device runtime smoke was run; validation is JVM unit tests plus debug APK assembly.
- Health metadata is preserved/displayed immediately after verification. A restart still loads the saved URL without rechecking health, so no health metadata is shown until a new verification happens; this preserves the existing Unit 02 restart behavior.
- Android network security config support for raw IP domain entries is build-validated but not device-smoke-tested in this environment.

## noStagedFiles
true
