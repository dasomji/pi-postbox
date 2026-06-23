# Final verification — active-local Postbox routing + Tailnet-private Tailscale Serve

## PASS|FAIL|BLOCKED

PASS — the complete active-local Postbox routing + Tailnet-private Tailscale Serve branch is verified for commit/PR preparation.

## requirementsChecked

- Active-local metadata contract and health identity: protocol schema/tests cover safe numeric loopback metadata, role precedence, stale rejection, bounded parsing/sanitized diagnostics, and backward-compatible `/healthz.localTarget`; server smoke/API evidence shows `/healthz` returns Postbox health with active-local identity when running.
- Server publishing/dev role/config defaults: server tests cover metadata publication on the actual fallback port, `/healthz.localTarget` matching metadata, non-loopback no-publish behavior, validated roles, default `production`, dev launcher `--active-local-role dev`, and canonical port `32187`.
- Extension resolver startup/live retargeting/affinity/no-hijack: extension tests cover explicit non-loopback `PI_POSTBOX_URL` as authoritative with polling disabled, active-local dev-over-production startup selection, configured loopback recovery, no-client supervisor startup recovery, live retargeting, unsent ask retargeting, sent-ask/local-fallback origin pinning, deferred switching, and bounded dead-origin release.
- Docs/smoke safety: `scripts/smoke-postbox.mjs` uses temp `PI_POSTBOX_CONFIG_DIR`/`PI_POSTBOX_CONFIG_PATH` and starts the built server with both `--no-tailscale` and `PI_POSTBOX_TAILSCALE=off`; package docs tests statically lock this down.
- Tailscale Serve safety: implementation/tests cover best-effort startup, Tailnet-private `tailscale serve --bg --https <actual-port> http://127.0.0.1:<actual-port>`, opt-out, idempotent same mapping, non-clobbering conflicts, permission remediation, bare-port retry only for target-form rejection, and no Funnel/public command path.
- Status/final repair: source/tests/direct fake-CLI evidence show `pi-postbox-server status --json` is inspect-only/offline-capable, selects dev/production only after freshness + `/healthz` + exact `localTarget` role/instance/url identity, falls back from unhealthy/mismatched dev to healthy production, and does not inspect/mutate Tailscale when no healthy target exists.
- Config/default-port/docs consistency: source/docs/tests use `32187`; config base precedence is `PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`; docs keep remote machines explicit via copied `PI_POSTBOX_URL` and do not overpromise cross-machine discovery.

## commandsRun

- `git status --short && git diff --cached --name-only && git diff --stat && git ls-files --others --exclude-standard` — passed inspection; broad intentional unstaged/untracked branch changes present; no staged files.
- `npm test -- packages/protocol/test/activeLocal.test.ts packages/protocol/test/health.test.ts` — failed as an invalid suggested path; Vitest found no files under `packages/protocol/test`. Reran the actual test paths below.
- `npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts` — passed; 2 files / 13 tests.
- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/app.test.ts packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/devLauncher.test.ts packages/server/test/packageDocs.test.ts` — passed; 6 files / 45 tests.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts` — passed; 4 files / 33 tests.
- `npm run typecheck -w @pi-postbox/protocol && npm run typecheck -w @pi-postbox/server && npm run typecheck -w @pi-postbox/extension` — passed; no diagnostics.
- `npm run typecheck` — passed full workspace TypeScript build; no diagnostics.
- `node --check scripts/smoke-postbox.mjs && node --check scripts/dev.mjs` — passed with no output.
- `npm test` — passed full workspace tests; 27 files / 140 tests.
- `npm run build` — passed; rebuilt TypeScript packages and web assets, then copied web assets to `packages/server/dist/public`.
- `npm run smoke` — passed after rebuild; smoke starts built server with Tailscale disabled and temp config, verifies health/UI shell/fake extension/SSE/answer/state/history.
- Source/grep inspection for smoke opt-out/temp config, no Funnel/public command path, `32187`/config precedence, status inspect-only references — passed.
- Fake Tailscale `pi-postbox-server status --json` transcript with temp metadata + fake health server + fake `tailscale` binary — passed; output included local URL, Tailnet URL, remote `PI_POSTBOX_URL`, and Tailscale calls were only `serve status --json` and `status --json`.

## validationOutput

```text
npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts
Test Files  2 passed (2)
Tests       13 passed (13)
```

```text
npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/app.test.ts packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/devLauncher.test.ts packages/server/test/packageDocs.test.ts
Test Files  6 passed (6)
Tests       45 passed (45)
```

