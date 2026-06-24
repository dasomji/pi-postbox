# U3 RED: Package-local server autostart supervisor

## changedFiles

- `packages/extension/test/autostart.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/03-red.md`

## testsAddedOrUpdated

- `packages/extension/test/autostart.test.ts`
  - `ask_postbox with no reachable server spawns the package-local server, waits for healthy active-local metadata, registers, and sends the ask`
    - Exercises the extension tool surface with no resolved target.
    - Expects a package-local child spawn via `node <package-root>/packages/server/dist/cli.js`.
    - Expects the pending ask to be sent after fresh healthy active-local metadata appears.
  - `uses a healthy preferred server without spawning an autostart child`
    - Verifies a health-verified explicit preferred server still registers directly and does not spawn.
  - `PI_POSTBOX_AUTOSTART=off disables spawn and ask_postbox returns explicit unavailable diagnostics`
    - Verifies opt-out prevents spawn and exposes an autostart-disabled unavailable rationale.
  - `PI_POSTBOX_AUTOSTART_TIMEOUT_MS bounds how long ask_postbox waits for autostart health`
    - Uses fake timers to require the ask to remain pending before the 50ms bound, then return unavailable on timeout.
  - `reuses an existing healthy active-local server without spawning another process`
    - Verifies fresh active-local metadata is reused directly with no child spawn.
  - `session shutdown does not kill the autostarted child process`
    - Verifies the autostart child is reusable across Pi sessions and is not killed during session shutdown.

## commandsRun

- `npm test -- packages/extension/test/autostart.test.ts` — expected RED failure: 4 failed, 2 passed.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts` — expected RED failure in new autostart tests only: 1 failed file, 2 passed files; 4 failed, 15 passed.
- `npm run typecheck` — passed.
- `git status --short && echo '---CACHED---' && git diff --cached --name-only` — inspected worktree; no staged files.

## validationOutput

Targeted autostart RED:

```text
FAIL  packages/extension/test/autostart.test.ts > package-local Postbox server autostart > ask_postbox with no reachable server spawns the package-local server, waits for healthy active-local metadata, registers, and sends the ask
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

```text
FAIL  packages/extension/test/autostart.test.ts > package-local Postbox server autostart > PI_POSTBOX_AUTOSTART=off disables spawn and ask_postbox returns explicit unavailable diagnostics
Expected rationale to match /PI_POSTBOX_AUTOSTART=off|autostart disabled/i
Received: "Pi Postbox is unavailable after active-local target resolution (missing)."
```

```text
FAIL  packages/extension/test/autostart.test.ts > package-local Postbox server autostart > PI_POSTBOX_AUTOSTART_TIMEOUT_MS bounds how long ask_postbox waits for autostart health
AssertionError: expected true to be false
```

```text
FAIL  packages/extension/test/autostart.test.ts > package-local Postbox server autostart > session shutdown does not kill the autostarted child process
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

Combined targeted run:

```text
Test Files  1 failed | 2 passed (3)
Tests  4 failed | 15 passed (19)
```

Typecheck:

```text
> @wienerberliner/pi-postbox@0.1.0 typecheck
> tsc -b
```

## whyThisIsTheRightRED

- The current extension has active-local polling recovery but no package-local child spawn path, so spawn expectations fail with zero calls.
- `ask_postbox` currently returns unavailable immediately when no client is registered, so the timeout-bound test observes the promise settling before the configured 50ms wait.
- `PI_POSTBOX_AUTOSTART=off` currently has no explicit autostart diagnostic path, so the unavailable rationale only reports active-local resolver diagnostics.
- Existing preferred-server and active-local reuse tests pass, preserving the no-spawn behavior for already healthy targets.

## residualRisks

- The tests intentionally mock `node:child_process.spawn` and `PostboxClient`; they specify extension-visible behavior without launching a real server.
- The package-local CLI path assertion is intentionally flexible about extra spawn args/options but requires `process.execPath` and an argument ending in `packages/server/dist/cli.js`.
- No test was added for PATH fallback to `pi-postbox-server`; it was not included in this RED task's explicit behavior list.

## noStagedFiles

true
