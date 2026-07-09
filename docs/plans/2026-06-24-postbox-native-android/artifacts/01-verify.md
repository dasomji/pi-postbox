# 01 — VERIFY: Android scaffold and build pipeline

## result
PASS

## requirementsChecked
- **Self-contained native Android Gradle project under `apps/android`: PASS.** Verified required project files are present: `apps/android/settings.gradle.kts`, `apps/android/build.gradle.kts`, `apps/android/gradle.properties`, `apps/android/gradlew`, `apps/android/gradlew.bat`, `apps/android/gradle/wrapper/gradle-wrapper.jar`, `apps/android/gradle/wrapper/gradle-wrapper.properties`, `apps/android/app/build.gradle.kts`, app manifest, resources, and `MainActivity.kt`.
- **Kotlin/AGP/Compose/Material 3/OkHttp/kotlinx.serialization configuration: PASS.** `apps/android/build.gradle.kts` declares AGP `8.10.1`, Kotlin Android `2.1.21`, Compose compiler plugin, and serialization plugin. `apps/android/app/build.gradle.kts` declares Compose BOM, Material 3, OkHttp, kotlinx serialization JSON, and JUnit.
- **Minimal native launcher activity with placeholder Compose screen: PASS.** `apps/android/app/src/main/AndroidManifest.xml` registers `.MainActivity` with `MAIN`/`LAUNCHER`; `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt` renders a placeholder Compose UI.
- **Debug APK builds: PASS.** `cd apps/android && ./gradlew assembleDebug` completed successfully with explicit Android SDK environment. APK exists at `apps/android/app/build/outputs/apk/debug/app-debug.apk`.
- **Android Gradle unit gate: PASS with no test sources.** `cd apps/android && ./gradlew test` completed successfully; Gradle reported `testDebugUnitTest NO-SOURCE` and `testReleaseUnitTest NO-SOURCE`, expected for this scaffold-only unit.
- **Root npm workspace shape/package safety: PASS.** `npm query .workspace --json` resolves only `apps/web`, `packages/extension`, `packages/protocol`, and `packages/server`; `apps/android/package.json` is absent.
- **npm publish safety: PASS.** `npm pack --dry-run --json` after prepack build produced `androidEntries: 0`; `apps/android` is not in the package tarball.
- **Generated Android outputs ignored: PASS.** `git check-ignore` confirmed `apps/android/.gradle/`, `apps/android/.kotlin/`, `apps/android/app/build/`, and `apps/android/local.properties` are covered by `apps/android/.gitignore`.
- **Root repo gates from the unit scenario: PASS after rerun.** Targeted Vitest, root `npm test`, `npm run typecheck`, `npm run build`, and `npm run smoke` all passed in final runs. One initial full `npm test` run had two transient failures in `packages/extension/test/autostart.test.ts`; rerunning the failed file and then full `npm test` passed.

## commandsRun
- `git status --short && git diff --cached --stat && git diff --stat` — PASS; untracked scaffold/test/plan files only, no staged diff.
- `npx vitest run apps/androidScaffold.test.ts` — PASS; 1 file, 4 tests passed.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test` — PASS; `BUILD SUCCESSFUL in 2s`, unit tests currently `NO-SOURCE`.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew assembleDebug` — PASS; `BUILD SUCCESSFUL in 1s`.
- `test -f apps/android/app/build/outputs/apk/debug/app-debug.apk && ls -lh ... && stat -c ... && sha256sum ...` — PASS; APK exists, 10,933,183 bytes, SHA-256 `ae91c9711894029a27999257fba887c3a1c1eb170b54d32d1050fed4ee2b57e2`.
- `npm pack --dry-run --json` with JSON extraction after prepack output — PASS; prepack build completed, package has 728 files and `androidEntries: 0`.
- `npm pack --dry-run --json --ignore-scripts` — PASS; package has 728 files and `androidEntries: 0`.
- `npm query .workspace --json | node ... && test ! -e apps/android/package.json` — PASS; Android is not an npm workspace/package.
- Scaffold/dependency grep inspection command — PASS; expected files, plugin/dependency signals, launcher/theme/resource signals found.
- `test -x apps/android/gradlew && git check-ignore -v ...` — PASS; wrapper executable and generated Android output paths ignored.
- `npm test` — FAIL once; `packages/extension/test/autostart.test.ts:302` and `:335` failed in the initial full run.
- `npx vitest run packages/extension/test/autostart.test.ts` — PASS; 9 tests passed.
- `npm test` — PASS on rerun; 43 files, 236 tests passed.
- `npm run typecheck && npm run smoke` — PASS; typecheck passed and smoke verified health, UI shell, fake extension registration, SSE, answer, state, and history.
- `npm run build` — PASS; TypeScript build, web Vite build, and copy-web-to-server completed.
- `git status --short && git status --short --ignored=matching apps/android && git diff --cached --stat` — PASS; untracked intended files and ignored Android build directories; no staged files.

## evidenceArtifacts
- APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
  - Size: `10,933,183` bytes (`ls -lh`: `11M`)
  - SHA-256: `ae91c9711894029a27999257fba887c3a1c1eb170b54d32d1050fed4ee2b57e2`
- CLI evidence: command outputs in this verification session for targeted Vitest, Gradle `test`, Gradle `assembleDebug`, npm pack dry-run, root gates, and git staged-file checks.
- Verification artifact: `docs/plans/2026-06-24-postbox-native-android/artifacts/01-verify.md`

## skippedGates
- Emulator/device install smoke: skipped because Unit 01 acceptance is build-scaffold focused and `00-preflight.md` documents KVM/attached-device limitations. No real Android device is attached; emulator boot was previously unreliable in this environment.
- Instrumented Android tests: skipped because the scaffold does not define instrumented tests yet.

## issuesFound
- `warning: packages/extension/test/autostart.test.ts:302` — initial full `npm test` run failed waiting for mocked `spawn` to be called; targeted rerun and full rerun passed, so this appears transient/unrelated to the Android scaffold.
- `warning: packages/extension/test/autostart.test.ts:335` — initial full `npm test` run observed one unexpected mocked `spawn` call; targeted rerun and full rerun passed, so this appears transient/unrelated to the Android scaffold.
- No blocking Unit 01 scaffold/package-safety issues found.

## residualRisks
- Android `./gradlew test` has no test sources yet (`NO-SOURCE`), so it validates Gradle wiring but not app behavior.
- Device/emulator runtime behavior remains unverified due the preflight KVM/device limitations.
- `docs/plans/2026-06-24-postbox-native-android/index.md` still begins with “Current state: PLAN CREATED. No Android project has been scaffolded yet.” This is stale after Unit 01 but does not block scaffold/build verification.
- Gradle wrapper JAR was structurally present and executed successfully; no independent upstream checksum verification was performed.

## noStagedFiles
true

`git diff --cached --stat` produced no output after verification.
