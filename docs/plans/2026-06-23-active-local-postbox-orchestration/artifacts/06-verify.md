# Unit 06 VERIFY — Docs, smoke coverage, and operational diagnostics

## PASS|FAIL|BLOCKED

PASS — Unit 06 is complete for the requested scope.

## requirementsChecked

- Operator docs explain active-local routing, role files, dev-over-production precedence, production fallback, stale/unhealthy/unsafe/health-mismatch diagnostics, and no broad discovery/port scanning.
- Config-base convention is documented and implemented consistently: `PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`; server coverage locks `PI_POSTBOX_CONFIG_DIR` precedence.
- Server role configuration is documented (`--active-local-role`, `PI_POSTBOX_ACTIVE_LOCAL_ROLE`, default `production`) and `scripts/dev.mjs` launches the backend with `--active-local-role dev`.
- Preferred default server/dev launcher port is `32187`; stale operator guidance for `3000` was not found in relevant docs/scripts beyond a non-port timeout and a negative test regex.
- Extension selection, explicit non-loopback authority, configured loopback fallback, live retargeting, sent-ask/local-fallback origin affinity, bounded release, and deferred switching are documented.
- Protocol docs describe optional `/healthz.localTarget` and exact role/instance/url identity matching for active-local metadata candidates.
- Deployment docs preserve manual lizardtail/Tailscale guidance and state that Tailscale/hosted URLs are explicit remote targets, not local recovery candidates; no Unit 07 automatic Tailscale Serve/status CLI was documented as currently available.
- `scripts/smoke-postbox.mjs` isolates smoke state with temporary `PI_POSTBOX_CONFIG_DIR`/`PI_POSTBOX_CONFIG_PATH` and validates active-local health identity when present.
- Repaired dev launcher default-port test is robust while `127.0.0.1:32187` is held by another process.

## commandsRun

- `git status --short && git diff --stat && git diff --cached --name-only` — passed inspection; broad Unit 01-06 worktree changes present; no staged files.
- `npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts` — passed.
- `node --check scripts/smoke-postbox.mjs && node --check scripts/dev.mjs && npm run typecheck -w @pi-postbox/server` — passed.
- Source/grep inspection for stale `3000`, Unit 07 overpromise, active-local docs concepts, smoke `PI_POSTBOX_CONFIG_DIR`, config-base precedence, and dev default `32187` — passed.
- Synthetic busy-port check holding `127.0.0.1:32187` while running `npm test -- packages/server/test/devLauncher.test.ts` — passed.
- `npm run smoke` — passed against already-present packaged assets.
- Direct API smoke with temp config dir and built CLI, then `GET /healthz` — passed; returned matching `localTarget` and wrote metadata under temp config.
- `git diff --name-only && git ls-files --others --exclude-standard ... && git diff --cached --name-only` — inspected changed/untracked relevant files and confirmed no staged files before this verify artifact write.

## validationOutput

Targeted tests:

```text
> npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts

Test Files  3 passed (3)
Tests       15 passed (15)
```

Syntax/typecheck:

```text
> node --check scripts/smoke-postbox.mjs && node --check scripts/dev.mjs && npm run typecheck -w @pi-postbox/server

> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
# node --check commands produced no output
```

Source/grep inspection excerpts:

```text
--- stale 3000 in operator docs/scripts/tests ---
scripts/dev.mjs:230:  }, 3000);
packages/server/test/packageDocs.test.ts:92:    expect(docs, "operator docs should not still describe 3000 as the preferred/default Postbox port").not.toMatch(
packages/server/test/packageDocs.test.ts:93:      /preferred default `3000`|preferred `3000`|prefers port `3000`|port `3000` by default/

--- smoke config isolation and health identity ---
scripts/smoke-postbox.mjs:52:  const { localTarget } = health;
scripts/smoke-postbox.mjs:56:  assert(localTarget.role === "production", ...)
scripts/smoke-postbox.mjs:57:  assert(typeof localTarget.instanceId === "string" ...)
scripts/smoke-postbox.mjs:58:  assert(localTarget.url === normalizedUrl(expectedBaseUrl), ...)
scripts/smoke-postbox.mjs:170:      PI_POSTBOX_CONFIG_DIR: tmp,
scripts/smoke-postbox.mjs:171:      PI_POSTBOX_CONFIG_PATH: join(tmp, "config.json"),
scripts/smoke-postbox.mjs:172:      PI_POSTBOX_ACTIVE_LOCAL_ROLE: "production"

--- config-base precedence/server and default dev port ---
packages/server/src/activeLocalTarget.ts:111:  if (effectiveEnv.PI_POSTBOX_CONFIG_DIR) {
packages/server/src/activeLocalTarget.ts:112:    return effectiveEnv.PI_POSTBOX_CONFIG_DIR;
packages/server/src/activeLocalTarget.ts:115:  if (effectiveEnv.PI_POSTBOX_CONFIG_PATH) {
packages/server/src/activeLocalTarget.ts:116:    return dirname(effectiveEnv.PI_POSTBOX_CONFIG_PATH);
scripts/dev.mjs:27:const API_PORT = Number(process.env.PI_POSTBOX_PORT) || 32187;
scripts/dev.mjs:244-246: "--active-local-role", "dev"
```

Synthetic busy-port check:

```text
# with dummy listener holding 127.0.0.1:32187
> npm test -- packages/server/test/devLauncher.test.ts

Test Files  1 passed (1)
Tests       2 passed (2)
```

Packaged smoke transcript excerpt:

```text
> npm run smoke
[server] pi-postbox-server listening on http://127.0.0.1:36651
Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.
```

Direct product/API evidence with temporary config:

```json
{
  "ok": true,
  "service": "pi-postbox",
  "version": "0.1.0",
  "protocolVersion": "0.1.0",
  "localTarget": {
    "role": "production",
    "instanceId": "8aaf34a0-3ed4-44f7-b8e5-f54193d73bf8",
    "url": "http://127.0.0.1:32797/"
  }
}
```

```text
metadata files under temp config:
<tmp>/active-local/production.json
<tmp>/postbox.sqlite
<tmp>/postbox.sqlite-shm
<tmp>/postbox.sqlite-wal
```

No staged files before artifact write:

```text
git diff --cached --name-only
# no output
```

## evidenceArtifacts

- This verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-verify.md`.
- CLI/API transcript evidence is embedded above: targeted tests, syntax/typecheck, grep/source inspection, synthetic busy-port run, `npm run smoke`, and direct `/healthz` response from a temp-config server.
- Browser/CDP evidence: unavailable/not applicable for this docs/CLI/API smoke unit.

## skippedGates

- Full workspace `npm test`: skipped because Unit 06 requested targeted package docs/active-local/dev-launcher tests plus smoke; broader suite is outside this verification's minimal scope and has substantial unrelated Unit 01-05 coverage.
- Fresh `npm run build`: skipped to avoid modifying generated build artifacts during verification; `npm run smoke` was run only because packaged assets were already present. Server source typecheck passed.
- Browser visual evidence: skipped because no UI/browser behavior changed in this unit and browser/CDP is unavailable/not applicable.

## issuesFound

None.

## residualRisks

- `npm run smoke` exercised the already-present packaged `dist` assets; this verifier did not rebuild generated assets.
- Source inspection confirms no current Unit 07 overpromise in docs, but Unit 07 Tailscale/status behavior itself remains pending by design.

## noStagedFiles

true — `git diff --cached --name-only` produced no output before writing this verification artifact; no files were staged by this verifier.
