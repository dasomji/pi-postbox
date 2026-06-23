# Unit 03 RED — Dev launcher active-local role marker

## changedFiles

- `packages/server/test/devLauncher.test.ts` (new): integration-style dev launcher test with fake `pi-postbox-server` and `npm` binaries so no real long-running dev servers launch.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/03-red.md` (new): RED evidence artifact.

## testsAddedOrUpdated

- Added `packages/server/test/devLauncher.test.ts` / `scripts/dev.mjs > starts the backend as the active-local dev target while preserving API port and web proxy env`.
  - Runs `scripts/dev.mjs` in a child Node process with a temporary PATH containing fake `pi-postbox-server` and `npm` commands.
  - Asserts the backend spawn command preserves `--host 127.0.0.1` and the selected `--port <PI_POSTBOX_PORT>`.
  - Asserts the backend spawn command includes the Unit 02 CLI marker `--active-local-role dev`.
  - Asserts the web spawn still runs `npm run dev -w @pi-postbox/web` and receives `POSTBOX_DEV_API_PORT=<PI_POSTBOX_PORT>`.
- Preserved existing `packages/server/test/cli.test.ts` coverage for direct CLI production default and active-local role parsing:
  - `uses one-command local defaults with a stable user database path and production role` asserts `activeLocalRole: "production"` by default.
  - `validates active-local role defaults, env, flag override, and invalid values` asserts `--active-local-role dev` and `PI_POSTBOX_ACTIVE_LOCAL_ROLE=dev` are accepted.

## commandsRun

- `npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — failed as intended in the new dev launcher test.
- `git status --short && git diff --cached --name-only` — confirmed no staged files; output also shows pre-existing modified/untracked Unit 01/02 planning/source/test files plus the new Unit 03 files.

## validationOutput

Targeted RED test output:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 ❯ packages/server/test/devLauncher.test.ts (1 test | 1 failed) 104ms
     × starts the backend as the active-local dev target while preserving API port and web proxy env 102ms

 FAIL  packages/server/test/devLauncher.test.ts > scripts/dev.mjs > starts the backend as the active-local dev target while preserving API port and web proxy env
AssertionError: expected [ '--host', '127.0.0.1', …(2) ] to deeply equal [ '--host', '127.0.0.1', …(4) ]

- Expected
+ Received

  [
    "--host",
    "127.0.0.1",
    "--port",
    "41545",
-   "--active-local-role",
-   "dev",
  ]

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 9 passed (10)
```

No staged files check:

```text
$ git status --short && git diff --cached --name-only
 M docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md
 M docs/prd/pi-postbox.md
 M packages/protocol/src/health.test.ts
 M packages/protocol/src/health.ts
 M packages/protocol/src/index.ts
 M packages/server/src/app.ts
 M packages/server/src/cli.ts
 M packages/server/test/app.test.ts
 M packages/server/test/cli.test.ts
?? docs/adr/0002-tailnet-private-tailscale-auto-exposure.md
?? docs/plans/2026-06-23-active-local-postbox-orchestration/
?? packages/protocol/src/activeLocal.test.ts
?? packages/protocol/src/activeLocal.ts
?? packages/server/src/activeLocalTarget.ts
?? packages/server/test/activeLocalTarget.test.ts
?? packages/server/test/devLauncher.test.ts
```

`git diff --cached --name-only` produced no output.

## failureReasonTiedToMissingBehavior

The fake backend command recorded that `scripts/dev.mjs` currently starts `pi-postbox-server` with only:

```text
--host 127.0.0.1 --port <PI_POSTBOX_PORT>
```

The RED assertion expects the same marker accepted by Unit 02 CLI parsing:

```text
--active-local-role dev
```

The failure is therefore tied directly to the missing dev launcher role wiring. The child-process seam also proves host/port and web environment behavior are still observable without launching real dev servers.

## residualRisks

- The test intentionally exercises `scripts/dev.mjs` as a subprocess with fake binaries rather than importing a helper; this avoids production edits in RED but still depends on PATH resolution for spawned child commands.
- The free-port helper closes the reserved port before running the script, so there is a small normal local-port race; the script is run with a random high port to keep this low and avoid production-stop behavior.
- Existing working tree changes from prior units remain present and un-staged.

## noStagedFiles

true
