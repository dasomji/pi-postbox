# Unit 01 — Android project scaffold and build pipeline

## Goal
Create a self-contained native Android Gradle project under `apps/android` that can build a debug APK without changing the root npm workspace shape.

## Scope
- Add `apps/android/settings.gradle.kts`, `build.gradle.kts`, Gradle wrapper, and `app` module.
- Configure Kotlin, Android Gradle Plugin, Compose Compiler plugin, Compose BOM, Material 3, unit test dependencies, OkHttp, and kotlinx.serialization.
- Add minimal `MainActivity` with a placeholder Compose screen.
- Add Android app id such as `dev.pi.postbox` or `works.earendil.postbox` after confirming naming if needed.
- Add `.gitignore` entries for Android build outputs if necessary.
- Document that Android sources are not part of npm publish.

## Test scenarios
- `cd apps/android && ./gradlew test` passes.
- `cd apps/android && ./gradlew assembleDebug` produces `apps/android/app/build/outputs/apk/debug/app-debug.apk`.
- Root `npm test`, `npm run typecheck`, `npm run build`, and `npm run smoke` still pass.
- `npm pack --dry-run` does not list `apps/android`.

## Notes
This unit is blocked on Java/Android SDK tooling for validation in this environment.
