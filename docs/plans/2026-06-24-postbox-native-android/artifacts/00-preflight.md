# 00 — Orchestration preflight

Status: PASS with emulator evidence limitations.

## Role/tool preflight
- `test-writer`: read/find/ls/bash/edit/write/smart_compact available; `contact_supervisor` unavailable.
- `implementer`: read/find/ls/bash/edit/write/smart_compact available; `contact_supervisor` unavailable.
- `tdd-reviewer`: read/find/ls/bash/subagent/smart_compact available; nested read-only review helpers available; `claude` binary present; `contact_supervisor` unavailable.
- `verifier`: read/find/ls/bash/smart_compact available; `web-browser` skill available; `contact_supervisor` unavailable.

## Android environment
Use explicit env in every child task:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Visible tools:
- OpenJDK 21
- `sdkmanager`
- `adb`
- `emulator`
- `avdmanager`

AVDs:
- `postbox_api36`
- `postbox_api30`

## Evidence limitations
- KVM unavailable: `emulator -accel-check` reports `KVM requires a CPU that supports vmx or svm`.
- No attached real Android device: `adb devices` empty after emulator shutdown.
- Software emulator can start but is slow/unreliable; API 30 reached `adb device` but not stable full `sys.boot_completed=1` within the wait window.
- Use JVM/unit tests, Gradle builds, CLI/API evidence, and best-effort APK install/emulator smoke. Real-device handoff may be required for final user acceptance.

## Repo context notes
- Repo root has no `AGENTS.md`, `CLAUDE.md`, `plan.md`, or `progress.md`; global/workspace instructions plus `docs/plans/2026-06-24-postbox-native-android/index.md` are the orchestration source.
- No project-local subagent overrides needed.
