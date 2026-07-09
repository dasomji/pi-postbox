# Final verification — whole native Android prototype

## result
PASS

The whole native Android prototype satisfies the original scope by source review, prior review/repair/rereview artifacts, Android JVM/build/lint gates, root TypeScript/Vitest/build/smoke gates, npm package-exclusion checks, APK inspection/signature/hash evidence, and staged-file checks. Runtime install/UI/notification-tap smoke remains blocked by this host having no attached Android device and no KVM-backed emulator acceleration.

## requirementsChecked
- **Same repo, isolated package shape:** PASS. The Android project lives under `apps/android/` and remains self-contained with its own Gradle wrapper/settings/build files. Root `package.json` still publishes through an explicit `files` allowlist and has no `apps/android` entry; `apps/android/package.json` is absent. `npm pack --dry-run` and `npm pack --dry-run --ignore-scripts` both reported `androidEntries=0`.
- **Developer-installable native Android prototype:** PASS. `apps/android/README.md:1-35` documents SDK env, `./gradlew test assembleDebug lintDebug`, APK path, and `adb install -r`; full Android `test assembleDebug lintDebug` passed; APK exists at `apps/android/app/build/outputs/apk/debug/app-debug.apk`.
- **Tailscale / explicit URL trust boundary:** PASS. `apps/android/README.md:44-62` directs real devices to a Tailnet HTTPS URL and warns not to publicly expose the server; `ServerUrlNormalizer.kt:16-30` allows `https://` generally and restricts `http://` to local development hosts only; source sweep found no Android package-local autostart, active-local fallback, Tailscale Serve mutation, port scanning, or extension WebSocket use.
- **Server verification before saving:** PASS. `MainActivity.kt:70-75` wires `ServerOnboardingViewModel` with `OkHttpPostboxHealthVerifier` and persisted URL store; `PostboxHealthVerifier.kt` verifies `GET /healthz` and accepts only healthy `service = pi-postbox`; targeted onboarding tests passed (`PostboxHealthVerifierTest`, `ServerOnboardingViewModelTest`, `ServerUrlNormalizerTest`).
- **Core question workflow:** PASS. `PostboxProtocolClient.kt:31-49` implements `GET /api/state`, answer, and cancel endpoints; `PostboxStateStream.kt:37-79` implements `/api/state/events` SSE with reconnect; `QuestionWorkflowViewModel.kt:105-151` gates answer/cancel mutations, posts correct payloads, and handles already-resolved conflicts; `QuestionWorkflowScreen.kt` provides list/detail/answer/cancel UI wiring; targeted protocol/question tests passed.
- **Active-app local notifications without background-push overreach:** PASS. `MainActivity.kt:255-270` starts/closes the workflow on `ON_START`/`ON_STOP`; `QuestionWorkflowViewModel.kt:311-318` only observes/posts notification events while `observationActive`; `AndroidPendingQuestionNotifier.kt` gates posting on `POST_NOTIFICATIONS`, uses private notification body text, and builds tap intents; source sweep found no FCM, WorkManager, foreground service, or always-on sync implementation. Unit 05 review/repair/rereview and final review/repair/rereview artifacts show earlier findings were repaired.
- **Repository baseline gates remain green:** PASS. Root `npm test`, `npm run typecheck`, `npm run build`, and `npm run smoke` passed after the Android addition.
- **No staged files:** PASS. `git diff --cached --stat` produced no output before writing this final verification artifact, and the final status check after writing it also found no staged files.

