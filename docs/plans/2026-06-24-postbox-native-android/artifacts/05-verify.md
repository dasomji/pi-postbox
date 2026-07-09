# 05 — VERIFY: Notifications and developer install workflow after repair

## result
FAIL

Automated gates passed and APK/package evidence is present, but source verification found one scope-compliance issue: notification observation is started from composition and only stopped on composition disposal, not Android foreground/started lifecycle. That can keep the SSE workflow active after the Activity is backgrounded and post local notifications without an opt-in foreground sync service, which violates Unit 05's "while the app is active or while an explicit foreground sync mode is enabled" boundary.

## requirementsChecked
- Android 13+ notification permission handling: PASS. `AndroidManifest.xml` declares `POST_NOTIFICATIONS`; `MainActivity.kt:56-95` uses `ActivityResultContracts.RequestPermission`; `AndroidPendingQuestionNotifier.kt:48-67` gates posting on current permission and swallows revocation races so workflow remains usable.
- Newly observed pending question posts one local notification and replay/idempotent state does not duplicate: PASS by JVM tests. `PendingQuestionNotificationTrackerTest` has 6 passing tests; `QuestionWorkflowViewModelTest` has 12 passing tests including fetched/SSE notification wiring. Source evidence: snapshots call `PendingQuestionNotificationTracker.observe()` at `QuestionWorkflowViewModel.kt:306-310`; Android posting calls `NotificationManager.notify()` at `AndroidPendingQuestionNotifier.kt:53-65`.
- Tapping a notification opens/selects the relevant question when still present: PASS by JVM/source evidence. `AndroidPendingQuestionNotifier.kt:86-99` builds an explicit immutable `PendingIntent`; `AndroidPendingQuestionNotifier.kt:113-117` extracts request id from tap intents; `MainActivity.kt:66`, `MainActivity.kt:86-89`, and `MainActivity.kt:255-259` route tap request ids to `QuestionWorkflowViewModel.openQuestionFromNotification()`.
- Notification permission denied leaves app functional and explains notifications are disabled: PASS by tests/source. `PendingQuestionNotificationTrackerTest` and `QuestionWorkflowViewModelTest` cover denial; `NotificationPermissionState.Denied` says notifications are disabled while loading/answering/cancelling remains usable.
- Active-app-only notification scope / no foreground sync unless opt-in persistent service: FAIL. `MainActivity.kt:249-250` starts the workflow in a `LaunchedEffect`; `MainActivity.kt:261-262` closes it only when the composition is disposed. There is no `Lifecycle`, `repeatOnLifecycle`, `onStop`, foreground-service, or opt-in foreground sync wiring in `apps/android/app/src/main/java`. A stopped/background Activity can retain composition/coroutines, so SSE observation and notification posting can continue outside foreground-active use.
- Developer build/install documentation: PASS. `apps/android/README.md` documents SDK env, `./gradlew test assembleDebug lintDebug`, APK path, `adb install -r`, Tailnet HTTPS server URL, emulator `10.0.2.2` fallback, notification/Web Push/FCM limitations, and evidence limitations. `apps/androidDeveloperInstallDocs.test.ts` passed.
- Android app remains outside npm package: PASS. `npm pack --dry-run --json` parsed 728 package entries and found 0 Android/doc-test entries.
- APK assembled: PASS. `apps/android/app/build/outputs/apk/debug/app-debug.apk` exists (17 MiB), SHA-256 `e72ef427599d3a341eb012f17b7a91a9a9b8ed8e1581a91015e005375337c256`; `aapt dump badging` reports package `dev.pi.postbox`, version `0.1.0`, min SDK 26, target SDK 36, and `android.permission.POST_NOTIFICATIONS`.

## commandsRun
- `git status --short --untracked-files=all && git diff --cached --stat && git diff --stat` — passed; Android/docs plan tree is untracked, no staged files, no tracked diff stat.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*' --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'` — passed; `BUILD SUCCESSFUL in 1s`, 22 actionable tasks, 1 executed.
- `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — passed; 1 file / 1 test passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed; `BUILD SUCCESSFUL in 4s`, 74 actionable tasks, 2 executed.
- `npm test` — passed; 44 files / 237 tests passed.
- `npm run typecheck` — passed; `tsc -b` completed with no errors.
- `npm run build` — passed; TypeScript build, web Vite build, and web asset copy completed.
- `npm run smoke` — passed; local server smoke verified health, UI shell, fake extension registration, SSE, answer, state, and history.
- `npm pack --dry-run --json > /tmp/pi-postbox-npm-pack-05-verify.json` plus parser — passed; 728 package entries, 0 Android entries.
- `ls -lh`, `sha256sum`, `unzip -l` for `apps/android/app/build/outputs/apk/debug/app-debug.apk` — passed; APK exists and is inspectable. The host lacks the `file` command, so MIME/file-type output was skipped.
- `aapt dump badging apps/android/app/build/outputs/apk/debug/app-debug.apk` and `apksigner verify --print-certs ...` — passed; package/SDK/permission metadata and Android debug signer certificate printed.
- `emulator -accel-check || true; adb devices` with explicit SDK env — completed; KVM acceleration unavailable and no attached devices listed.
- `python3` XML summary over `apps/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` — passed; `PendingQuestionNotificationTrackerTest` tests=6 failures=0 errors=0, `QuestionWorkflowViewModelTest` tests=12 failures=0 errors=0.
- `grep`/`nl` source review commands over Android notification/lifecycle wiring — passed; used to confirm notification wiring and lifecycle gap.

## evidenceArtifacts
- APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- APK SHA-256: `e72ef427599d3a341eb012f17b7a91a9a9b8ed8e1581a91015e005375337c256`
- Package dry-run raw output: `/tmp/pi-postbox-npm-pack-05-verify.json` (local temp; parsed to confirm 0 Android entries)
- Gradle test XML: `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.notification.PendingQuestionNotificationTrackerTest.xml` and `apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml`
- Product/device evidence: blocked. `emulator -accel-check` reports `KVM requires a CPU that supports vmx or svm`; `adb devices` lists no attached device. No screenshot/video/installed notification tap evidence was possible safely in this environment.

## skippedGates
- Emulator install/smoke and notification tap screenshot/video — blocked by KVM acceleration unavailability and no attached Android device.
- Physical-device `adb install -r ...` — blocked because `adb devices` listed no devices.
- `file apps/android/app/build/outputs/apk/debug/app-debug.apk` — skipped because the host does not have the `file` command; `unzip`, `aapt`, `apksigner`, `ls`, and `sha256sum` provided APK evidence instead.

## issuesFound
- blocker: `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt:249-262` / `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt:306-310` — notification/SSE workflow is not tied to the foreground Activity lifecycle. It starts in `LaunchedEffect` and only closes on composition disposal, while every observed snapshot can post notifications. With no `Lifecycle`/`repeatOnLifecycle`/`onStop` gate and no opt-in foreground service, the app can continue observing SSE and posting notifications after being backgrounded, contrary to Unit 05's active-app-only notification scope unless foreground sync is explicitly enabled with a persistent foreground-service notification.

## residualRisks
- No real Android device or stable emulator was available, so OS notification tray rendering, runtime permission dialog UX, installed APK launch, and actual `PendingIntent` tap delivery remain unverified outside JVM/source/build evidence.
- Android app and plan artifacts are currently untracked in this workspace, so `git diff --stat` does not provide a conventional tracked-file diff.
- The verifier did not edit implementation files; only this verification artifact was written.

## noStagedFiles
true
