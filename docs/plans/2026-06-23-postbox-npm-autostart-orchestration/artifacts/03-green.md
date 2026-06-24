# U3 GREEN: Package-local server autostart supervisor

## changedFiles

- `packages/extension/src/autostart.ts`
- `packages/extension/src/index.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/03-green.md`

## testsAddedOrUpdated

- None in GREEN; this implementation satisfies the existing U3 RED tests in `packages/extension/test/autostart.test.ts`.

## commandsRun

- `npm test -- packages/extension/test/autostart.test.ts` — initially failed during implementation before recovery polling accepted the test metadata timestamp.
- `npm test -- packages/extension/test/autostart.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts` — passed.
- `npm run typecheck` — passed.
- `npm test -- packages/extension/test/autostart.test.ts` — passed after final implementation.
- `git status --short && echo '---CACHED---' && git diff --cached --name-only` — inspected worktree/staging; no staged files.

## validationOutput

Intermediate autostart run before final adjustment:

```text
Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)
```

Combined targeted run:

```text
Test Files  3 passed (3)
Tests  19 passed (19)
```

Typecheck:

```text
> @wienerberliner/pi-postbox@0.1.0 typecheck
> tsc -b
```

Autostart focused run:

```text
Test Files  1 passed (1)
Tests  6 passed (6)
```

Staging check:

```text
---CACHED---
```

## implementationNotes

- Added a package-local autostart helper that prefers `node <package-root>/packages/server/dist/cli.js` and falls back to `pi-postbox-server` on PATH.
- Extension session startup now enables autostart only for the extension-managed registration path, avoiding direct `startRegistration` test/helper calls spawning real servers.
- `ask_postbox` now waits up to `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` (default helper value 10000ms) for registration recovery before returning unavailable diagnostics.
- Autostart opt-out via `PI_POSTBOX_AUTOSTART=off` returns explicit disabled rationale and does not spawn.
- Spawned children are detached/unref'd and are not killed during session shutdown.

## residualRisks

- PATH fallback is implemented but not covered by the current U3 RED tests.
- Autostart recovery polling remains based on active-local metadata health; if the spawned server never publishes healthy metadata, asks time out with unavailable diagnostics.

## noStagedFiles

true