## commandsRun
- `git status --short --untracked-files=all && git diff --cached --stat` — **passed**; full Android/docs plan tree is untracked, no staged files.
- `java -version; command -v sdkmanager adb emulator aapt apksigner; adb devices; emulator -accel-check; emulator -list-avds` with explicit Android SDK env — **passed/blocked runtime**; OpenJDK 21 and SDK tools present, `adb devices` listed no attached devices, `emulator -accel-check` reported KVM unavailable, AVDs `postbox_api30` and `postbox_api36` exist.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/build-tools/36.0.0:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.onboarding.*' --tests 'dev.pi.postbox.protocol.*' --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest' --tests 'dev.pi.postbox.notification.*'` — **passed**; `BUILD SUCCESSFUL in 4s`.
- `cd apps/android && ./gradlew test assembleDebug lintDebug` with the same SDK env — **passed**; `BUILD SUCCESSFUL in 4s`, 74 actionable tasks, 2 executed.
- `npx vitest run apps/androidScaffold.test.ts apps/androidDeveloperInstallDocs.test.ts "apps/**/*.static.test.ts"` — **passed**; Android scaffold/docs tests: 2 files / 5 tests.
- `npx vitest run $(find apps -name '*.static.test.ts' -print | sort)` — **passed**; static Vitest tests: 5 files / 24 tests.
- `npm test` — **passed**; 44 Vitest files / 237 tests.
- `npm run typecheck` — **passed**; `tsc -b` completed with no errors.
- `npm run build` — **passed**; TypeScript build, Vite production build, and web asset copy completed.
- `npm run smoke` — **passed**; packaged-path smoke verified health, UI shell, fake extension registration, SSE, answer, state, and history.
- `npm pack --dry-run --ignore-scripts --json > /tmp/pi-postbox-final-npm-pack-ignore-scripts.json` plus parser — **passed**; 728 files, `androidEntries=0`, top-level entries `README.md,node_modules,package.json,packages`.
- `npm pack --dry-run --json > /tmp/pi-postbox-final-npm-pack.json` plus parser — **passed**; prepack build ran, 728 files, `androidEntries=0`.
- `ls -lh`, `stat`, `sha256sum`, `unzip -l`, `aapt dump badging`, and `apksigner verify --print-certs` for `apps/android/app/build/outputs/apk/debug/app-debug.apk` — **passed**; APK exists, contains manifest/classes, declares package `dev.pi.postbox`, min SDK 26, target SDK 36, `INTERNET` and `POST_NOTIFICATIONS`, and verifies with Android Debug signer.
- `python3` XML summary over `apps/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` — **passed**; 8 Android debug unit test suites, 49 tests total, 0 failures/errors/skips.
- `grep -RIn --exclude-dir=build --exclude-dir=.gradle --exclude-dir=.kotlin ...` over Android source/docs — **passed**; confirmed endpoint/lifecycle/notification signals and absence of FCM/WorkManager/foreground-service/autostart/WebSocket overreach.
- Final `git status --short --untracked-files=all && git diff --cached --stat && git diff --stat` — **passed**; no tracked diff and no staged files before this artifact was written.

## evidenceArtifacts
- **Handoff APK:** `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- **APK SHA-256:** `8992460481a0bb0a737d52b352e038ea772754eec5a1f5d25c2aac525703a85f`
- **APK size:** `17,725,791` bytes (`17M`)
- **APK signature evidence:** `apksigner verify --print-certs` passed; signer DN `C=US, O=Android, CN=Android Debug`; signer certificate SHA-256 `16ab783998f20c826f4275935fc151282a00dccd2e776a23b34457e34d1dc99d`.
- **APK metadata evidence:** `aapt dump badging` reports package `dev.pi.postbox`, version `0.1.0`, min SDK `26`, target SDK `36`, permissions `android.permission.INTERNET` and `android.permission.POST_NOTIFICATIONS`.
- **Android unit reports:** `apps/android/app/build/test-results/testDebugUnitTest/` and `apps/android/app/build/test-results/testReleaseUnitTest/`.
- **Android lint report:** `apps/android/app/build/reports/lint-results-debug.html`.
- **npm pack captures:** `/tmp/pi-postbox-final-npm-pack.json` and `/tmp/pi-postbox-final-npm-pack-ignore-scripts.json` (both local temp evidence; both parsed to `androidEntries=0`).
- **Product/runtime evidence fallback:** root `npm run smoke` transcript in this verification session proves the existing Postbox API/SSE/answer workflow. Installed Android UI/notification evidence is blocked by no attached device and no KVM.

## skippedGates
- **Android runtime emulator/device smoke, `adb install`, UI screenshot/video, notification tray rendering, and PendingIntent tap proof:** skipped because `adb devices` listed no attached devices and `emulator -accel-check` reported `KVM requires a CPU that supports vmx or svm`. AVDs exist, but software emulator was previously documented as slow/unreliable; launching it for final evidence was not safe/useful within this environment.
- **Android instrumented connected-device tests:** skipped for the same no-device/no-KVM reason; no instrumented test suite was discovered under `apps/android/app/src/androidTest`.
- **Production/release signing:** out of scope for developer-installable debug prototype; debug APK signature was verified instead.

## issuesFound
- No blockers.
- No actionable findings.

## residualRisks
- No physical-device or stable emulator proof was collected, so installed APK launch, real onboarding text entry, Android 13 permission dialog UX, OS notification tray rendering, and actual notification tap delivery remain unverified outside source/JVM/build evidence.
- The Android app and plan artifacts are currently untracked, so tracked `git diff --stat` is empty; review relied on untracked file enumeration and direct file/source inspection.
- QR-code server URL entry is not implemented; this is acceptable for the current plan because Unit 02 explicitly allowed QR/deep-link scanning to be deferred.

## noStagedFiles
true

## handoffApk
- Path: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256: `8992460481a0bb0a737d52b352e038ea772754eec5a1f5d25c2aac525703a85f`
