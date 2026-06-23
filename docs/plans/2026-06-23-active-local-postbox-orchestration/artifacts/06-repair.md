# Unit 06 REPAIR — accepted review findings

## changedFiles

- `scripts/dev.mjs` — changed dev launcher canonical default port from `3000` to `32187` and updated its header comment.
- `packages/server/src/activeLocalTarget.ts` — changed server active-local metadata base precedence to `PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`.
- `packages/server/test/activeLocalTarget.test.ts` — added coverage locking `PI_POSTBOX_CONFIG_DIR` precedence over `PI_POSTBOX_CONFIG_PATH`.
- `packages/server/test/devLauncher.test.ts` — refactored launcher test setup and added coverage that unset `PI_POSTBOX_PORT` uses `32187` for backend and web proxy env.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-repair.md` — this repair evidence artifact.

## commandsRun

- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts`
- `npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts`
- `node --check scripts/smoke-postbox.mjs && npm run typecheck -w @pi-postbox/server`
- `node --check scripts/dev.mjs && git diff --cached --name-only && git status --short`

## validationOutput

```text
> npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts

Test Files  2 passed (2)
Tests       9 passed (9)
```

```text
> npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts

Test Files  3 passed (3)
Tests       15 passed (15)
```

```text
> node --check scripts/smoke-postbox.mjs && npm run typecheck -w @pi-postbox/server

> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
# passed; node --check produced no output
```

```text
> node --check scripts/dev.mjs && git diff --cached --name-only && git status --short
# node --check passed with no output
# git diff --cached --name-only produced no output
# git status --short showed existing Unit 01-06 working-tree changes/untracked files; nothing was staged
```

## findingsAddressed

1. Dev launcher/default docs drift: `scripts/dev.mjs` now uses `32187` when `PI_POSTBOX_PORT` is unset, matching `docs/deployment.md` and the Unit 06 default-port contract. `devLauncher.test.ts` locks the unset-env default and the explicit env override.
2. Server active-local config-base precedence: server metadata publishing now matches docs and extension resolver precedence: `PI_POSTBOX_CONFIG_DIR` wins over `PI_POSTBOX_CONFIG_PATH`; otherwise the dirname of `PI_POSTBOX_CONFIG_PATH` is used; otherwise `~/.pi-postbox`. `activeLocalTarget.test.ts` locks the both-env-vars case.

## residualRisks

- The dev launcher default-port test assumes `127.0.0.1:32187` is free in the test environment; it was free during this repair validation.
- The working tree contains broader pre-existing Unit 01-06 modifications and untracked files outside this narrow repair; this repair did not stage or commit anything.

## noStagedFiles

true — `git diff --cached --name-only` produced no output.
