# 02 — REPAIR 2: Network security lint attributes

## changedFiles
- `apps/android/app/src/main/res/xml/network_security_config.xml`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/02-repair-2.md`

## testsAdded
- None. This repair only adds explicit XML attributes required by Android lint for the existing local/emulator cleartext allowlist.

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew lintDebug test assembleDebug` — passed.
- `git diff -- apps/android/app/src/main/res/xml/network_security_config.xml && git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,260p'` — passed; no staged diff output.
- `git diff --cached --stat && git status --short --untracked-files=all | sed -n '1,280p'` — passed after writing this artifact; no staged diff output.

## validationOutput
- `./gradlew lintDebug test assembleDebug` completed with `BUILD SUCCESSFUL in 6s` and `74 actionable tasks: 17 executed, 57 up-to-date`.
- Android lint report now ends with `0 errors, 8 warnings`.
- The previous blocking `NetworkSecurityConfig` errors for missing `includeSubdomains` are gone.
- Remaining lint warnings are pre-existing/non-blocking dependency freshness, unused `app_name`, missing app icon, and `SharedPreferences.edit` KTX style warnings.

## residualRisks
- No device/emulator UI validation was attempted in this narrow repair; this only addresses the Unit 02 lint verification failure.
- The repository contains many pre-existing untracked Unit 01/02 Android files/artifacts from prior work; this repair only modified the network security config and wrote this artifact.

## noStagedFiles
true

`git diff --cached --stat` produced no output after this artifact was written. No files were staged by this repair.
