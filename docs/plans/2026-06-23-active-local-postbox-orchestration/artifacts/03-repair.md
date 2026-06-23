# Unit 03 REPAIR — Deterministic dev launcher test seam

## changedFiles

- `packages/server/test/devLauncher.test.ts`: made the fake `pi-postbox-server` command stay alive until the dev orchestrator terminates it, so the fake web `npm` command has a deterministic chance to start and record its invocation.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/03-repair.md`: repair evidence artifact.

`scripts/dev.mjs` was inspected and left unchanged during this repair; the existing Unit 03 implementation still starts the backend with `--active-local-role dev` and preserves the web launch line.

## commandsRun

- `git status --short && printf '\n-- cached --\n' && git diff --cached --name-only` — passed; no staged files before repair.
- `npm test -- packages/server/test/devLauncher.test.ts` — failed before repair, reproducing the verifier failure (`web` invocation was `undefined`).
- `npm test -- packages/server/test/devLauncher.test.ts` — passed after repair.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed after repair.
- `for i in 1 2 3; do echo "--- devLauncher repeat $i ---"; npm test -- packages/server/test/devLauncher.test.ts || exit $?; done` — passed 3 consecutive dev launcher runs.
- `git diff -- packages/server/test/devLauncher.test.ts scripts/dev.mjs && printf '\n-- status --\n' && git status --short && printf '\n-- cached --\n' && git diff --cached --name-only` — passed; confirmed production diff is limited to the pre-existing Unit 03 marker and no files are staged.
- `nl -ba packages/server/test/devLauncher.test.ts | sed -n '35,70p'` — inspected repaired fake command seam.
- `git status --short && printf '\n-- cached --\n' && git diff --cached --name-only` — passed after writing this artifact; no staged files.

## validationOutput

Pre-repair reproduction:

```text
$ npm test -- packages/server/test/devLauncher.test.ts

FAIL  packages/server/test/devLauncher.test.ts > scripts/dev.mjs > starts the backend as the active-local dev target while preserving API port and web proxy env
AssertionError: expected undefined to match object { …(2) }

Test Files  1 failed (1)
Tests  1 failed (1)
```

Post-repair isolated validation:

```text
$ npm test -- packages/server/test/devLauncher.test.ts

Test Files  1 passed (1)
Tests  1 passed (1)
Duration  286ms
```

Required targeted validation:

```text
$ npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts

Test Files  2 passed (2)
Tests  10 passed (10)
Duration  737ms
```

Repeat stability check:

```text
$ for i in 1 2 3; do echo "--- devLauncher repeat $i ---"; npm test -- packages/server/test/devLauncher.test.ts || exit $?; done

--- devLauncher repeat 1 ---
Test Files  1 passed (1)
Tests  1 passed (1)

--- devLauncher repeat 2 ---
Test Files  1 passed (1)
Tests  1 passed (1)

--- devLauncher repeat 3 ---
Test Files  1 passed (1)
Tests  1 passed (1)
```

Repaired seam evidence:

```text
packages/server/test/devLauncher.test.ts:48 const command = basename(process.argv[1]);
packages/server/test/devLauncher.test.ts:49 appendFileSync(process.env.DEV_LAUNCHER_INVOCATIONS, JSON.stringify({
packages/server/test/devLauncher.test.ts:54 if (command === "pi-postbox-server") {
packages/server/test/devLauncher.test.ts:55   process.on("SIGTERM", () => process.exit(0));
packages/server/test/devLauncher.test.ts:56   setInterval(() => {}, 1000);
```

## findingsAddressed

- Addressed the accepted verifier finding that `packages/server/test/devLauncher.test.ts` raced: the fake backend exited immediately, allowing the orchestrator to shut down and kill the fake web process before it recorded `npm run dev -w @pi-postbox/web`.
- The fake backend now behaves like a long-running dev server and exits when the orchestrator sends `SIGTERM`, preserving the production implementation and keeping the test focused on Unit 03 acceptance.

## residualRisks

- No known Unit 03 repair risk. The test still uses a subprocess/PATH fake-command seam by design, but the immediate-exit race has been removed.
- Existing unrelated working tree changes from prior units remain present and un-staged.

## noStagedFiles

true
