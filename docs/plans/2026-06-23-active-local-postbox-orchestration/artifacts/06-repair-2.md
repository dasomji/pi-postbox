# Unit 06 REPAIR 2 — robust dev launcher default-port test

## changedFiles

- `packages/server/test/devLauncher.test.ts` — changed the unset-`PI_POSTBOX_PORT` default-port assertion from executing the dev launcher against real `127.0.0.1:32187` to a source-level assertion that the launcher resolves `API_PORT` to `32187` when the env var is absent. Existing integration coverage still launches against an allocated free port to verify `PI_POSTBOX_PORT` override, backend args, `--active-local-role dev`, and web proxy env.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-repair-2.md` — this repair evidence artifact.

## commandsRun

- `npm test -- packages/server/test/devLauncher.test.ts`
- `npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts`
- `node --check scripts/dev.mjs`
- `npm run typecheck -w @pi-postbox/server`
- Synthetic busy-port robustness check: hold `127.0.0.1:32187` with a local dummy listener, then run `npm test -- packages/server/test/devLauncher.test.ts`
- `git diff -- packages/server/test/devLauncher.test.ts && git diff --cached --name-only && git status --short`

## validationOutput

```text
> npm test -- packages/server/test/devLauncher.test.ts

Test Files  1 passed (1)
Tests       2 passed (2)
```

```text
> npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts

Test Files  3 passed (3)
Tests       15 passed (15)
```

```text
> node --check scripts/dev.mjs
# passed; no output
```

```text
> npm run typecheck -w @pi-postbox/server

> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
# passed
```

```text
> # with a dummy listener holding 127.0.0.1:32187
> npm test -- packages/server/test/devLauncher.test.ts

Test Files  1 passed (1)
Tests       2 passed (2)
```

```text
> git diff --cached --name-only
# no output; no staged files
```

## findingsAddressed

1. `packages/server/test/devLauncher.test.ts` no longer depends on ambient availability of machine-global `127.0.0.1:32187`. The default-port test reads `scripts/dev.mjs` and asserts the documented fallback value directly, while the integration launch path uses a test-allocated free port for the env override/role behavior.

## residualRisks

- The default-port assertion is intentionally source-level/static rather than an execution of the unset-env launcher path; this avoids the port-availability flake while preserving existing integration coverage for spawned backend/web arguments under an explicit free-port override.
- The working tree contains broad pre-existing Unit 01-06 modifications and untracked files outside this narrow repair; this repair did not stage or commit anything.

## noStagedFiles

true — `git diff --cached --name-only` produced no output.