```text
npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts
Test Files  4 passed (4)
Tests       33 passed (33)
```

```text
npm test
Test Files  27 passed (27)
Tests       140 passed (140)
```

```text
npm run typecheck
> tsc -b
# passed with no diagnostics
```

```text
npm run build
✓ 151 modules transformed.
✓ built in 1.98s
Copied web assets to /home/dev/Development/pi-daniel/extensions/dashboard/packages/server/dist/public
```

```text
npm run smoke
[server] pi-postbox-server listening on http://127.0.0.1:38829
[server] Tailscale Serve: disabled by --no-tailscale or PI_POSTBOX_TAILSCALE=off
Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.
```

```text
Smoke/source safety grep:
scripts/smoke-postbox.mjs:166:    "--no-tailscale"
scripts/smoke-postbox.mjs:171:      PI_POSTBOX_CONFIG_DIR: tmp,
scripts/smoke-postbox.mjs:172:      PI_POSTBOX_CONFIG_PATH: join(tmp, "config.json"),
scripts/smoke-postbox.mjs:174:      PI_POSTBOX_TAILSCALE: "off"
No matches for: tailscale\s+funnel|--funnel|--public
```

```json
{
  "localUrl": "http://127.0.0.1:34275/",
  "tailnetUrl": "https://postbox.tailnet.example:34275",
  "role": "production",
  "availability": "running",
  "health": "ok",
  "tailscale": {
    "state": "served",
    "diagnostic": "Tailscale Serve points at this Postbox instance.",
    "httpsPort": 34275
  },
  "remoteConfig": "export PI_POSTBOX_URL=https://postbox.tailnet.example:34275",
  "diagnostics": []
}
```

```text
Fake status Tailscale calls:
serve status --json
status --json
Fake status evidence passed with no Serve mutation.
```

## evidenceArtifacts

- This artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/final-verify.md`.
- Product evidence embedded above: rebuilt packaged smoke CLI transcript and fake-Tailscale status JSON/command transcript.
- Prior unit/final review artifacts reviewed: `01-verify.md` through `07-verify.md`, `final-review.md`, `final-repair.md`, `final-rereview.md`.

## skippedGates

- Real Tailscale Serve/Funnel/daemon validation — skipped by explicit safety constraint; verification used fake CLI/source/tests only and did not mutate operator Tailscale state.
- Browser/CDP screenshot/video — unavailable/not applicable; observable behavior for this branch is CLI/API/status/workflow and was evidenced by smoke/status transcripts.
- Suggested `packages/protocol/test/...` target paths — not real repo paths; rerun against actual `packages/protocol/src/*.test.ts` paths.

## issuesFound

None blocking/actionable.

## residualRisks

- No real Tailnet daemon was exercised by design; real Tailscale CLI output can vary, though parser behavior is covered by fake/mocked shapes and source inspection confirms no public/Funnel path.
- Build output under ignored `dist` directories was rebuilt for smoke evidence; git status did not show tracked generated-file changes.

## changedFilesReviewed

Tracked modified files reviewed by status/diff/source/tests:

- `README.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`
- `docs/prd/pi-postbox.md`
- `docs/protocol.md`
- `packages/extension/src/client/PostboxClient.ts`
- `packages/extension/src/index.ts`
- `packages/extension/test/extension.test.ts`
- `packages/extension/test/localFallback.test.ts`
- `packages/extension/test/resilience.test.ts`
- `packages/protocol/src/health.test.ts`
- `packages/protocol/src/health.ts`
- `packages/protocol/src/index.ts`
- `packages/server/src/app.ts`
- `packages/server/src/cli.ts`
- `packages/server/test/app.test.ts`
- `packages/server/test/cli.test.ts`
- `packages/server/test/packageDocs.test.ts`
- `scripts/dev.mjs`
- `scripts/smoke-postbox.mjs`

Untracked intentional files reviewed by status/source/tests:

- `docs/adr/0002-tailnet-private-tailscale-auto-exposure.md`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/**`
- `packages/extension/src/activeLocalTargetResolver.ts`
- `packages/extension/test/activeLocalTargetResolver.test.ts`
- `packages/protocol/src/activeLocal.ts`
- `packages/protocol/src/activeLocal.test.ts`
- `packages/server/src/activeLocalTarget.ts`
- `packages/server/src/tailscaleServe.ts`
- `packages/server/test/activeLocalTarget.test.ts`
- `packages/server/test/devLauncher.test.ts`
- `packages/server/test/tailscaleServe.test.ts`

## noStagedFiles

true — `git diff --cached --name-only` produced no output during final verification; no files were staged.
