# Unit 02 VERIFY — Server metadata publication and health identity

## PASS|FAIL|BLOCKED

PASS — Unit 02 is complete. The implementation satisfies the Unit 02 dossier acceptance criteria, including the repaired same-role ownership race, and stays within the server metadata/health identity scope.

## requirementsChecked

- Preferred CLI default port changed to `32187`; `--port` / `PI_POSTBOX_PORT` overrides and busy-port fallback still bind an actual free port.
  - Evidence: `packages/server/src/cli.ts` default parsing; targeted CLI tests passed; smoke transcript showed a busy requested port `40003` fell back to `http://127.0.0.1:43565`.
- Active-local role option/env validates to `dev` or `production`, defaults to `production`, and invalid values fail clearly.
  - Evidence: targeted CLI tests passed for defaults, env, flag override, equals-form flag, and invalid values.
- Server publishes role-scoped metadata under the existing Postbox config base using fixed protocol filenames and no new public override.
  - Evidence: `packages/server/src/activeLocalTarget.ts` derives from `PI_POSTBOX_CONFIG_PATH` dirname, `PI_POSTBOX_CONFIG_DIR`, or `~/.pi-postbox`, then writes `active-local/{dev,production}.json`; targeted publication tests passed.
- Metadata includes version, role, safe normalized actual loopback URL, generated instance id, and fresh `updatedAt`.
  - Evidence: targeted publication tests passed; smoke metadata contained `version: 1`, `role: production`, normalized URL `http://127.0.0.1:43565/`, UUID instance id, and current `updatedAt`.
- `/healthz` returns optional `localTarget` identity matching the published record after listen URL is known.
  - Evidence: app/CLI tests passed; smoke API response status was 200 and `metadataMatchesHealth: true`.
- Non-loopback final URLs skip metadata publication and omit health local-target identity without crashing startup.
  - Evidence: targeted CLI and publisher tests passed for `0.0.0.0`/non-loopback skip behavior.
- Metadata writes are best-effort and safe for Unit 02 scope: restrictive directory/file modes where practical, atomic temp-file rename, symlinked role path/directory skip, warning-only failure behavior.
  - Evidence: `activeLocalTarget.ts` inspection and symlink test passed.
- Heartbeat/refresh/cleanup only continue while the process owns the same-role record; repaired race covered.
  - Evidence: role-file-scoped lock wraps publish/refresh/cleanup; regression tests for newer publish interleaving during older refresh rename and cleanup unlink passed.
- Scope boundaries respected.
  - Evidence: no extension resolver/client retargeting, `scripts/dev.mjs`, Tailscale Serve/status, authentication, or database path changes were implemented in Unit 02 source changes.

## commandsRun

- `git status --short && git diff --cached --name-only && git diff --stat -- <server/protocol paths>` — passed; no staged files observed; changed server/protocol files reviewed.
- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts` — passed; 3 files, 19 tests.
- `npm run typecheck -w @pi-postbox/server` — passed; `tsc -p tsconfig.json --noEmit` completed.
- `npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts` — passed; 2 files, 13 tests.
- `npm run typecheck -w @pi-postbox/protocol` — passed; `tsc -p tsconfig.json --noEmit` completed.
- `npm run build -w @pi-postbox/protocol && npm run build -w @pi-postbox/server` — passed; protocol and server emitted successfully to ignored `dist/` output.
- CLI/API smoke script using built `packages/server/dist/cli.js` with a deliberately busy requested port and temp `PI_POSTBOX_CONFIG_DIR` — passed; fallback URL, metadata, `/healthz.localTarget`, and shutdown observed.

## validationOutput

Targeted Unit 02 tests:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 Test Files  3 passed (3)
      Tests  19 passed (19)
   Start at  13:59:43
   Duration  921ms (transform 664ms, setup 0ms, import 1.06s, tests 841ms, environment 0ms)
```

Server typecheck:

```text
> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

Protocol sweep:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 Test Files  2 passed (2)
      Tests  13 passed (13)
   Start at  13:59:53
   Duration  300ms (transform 214ms, setup 0ms, import 217ms, tests 103ms, environment 0ms)

> @pi-postbox/protocol@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

Build smoke:

```text
> @pi-postbox/protocol@0.1.0 build
> tsc -p tsconfig.json

> @pi-postbox/server@0.1.0 build
> tsc -p tsconfig.json
```

CLI/API evidence transcript:

```json
{
  "busyPort": 40003,
  "listenedAddress": "http://127.0.0.1:43565",
  "usedFallbackPort": true,
  "metadata": {
    "version": 1,
    "role": "production",
    "url": "http://127.0.0.1:43565/",
    "instanceId": "f6e49747-05de-4e5e-bb41-f8d9a40a8734",
    "updatedAt": "2026-06-23T14:01:14.917Z"
  },
  "healthStatus": 200,
  "healthLocalTarget": {
    "role": "production",
    "instanceId": "f6e49747-05de-4e5e-bb41-f8d9a40a8734",
    "url": "http://127.0.0.1:43565/"
  },
  "metadataMatchesHealth": true,
  "stderrLines": []
}
```

Changed-files evidence from verification start:

```text
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

-- staged --
```

## evidenceArtifacts

- This verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/02-verify.md`.
- CLI/API product evidence is embedded above from a real built CLI process, temp config directory, metadata file read, and `/healthz` HTTP request. No browser/CDP artifact was applicable for this server/CLI/API unit.

## skippedGates

- Browser/CDP screenshot/video evidence — unavailable and not applicable to this non-UI server metadata/API unit; CLI/API transcript captured instead.
- Full workspace `npm test` / `npm run typecheck` — not run to keep verification targeted to Unit 02 server/protocol surfaces; narrow server and protocol tests/typechecks plus server/protocol build passed.
- Full workspace smoke (`npm run smoke`) — not run because it exercises packaged whole-product flows beyond Unit 02 and targeted CLI/API smoke covered the changed behavior.

## issuesFound

None blocking/actionable.

## residualRisks

- The same-role mutation lock is cooperative among this implementation's publish/refresh/cleanup functions; external/manual writers that ignore the lock can still race.
- A process crash can leave a stale lock directory; future metadata mutations time out and remain best-effort rather than blocking startup.
- README still mentions the old `3000` preferred default in existing docs; Unit 02 scope did not include operator documentation updates, and docs/status diagnostics are planned for later units.

## noStagedFiles

true — `git diff --cached --name-only` produced no output before this artifact was written and again after writing this artifact. No files were staged.
