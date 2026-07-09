# 05 — VERIFY 2: Lifecycle-repaired active-app notifications

## result
PASS

Unit 05 satisfies the lifecycle-repaired scope by source review and safe gates. Local notification observation is wired only while the connected Android workflow is active/started, permission denial leaves the workflow usable, repeated snapshots do not duplicate request notifications, debug install documentation is present, Android build/lint/tests are green, the native Android tree remains excluded from the npm package tarball, and a debug APK exists.

## requirementsChecked
- **Android 13+ notification permission handling:** `AndroidManifest.xml` declares `POST_NOTIFICATIONS`; `MainActivity.kt:58-61` registers `RequestPermission`; `MainActivity.kt:95-98` launches it only when needed; `AndroidPendingQuestionNotifier.kt:47-68` checks permission and catches revocation races before posting; `PendingQuestionNotificationTrackerTest` covers denied/not-required policy.
- **Active-app-only local notification scope:** `MainActivity.kt:255-270` starts the workflow on `ON_START`, closes it on `ON_STOP`, and closes on dispose. `QuestionWorkflowViewModel.kt:50-59`, `179-184`, and `311-318` maintain `observationActive`, close the SSE stream, and suppress notification tracker/poster calls when inactive. `QuestionWorkflowViewModelTest.kt:304-363` covers stop suppression, stream close, restart, and foreground-only resumed notification.
- **New pending question notification and idempotency:** `PendingQuestionNotificationTracker.kt:19-38` baselines first state, tracks seen request ids, and emits only newly observed pending requests. `PendingQuestionNotificationTrackerTest` and `QuestionWorkflowViewModelTest.kt:263-301` cover one notification for a later new request and no duplicate on replay.
- **Notification tap target opens relevant question when present:** `AndroidPendingQuestionNotifier.kt:86-117` creates/extracts immutable explicit tap intents carrying request id; `MainActivity.kt:68`, `92`, and `275-279` route the request id to `openQuestionFromNotification`; `QuestionWorkflowViewModelTest` covers selecting the tapped question from a later snapshot.
- **No foreground/background overreach:** Source grep found no `startForeground`, foreground-service component, WorkManager, Firebase, or FCM implementation. `apps/android/README.md:64-74` documents active connected-workflow local notifications only and explicitly excludes FCM/background push/foreground service/always-on sync.
- **Developer install/debug APK documentation:** `apps/android/README.md` documents SDK env, `./gradlew test assembleDebug lintDebug`, APK path, `adb install -r`, Tailnet HTTPS URL guidance, emulator `10.0.2.2`, notification limitations, and device evidence limits. `apps/androidDeveloperInstallDocs.test.ts` passes.
- **npm package exclusion:** `npm pack --dry-run --ignore-scripts --json` reported `androidEntries=0` and included only `README.md,node_modules,package.json,packages` top-level entries.
- **No staged files:** `git diff --cached --stat` produced no output before writing this verification artifact.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.notification.*' --tests 'dev.pi.postbox.question.QuestionWorkflowViewModelTest'` — **passed**; `BUILD SUCCESSFUL in 1s`, 22 actionable tasks, 1 executed.
- `npx vitest run apps/androidDeveloperInstallDocs.test.ts` — **passed**; 1 test file / 1 test passed, duration 222ms.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — **passed**; `BUILD SUCCESSFUL in 4s`, 74 actionable tasks, 2 executed.
- `npm test` — **passed**; 44 Vitest files / 237 tests passed, duration 15.57s.
- `npm run typecheck` — **passed**; `tsc -b` completed with no errors.
- `npm run build` — **passed**; TypeScript build, web Vite production build, and web asset copy completed.
- `npm pack --dry-run --json > /tmp/pi-postbox-pack-dry-run.json` followed by direct JSON parse — **failed then recovered**; npm prepack/Vite logs polluted stdout before JSON, causing the first parser to fail. The dry-run itself completed and a subsequent parse of the captured JSON confirmed `androidEntries=0`.
- `npm pack --dry-run --ignore-scripts --json | node ...` — **passed**; `packEntries=728`, `packageSize=739860`, `unpackedSize=4458045`, `androidEntries=0`, `includedTopLevel=README.md,node_modules,package.json,packages`.
- `stat/sha256sum/zip inspection/apksigner verify` for `apps/android/app/build/outputs/apk/debug/app-debug.apk` — **passed**; APK exists, size `17725791` bytes, SHA-256 `ac8fbea5feeac26bb866af574c0e44ad0ffe76b08d480b5869f6ba5998bf8699`, contains `AndroidManifest.xml` and `classes.dex`, and verifies with Android Debug signer certificate SHA-256 `16ab783998f20c826f4275935fc151282a00dccd2e776a23b34457e34d1dc99d`.
- `adb devices; emulator -list-avds; test -e /dev/kvm` — **blocked for runtime smoke**; no attached devices, AVDs `postbox_api30` and `postbox_api36` exist, `/dev/kvm` is missing.
- `grep -RIn --exclude-dir=build ... apps/android/app/src apps/android/README.md apps/androidDeveloperInstallDocs.test.ts` and `nl -ba ...` excerpts — **passed**; collected source/test/doc evidence for lifecycle gating, posting, permission, tap routing, docs accuracy, and no background/foreground-service implementation.
- `git status --short --untracked-files=all && git diff --cached --stat` — **passed**; Android/docs plan tree is untracked and no files are staged.

## evidenceArtifacts
- Debug APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk` (`17725791` bytes, SHA-256 `ac8fbea5feeac26bb866af574c0e44ad0ffe76b08d480b5869f6ba5998bf8699`).
- Android lint report from gate: `apps/android/app/build/reports/lint-results-debug.html`.
- Android unit test reports from gate: `apps/android/app/build/test-results/testDebugUnitTest/` and `apps/android/app/build/test-results/testReleaseUnitTest/`.
- npm pack dry-run capture: `/tmp/pi-postbox-pack-dry-run.json` (local temp; confirms `androidEntries=0` after skipping prepack-log prefix).
- Runtime device smoke evidence is blocked: `adb devices` listed no devices and `/dev/kvm` is missing, so emulator launch/device install/notification tray/tap proof could not be safely collected in this environment.

## skippedGates
- **Android runtime smoke / `adb install` / notification tray and PendingIntent tap proof:** skipped because `adb devices` returned no attached devices and `/dev/kvm` is missing despite AVD definitions. This matches the requested KVM/no-device limitation note.
- **Android instrumented connected-device tests:** skipped for the same no-device/no-KVM reason.
- **Additional root gates beyond `npm test`, `npm run typecheck`, `npm run build`, and npm pack dry-run:** none identified in package scripts/README.

## issuesFound
- No blockers.
- No actionable findings.

## residualRisks
- Actual OS notification tray rendering, Android 13 runtime permission dialog UX, `adb install`, and real PendingIntent tap delivery remain unverified without a physical device or KVM-backed emulator.
- The Android app and plan artifacts are currently untracked in this workspace, so `git diff --stat` does not provide a conventional tracked-file diff.
- The first `npm pack --dry-run --json` parser command failed because lifecycle script logs preceded JSON output; a clean `--ignore-scripts` dry run and a recovered parse of the captured dry run both confirmed the Android app/test files are excluded.

## noStagedFiles
true
