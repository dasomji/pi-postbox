# 01 — GREEN: Android scaffold and package-safety tests

## changedFiles
- `apps/android/.gitignore`
- `apps/android/settings.gradle.kts`
- `apps/android/build.gradle.kts`
- `apps/android/gradle.properties`
- `apps/android/gradlew`
- `apps/android/gradlew.bat`
- `apps/android/gradle/wrapper/gradle-wrapper.jar`
- `apps/android/gradle/wrapper/gradle-wrapper.properties`
- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/res/values/strings.xml`
- `apps/android/app/src/main/res/values/styles.xml`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/01-green.md`

## testsAddedOrUpdated
- None in GREEN. Reused the RED contract in `apps/androidScaffold.test.ts`.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; sdkmanager --list_installed | sed -n '1,120p'` — passed; confirmed SDK tools/platforms available.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd /tmp && curl -L --fail --retry 3 -o gradle-8.11.1-bin.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip && unzip -q gradle-8.11.1-bin.zip && cd /home/dev/Development/pi-daniel/extensions/dashboard/apps/android && /tmp/gradle-8.11.1/bin/gradle wrapper --gradle-version 8.11.1 --distribution-type bin` — passed; created the local Gradle wrapper.
- `npx vitest run apps/androidScaffold.test.ts` — passed before the Gradle fix.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug` — first run failed because `kotlin { jvmToolchain(17) }` required a locally installed JDK 17 while the environment has JDK 21.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug` — passed after switching Kotlin to target JVM 17 without requiring a JDK 17 toolchain.
- `npx vitest run apps/androidScaffold.test.ts` — passed after the Gradle fix.
- `test -f apps/android/app/build/outputs/apk/debug/app-debug.apk && ls -lh apps/android/app/build/outputs/apk/debug/app-debug.apk && git status --short && git diff --cached --stat` — passed; confirmed debug APK exists and no staged files.

## validationOutput
```text
RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

Test Files  1 passed (1)
Tests  4 passed (4)
Duration  6.32s
```

```text
> Task :app:testDebugUnitTest NO-SOURCE
> Task :app:testReleaseUnitTest NO-SOURCE
> Task :app:test UP-TO-DATE
> Task :app:assembleDebug

BUILD SUCCESSFUL in 1m 1s
58 actionable tasks: 58 executed
```

```text
-rw-rw-r-- 1 dev dev 11M Jun 25 19:23 apps/android/app/build/outputs/apk/debug/app-debug.apk
```

## implementationNotes
- Added a self-contained Gradle Android project at `apps/android` with Gradle wrapper 8.11.1.
- Configured AGP 8.10.1, Kotlin Android 2.1.21, Kotlin Compose compiler plugin 2.1.21, Kotlin serialization plugin 2.1.21, Compose BOM, Material 3, OkHttp, kotlinx.serialization JSON, and JUnit.
- Added a minimal native Kotlin `MainActivity` with a Compose placeholder screen only; no later-unit API/client behavior was implemented.
- Kept root npm package/workspace configuration unchanged; `apps/android` has no `package.json` and remains excluded from root npm publish allowlists.
- Added Android-local `.gitignore` entries for Gradle/build outputs and local SDK state.

## residualRisks
- `./gradlew test` currently reports `NO-SOURCE` for unit tests because this unit only scaffolds the app; behavior tests are expected in later units.
- Gradle downloaded dependencies and installed Android SDK Build Tools 35.0.0 during validation because AGP 8.10.1 declares it as the default build tools version.
- Emulator/device smoke was not run for this unit; preflight already noted KVM/device limitations.

## noStagedFiles
- `true` — `git diff --cached --stat` produced no output.
