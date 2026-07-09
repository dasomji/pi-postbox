# 04 — GREEN: Native question list/detail/answer UI

## changedFiles
- `apps/android/app/src/main/java/dev/pi/postbox/MainActivity.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowViewModel.kt`
- `apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt`
- `docs/plans/2026-06-24-postbox-native-android/artifacts/04-green.md`

## testsAddedOrUpdated
- None in GREEN. Reused the Unit 04 RED tests:
  - `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowFixtures.kt`
  - `apps/android/app/src/test/java/dev/pi/postbox/question/QuestionWorkflowViewModelTest.kt`

## commandsRun
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — failed on the first GREEN attempt; the initial view-model launched work on the test `backgroundScope` without starting undispatched, so state loading and stream updates were not visible to the tests.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — failed after the first coroutine repair with 1 remaining stream-disconnect failure; the SharedFlow collector still resumed on the background test dispatcher.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'` — passed after starting protocol actions undispatched and collecting stream statuses with an unconfined collector.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*' assembleDebug` — passed; targeted Unit 04 tests and debug APK assembly are green.
- `export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"; export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"; cd apps/android && ./gradlew test assembleDebug lintDebug` — passed; full Android unit-test/build/lint gate is green.
- `python3 - <<'PY' ...` over `apps/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` — passed; confirmed JVM test report counts including Unit 04.
- `git status --short && git diff --cached --stat && git diff --stat` — passed; confirmed no staged files (`git diff --cached --stat` produced no output). The repository still reports the Android app/docs as untracked worktree content from this plan.

## validationOutput
Targeted Unit 04 final test run:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*'
BUILD SUCCESSFUL in 2s
22 actionable tasks: 5 executed, 17 up-to-date
```

Targeted Unit 04 + debug build:

```text
cd apps/android && ./gradlew testDebugUnitTest --tests 'dev.pi.postbox.question.*' assembleDebug
BUILD SUCCESSFUL in 3s
41 actionable tasks: 10 executed, 31 up-to-date
```

Full Android gate:

```text
cd apps/android && ./gradlew test assembleDebug lintDebug
BUILD SUCCESSFUL in 10s
74 actionable tasks: 15 executed, 59 up-to-date
```

Debug unit-test report counts:

```text
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.PostboxHealthVerifierTest.xml: tests=4 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.ServerOnboardingViewModelTest.xml: tests=7 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.onboarding.ServerUrlNormalizerTest.xml: tests=6 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxProtocolClientTest.xml: tests=5 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxProtocolDtoTest.xml: tests=3 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.protocol.PostboxStateStreamTest.xml: tests=4 failures=0 errors=0
apps/android/app/build/test-results/testDebugUnitTest/TEST-dev.pi.postbox.question.QuestionWorkflowViewModelTest.xml: tests=7 failures=0 errors=0
```

No staged files:

```text
git status --short && git diff --cached --stat && git diff --stat
?? apps/android/
?? apps/androidScaffold.test.ts
?? docs/plans/2026-06-24-postbox-native-android/
```

`git diff --cached --stat` and `git diff --stat` produced no output because this plan's Android/docs files are still untracked in the repository.

## implementationNotes
- Added `QuestionWorkflowViewModel` and app-owned UI state/action models for loading, connection, sessions, pending questions, visible question detail, selected options, terminal messages, and submission errors.
- Wired the view-model to a verified base URL, `PostboxProtocolClient.fetchState()`, `PostboxStateStream.start()/states`, answer payloads, cancel payloads, and latest-state refreshes.
- Implemented single-select replacement semantics, multi-select ordered toggles, submit enablement, cancel, success refresh, 409 already-resolved conflict handling, terminal states, and disconnected stream preservation of the currently visible question/selection.
- Replaced the post-onboarding placeholder with a working Compose question workflow backed by `OkHttpPostboxProtocolClient` and `OkHttpPostboxStateStream`, while preserving the ability to edit the saved server URL.
- Added a mobile-first Compose screen that lists sessions and open questions, shows detail/context/options/rich context, keeps long detail content scrollable with action buttons fixed at the bottom of the card, supports submit/cancel with optional note/rationale, and displays loading/empty/error/terminal/disconnected states.

## residualRisks
- No emulator/device runtime smoke was run; validation is JVM tests, debug assembly, and lint in this environment.
- The Compose screen is compile/lint validated but not covered by instrumentation/UI tests; Unit 04 behavior is covered through the public view-model state/actions.
- No native push notifications or foreground sync were added; the workflow relies on initial fetch, manual state refresh after actions, and the existing SSE state stream.
- The state stream collector uses an unconfined collector to keep test fake stream emissions synchronous and preserve prompt state updates; future lifecycle/ViewModel integration may want a Main dispatcher-backed AndroidX ViewModel.

## noStagedFiles
true
