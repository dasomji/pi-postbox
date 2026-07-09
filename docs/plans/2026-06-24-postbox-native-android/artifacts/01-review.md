# 01 — REVIEW: Android scaffold and package-safety review

## Findings

No blocking or actionable findings.

## Claude reviewer

- Command: `claude -p --tools "" --no-session-persistence` with a read-only review packet supplied on stdin; bounded by the reviewer tool timeout (120s).
- Result: Claude returned two advisory items:
  - A “Major” concern that the npm-publish exclusion was not documented.
  - A “Verify” concern that `@style/Theme.Postbox` might be undefined because the review packet summarized, rather than fully quoted, all resources.
- Disposition: Neither advisory item was carried into the main Findings list.
  - Package-safety documentation exists in `docs/plans/2026-06-24-postbox-native-android/index.md:6` and `docs/plans/2026-06-24-postbox-native-android/index.md:10`, with repo-layout guardrails at `docs/plans/2026-06-24-postbox-native-android/index.md:41` and `docs/plans/2026-06-24-postbox-native-android/index.md:42`; the GREEN artifact also records the implemented npm-publish exclusion at `docs/plans/2026-06-24-postbox-native-android/artifacts/01-green.md:58`.
  - `Theme.Postbox` is defined in `apps/android/app/src/main/res/values/styles.xml:2` and matches the manifest reference at `apps/android/app/src/main/AndroidManifest.xml:6`.

## Validation notes

- Scope checked: Unit 01 scaffold requirements, RED/GREEN artifacts, preflight constraints, npm workspace/package safety, Android Gradle project layout, committed wrapper shape, ignored Gradle/build outputs, and absence of later-unit protocol/client behavior.
- Review was read-only except for writing this requested review artifact. No files were staged.
- Targeted Gradle/root build gates were not re-run in this review pass to honor the read-only command constraint; GREEN artifact records `./gradlew test assembleDebug` and the scaffold Vitest passing.
- Residual risks: emulator/device smoke remains unvalidated due preflight KVM/device limitations; `./gradlew test` currently has no Android unit-test sources because this unit only scaffolds the app; wrapper JAR was inspected structurally and hashed locally, but not independently verified against an upstream checksum.

## commandsRun

- `git status --short && printf '\n---STAT---\n' && git diff --stat` — passed; showed untracked `apps/android/`, `apps/androidScaffold.test.ts`, and plan artifacts; no tracked diff stat because changes are untracked.
- Read requirement/artifact files: `docs/plans/2026-06-24-postbox-native-android/units/01-android-scaffold-build.md`, `artifacts/00-preflight.md`, `artifacts/01-red.md`, and `artifacts/01-green.md`.
- Read scaffold files: `package.json`, `apps/android/.gitignore`, `settings.gradle.kts`, root/app Gradle files, `gradle.properties`, wrapper properties, manifest, MainActivity, string/style resources, and `apps/androidScaffold.test.ts`.
- `git check-ignore -v apps/android/.gradle/8.11.1/fileHashes/fileHashes.bin apps/android/app/build/outputs/apk/debug/app-debug.apk apps/android/local.properties || true` — passed; confirmed generated Gradle/build/local SDK state is ignored.
- `git diff --cached --stat && git ls-files apps/android apps/androidScaffold.test.ts docs/plans/2026-06-24-postbox-native-android | sed -n '1,200p'` — passed; no staged files, files still untracked.
- `npm query .workspace --json | node -e '...'` — passed; resolved workspaces are `apps/web`, `packages/extension`, `packages/protocol`, and `packages/server`; `apps/android` is not an npm workspace package.
- `npm pack --dry-run --json --ignore-scripts | node -e '...'` — passed; `androidPackEntries=0`.
- `git status --short --ignored=matching apps/android apps/androidScaffold.test.ts docs/plans/2026-06-24-postbox-native-android | sed -n '1,240p'` — passed; confirmed untracked scaffold/test/docs and ignored `.gradle/`, `.kotlin/`, and `app/build/`.
- `find apps/android -maxdepth 4 -type f \( -path '*/build/*' -o -path '*/.gradle/*' -o -name local.properties \) -print | sort | while read -r f; do git check-ignore -q "$f" && echo "ignored $f" || echo "NOT_IGNORED $f"; done | sed -n '1,200p'` — passed; all listed generated files were ignored.
- `sha256sum apps/android/gradle/wrapper/gradle-wrapper.jar apps/android/gradlew apps/android/gradlew.bat && unzip -l apps/android/gradle/wrapper/gradle-wrapper.jar | sed -n '1,120p'` — passed; wrapper files present, `gradlew` executable, wrapper JAR contained expected Gradle wrapper classes.
- `claude -p --tools "" --no-session-persistence` with stdin review packet — completed; advisory output reviewed and disposition recorded above.
- `nl -ba docs/plans/2026-06-24-postbox-native-android/index.md | sed -n '1,45p'` — passed; located package-safety documentation.
- `nl -ba docs/plans/2026-06-24-postbox-native-android/artifacts/01-green.md | sed -n '40,80p'` — passed; located GREEN documentation of npm-publish exclusion.
- `nl -ba apps/android/app/src/main/res/values/styles.xml && nl -ba apps/android/app/src/main/AndroidManifest.xml | sed -n '1,40p'` — passed; confirmed manifest theme reference is defined.
- `test ! -e apps/android/package.json && echo 'apps/android/package.json absent' && test -x apps/android/gradlew && echo 'apps/android/gradlew executable' && test -f apps/android/gradle/wrapper/gradle-wrapper.jar && echo 'wrapper jar present'` — passed.
- `find apps/android/app/src/main -type f | sort | sed -n '1,120p'` — passed; only manifest, MainActivity, and value resources exist under main sources.
- `grep -RIn --exclude-dir=build --exclude-dir=.gradle --exclude-dir=.kotlin -E 'GET /api|/api/state|healthz|answer|cancel|DataStore|SharedPreferences|OkHttpClient|EventSource|WebSocket' apps/android || true` — passed; no later-unit protocol/client behavior found.
