# Unit 02 RED — Server metadata publication and health identity

## changedFiles

- `packages/server/test/activeLocalTarget.test.ts` (new): focused active-local metadata publisher behavior tests.
- `packages/server/test/cli.test.ts`: default port/role parsing tests plus listen-time publication and non-loopback skip coverage.
- `packages/server/test/app.test.ts`: health identity provider coverage.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/02-red.md` (new): RED evidence.

## testsAddedOrUpdated

- `packages/server/test/activeLocalTarget.test.ts`
  - `writes a fixed role metadata record under the existing Postbox config base`: expects publication to write `active-local/production.json` using protocol fixed filenames, normalized loopback URL, role, instance id, version, and fresh `updatedAt`.
  - `skips non-loopback targets without publishing a role file`: expects `0.0.0.0` publication to be skipped without creating the role file.
  - `does not let an older same-role owner refresh or clean up a newer record`: seeds a newer production record and expects an older owner refresh/cleanup to leave it intact.
  - `skips symlinked role metadata paths instead of writing through them`: expects a symlinked `production.json` path not to overwrite the symlink target.
- `packages/server/test/cli.test.ts`
  - Updated `uses one-command local defaults with a stable user database path and production role`: now expects default port `32187` and `activeLocalRole: "production"`.
  - Updated `accepts equals-form flags for direct and lizardtail-launched usage`: expects `--active-local-role=dev` to parse.
  - Added `validates active-local role defaults, env, flag override, and invalid values`: expects env default, flag-over-env override, and clear invalid-role errors.
  - Added `publishes loopback metadata and health identity for the actual fallback port`: starts on a busy requested port, expects metadata URL and `/healthz.localTarget` to match the actual fallback URL.
  - Added `skips active-local publication for non-loopback listeners and omits health identity`: starts on `0.0.0.0`, expects no role file and no health local target.
- `packages/server/test/app.test.ts`
  - Updated existing health schema test to assert `localTarget` is omitted before identity is set.
  - Added `returns the current active-local identity from health after the CLI sets it`: expects `createPostboxApp` to read a mutable/provider-based local target identity.

## commandsRun

- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts` — failed as expected for RED.
- `git status --short && git diff --cached --name-only` — confirmed no staged files before writing this artifact.
- `git status --short && git diff --cached --name-only` — re-run after writing this artifact; confirmed no staged files.

## validationOutput

Targeted Unit 02 tests fail for missing behavior:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 ❯ packages/server/test/activeLocalTarget.test.ts (0 test)
 ❯ packages/server/test/app.test.ts (4 tests | 1 failed) 127ms
     × returns the current active-local identity from health after the CLI sets it 16ms
 ❯ packages/server/test/cli.test.ts (9 tests | 4 failed) 157ms
     × uses one-command local defaults with a stable user database path and production role 12ms
     × accepts equals-form flags for direct and lizardtail-launched usage 2ms
     × validates active-local role defaults, env, flag override, and invalid values 2ms
     × publishes loopback metadata and health identity for the actual fallback port 10ms

Failed suite:
Error: Cannot find module '../src/activeLocalTarget.js' imported from packages/server/test/activeLocalTarget.test.ts

Failed tests summary:
- health identity expected `{ role: "dev", instanceId, url }`, received `undefined`.
- CLI defaults expected `port: 32187` and `activeLocalRole: "production"`, received current `port: 3000` and no role.
- equals-form role parsing expected `activeLocalRole: "dev"`, received no role.
- env/override role parsing expected `activeLocalRole: "dev"`, received no role.
- loopback publication expected `/tmp/.../active-local/production.json`, received `ENOENT`.

Test Files  3 failed (3)
Tests  5 failed | 8 passed (13)
```

No staged files check before artifact:

```text
$ git status --short && git diff --cached --name-only
 M docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md
 M docs/prd/pi-postbox.md
 M packages/protocol/src/health.test.ts
 M packages/protocol/src/health.ts
 M packages/protocol/src/index.ts
 M packages/server/test/app.test.ts
 M packages/server/test/cli.test.ts
?? docs/adr/0002-tailnet-private-tailscale-auto-exposure.md
?? docs/plans/2026-06-23-active-local-postbox-orchestration/
?? packages/protocol/src/activeLocal.test.ts
?? packages/protocol/src/activeLocal.ts
?? packages/server/test/activeLocalTarget.test.ts
```

`git diff --cached --name-only` produced no output.

Final no-staged check after writing this artifact:

```text
$ git status --short && git diff --cached --name-only
 M docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md
 M docs/prd/pi-postbox.md
 M packages/protocol/src/health.test.ts
 M packages/protocol/src/health.ts
 M packages/protocol/src/index.ts
 M packages/server/test/app.test.ts
 M packages/server/test/cli.test.ts
?? docs/adr/0002-tailnet-private-tailscale-auto-exposure.md
?? docs/plans/2026-06-23-active-local-postbox-orchestration/
?? packages/protocol/src/activeLocal.test.ts
?? packages/protocol/src/activeLocal.ts
?? packages/server/test/activeLocalTarget.test.ts
```

`git diff --cached --name-only` produced no output.

## failureReasonTiedToMissingBehavior

- `packages/server/src/activeLocalTarget.ts` does not exist yet, so active-local publication, ownership refresh/cleanup, and symlink-safety helper behavior is absent.
- `parseCliOptions` still defaults to port `3000` and has no active-local role option/env validation.
- `createPostboxApp` has no local target identity provider, so `/healthz` cannot report the identity that should match the published metadata.
- `listenWithPortFallback`/CLI startup does not publish metadata after the actual fallback port is known, so no `active-local/production.json` is written for loopback starts.

## residualRisks

- The new `activeLocalTarget.test.ts` necessarily defines the expected server-side helper names (`publishActiveLocalTarget`, `refreshActiveLocalTarget`, `cleanupActiveLocalTarget`) because the implementation file does not exist yet. The behavior is aligned to the Unit 02 dossier, but GREEN may choose equivalent internals while preserving this public test seam.
- The non-loopback skip test currently passes because no publication exists at all; it remains useful as a regression guard after GREEN adds publication.
- Symlink behavior is tested with a simple role-file symlink and does not cover deeper platform-specific ownership/mode/hardlink checks, which the dossier marks best-effort.

## noStagedFiles

true
