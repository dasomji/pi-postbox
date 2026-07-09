# 01 — RED: Android scaffold and package-safety tests

## changedFiles
- `apps/androidScaffold.test.ts`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/01-red.md`

## testsAddedOrUpdated
- `apps/androidScaffold.test.ts` — `native Android scaffold > provides a self-contained Gradle Android project under apps/android`
  - Asserts `apps/android` contains a self-contained Gradle project: `settings.gradle.kts`, root `build.gradle.kts`, `gradlew`, Gradle wrapper jar/properties, and `app/build.gradle.kts`.
  - Once files exist, asserts the app module includes Android application/Kotlin/Compose support plus Material 3, OkHttp, and kotlinx.serialization signals.
- `apps/androidScaffold.test.ts` — `native Android scaffold > declares the app manifest and a MainActivity entry point`
  - Asserts `apps/android/app/src/main/AndroidManifest.xml` exists.
  - Once the manifest exists, asserts a native `MainActivity.kt`/`.java` source file exists and the manifest registers MainActivity as the launcher activity.
- `apps/androidScaffold.test.ts` — `native Android scaffold > keeps apps/android out of root npm workspaces and publish allowlists`
  - Asserts root `package.json` has no explicit `apps/android` workspace entry or root publish `files` entry.
  - Asserts `apps/android/package.json` does not exist.
  - Asserts `npm query .workspace --json` does not resolve `apps/android` as an npm workspace.
- `apps/androidScaffold.test.ts` — `native Android scaffold > keeps the Android scaffold out of npm pack dry-run output`
  - Runs `npm pack --dry-run --json` and asserts no packed path is `apps/android` or starts with `apps/android/`.
  - Also asserts `apps/android` exists so the dry-run exclusion is meaningful once the scaffold is implemented.

## commandsRun
- `git status --short` — checked starting worktree state; showed the existing untracked native Android plan directory.
- `npm query .workspace --json` — exploratory package-safety check; confirmed current npm workspaces resolve to `apps/web` and `packages/*`, not `apps/android`.
- `npx vitest run apps/androidScaffold.test.ts` — failed as expected for RED.
- `git status --short` — checked final worktree state; only untracked test/report/plan files, no staged markers.
- `git diff --cached --stat` — no output, confirming nothing is staged.

## validationOutput
```text
RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

❯ apps/androidScaffold.test.ts (4 tests | 3 failed) 5359ms
    × provides a self-contained Gradle Android project under apps/android
    × declares the app manifest and a MainActivity entry point
    × keeps the Android scaffold out of npm pack dry-run output

FAIL apps/androidScaffold.test.ts > native Android scaffold > provides a self-contained Gradle Android project under apps/android
AssertionError: apps/android must be a self-contained Gradle project with its own wrapper and app module: expected [ …(6) ] to deeply equal []
Received missing files:
- apps/android/settings.gradle.kts
- apps/android/build.gradle.kts
- apps/android/gradlew
- apps/android/gradle/wrapper/gradle-wrapper.jar
- apps/android/gradle/wrapper/gradle-wrapper.properties
- apps/android/app/build.gradle.kts

FAIL apps/androidScaffold.test.ts > native Android scaffold > declares the app manifest and a MainActivity entry point
AssertionError: apps/android/app/src/main/AndroidManifest.xml should exist: expected false to be true

FAIL apps/androidScaffold.test.ts > native Android scaffold > keeps the Android scaffold out of npm pack dry-run output
AssertionError: apps/android should exist before npm pack exclusion can protect the scaffold: expected false to be true

Test Files  1 failed (1)
Tests  3 failed | 1 passed (4)
```

## whyThisIsRED
The failures point at the intended missing behavior: no native Android scaffold exists yet under `apps/android`, so the required Gradle wrapper/project files, app manifest, and app entry point are absent. The package-safety test that can already be evaluated passes, while the `npm pack --dry-run` exclusion test is gated by scaffold existence so it will become meaningful after GREEN creates `apps/android`.

## residualRisks
- The tests are static scaffold/package-safety tests; they do not replace the later Android build checks `cd apps/android && ./gradlew test` and `./gradlew assembleDebug`.
- The MainActivity launcher assertion is intentionally lightweight XML/text matching; GREEN should keep the manifest conventional enough for this public scaffold contract.

## noStagedFiles
- `true` — `git diff --cached --stat` produced no output after the RED edits.
