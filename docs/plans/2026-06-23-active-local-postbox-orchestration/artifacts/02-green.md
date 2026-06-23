# Unit 02 GREEN — Server metadata publication and health identity

## changedFiles

- `packages/server/src/activeLocalTarget.ts` (new): active-local metadata publication, refresh ownership checks, cleanup, fixed role paths, loopback URL normalization, symlink skip, atomic restrictive writes, and config-base resolution.
- `packages/server/src/cli.ts`: default port `32187`, active-local role flag/env/default validation, post-listen metadata publication using the actual bound port, health identity updates, heartbeat refresh, and cleanup on app close.
- `packages/server/src/app.ts`: optional provider/mutable active-local target identity included in `/healthz` when present.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/02-green.md` (new): GREEN evidence.

## commandsRun

- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts` — failed once during GREEN on non-loopback publication because Fastify returned a loopback display address for a `0.0.0.0` bind; fixed by evaluating active-local publication against the requested wildcard host.
- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts` — passed.
- `npm run typecheck -w @pi-postbox/server` — passed.
- `git status --short && git diff --cached --name-only` — confirmed no staged files; working tree also contains pre-existing RED/unit changes.

## validationOutput

Final targeted test output:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard


 Test Files  3 passed (3)
      Tests  17 passed (17)
   Start at  13:46:22
   Duration  707ms (transform 579ms, setup 0ms, import 981ms, tests 306ms, environment 0ms)
```

Server typecheck output:

```text
> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
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
```

`git diff --cached --name-only` produced no output.

## residualRisks

- Active-local writes are best-effort and skip clearly unsafe symlinked role files/directories, but they do not attempt platform-specific owner checks or hardlink detection.
- Heartbeat interval is fixed at 30s by default with an internal test seam; no broader process-supervision behavior was added in this unit.
- Working tree contains pre-existing RED/protocol/docs changes outside the GREEN production edits; none are staged.

## noStagedFiles

true
