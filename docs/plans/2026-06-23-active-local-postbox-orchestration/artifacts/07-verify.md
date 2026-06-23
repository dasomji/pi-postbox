# Unit 07 VERIFY — Tailnet-private Tailscale Serve auto-exposure and status

## PASS

Unit 07 is complete for the reviewed scope. Targeted tests, typecheck, script syntax, fake-Tailscale CLI evidence, and source/docs inspection passed. No blocking issues were found.

## requirementsChecked

- Isolated/mockable Tailscale integration: `packages/server/src/tailscaleServe.ts` exposes injectable command execution; `packages/server/test/tailscaleServe.test.ts` uses fake executors and never requires a real Tailscale daemon.
- Startup best-effort Tailnet-private Serve exposure on the actual bound production port with opt-out: source calls exposure only after `listenWithPortFallback`; fake startup transcript proved fallback listen port `36155` was used in `tailscale serve --bg --https 36155 http://127.0.0.1:36155`; `--no-tailscale` / `PI_POSTBOX_TAILSCALE=off` are parsed and logged.
- Status command/status JSON offline behavior without mutating Serve: `main()` routes `status` to `collectPostboxServerStatus()` and `inspectPostboxTailscaleStatus()`; fake status transcript produced JSON with local URL, Tailnet URL, role, health, remoteConfig, and Tailscale calls only `serve status --json` + `status --json` with no `serve --bg` mutation.
- Non-clobbering/idempotent Serve handling and diagnostics: tests cover pre-mutation `serve status --json`, same-target idempotence, conflicting target no mutation, missing CLI, logged-out, and permission remediation including `sudo tailscale set --operator=$USER` plus manual serve command.
- Loopback target rejection bare-port retry only for target-form errors: repaired tests cover retry on URL target-form rejection and no retry on unrelated Serve unavailable failure.
- No Tailscale Funnel/public automatic path: source/docs grep found no `tailscale funnel`, `--funnel`, `--public`, or automatic public/Funnel Postbox command path.
- Dev launcher behavior: `scripts/dev.mjs` selects an actual Vite UI port, exposes that UI port through fake Tailscale, passes `POSTBOX_DEV_WEB_PORT`, starts backend with `--active-local-role dev --no-tailscale`, preserves backend API port/env, and honors `PI_POSTBOX_TAILSCALE=off`.
- Documentation: README, configuration, and deployment docs describe automatic Tailnet-private Serve, opt-out, conflict/non-clobbering behavior, status/status JSON, copied `export PI_POSTBOX_URL=...`, explicit remote configuration, and no automatic cross-machine discovery.

## commandsRun

- `npm test -- packages/server/test/tailscaleServe.test.ts` — passed, 1 file / 9 tests.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts` — passed, 3 files / 27 tests.
- `npm test -- packages/server/test/devLauncher.test.ts` — passed, 1 file / 4 tests.
- `npm run typecheck -w @pi-postbox/server` — passed.
- `node --check scripts/dev.mjs` — passed with no output.
- Source/docs inspection grep for Funnel/public exposure and command/status/opt-out paths — passed; no automatic public/Funnel path found.
- `git diff --name-only`, `git ls-files --others --exclude-standard ...`, `git diff --cached --name-only` — collected changed/untracked/staged evidence; no staged files.
- Temp-compiled fake-Tailscale startup transcript — passed evidence assertions; process was stopped by `timeout` after startup evidence.
- Temp-compiled fake-Tailscale `status --json` transcript — passed and confirmed no Serve mutation.

## validationOutput

```text
npm test -- packages/server/test/tailscaleServe.test.ts
Test Files  1 passed (1)
Tests       9 passed (9)
```

```text
npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts
Test Files  3 passed (3)
Tests       27 passed (27)
```

```text
npm test -- packages/server/test/devLauncher.test.ts
Test Files  1 passed (1)
Tests       4 passed (4)
```

```text
npm run typecheck -w @pi-postbox/server
> tsc -p tsconfig.json --noEmit
# passed with no diagnostics
```

```text
node --check scripts/dev.mjs
# passed with no output
```

```text
Funnel/public grep:
- grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts README.md docs/configuration.md docs/deployment.md || true
- grep -RInE 'tailscale[[:space:]]+funnel[[:space:]]+--bg|pi-postbox-server[^\n]*(--funnel|--public)|automatic[^\n]*(public|Funnel)' README.md docs/configuration.md docs/deployment.md packages/server/src scripts || true
# no matches
```

```text
Fake startup transcript excerpt:
pi-postbox-server listening on http://127.0.0.1:36155
Tailscale Serve: served - Tailscale Serve is exposing Postbox to Tailnet devices.
Tailnet URL: https://postbox-start.tailnet.example:36155
Remote Pi machines: export PI_POSTBOX_URL=https://postbox-start.tailnet.example:36155
Tailscale calls:
serve status --json
status --json
serve --bg --https 36155 http://127.0.0.1:36155
busyPort=37479 listenPort=36155 serveHttpsPort=36155
```

```text
Fake status --json transcript excerpt:
{
  "localUrl": "http://127.0.0.1:32909/",
  "tailnetUrl": "https://postbox.tailnet.example:32909",
  "role": "production",
  "availability": "running",
  "health": "ok",
  "tailscale": {
    "state": "served",
    "diagnostic": "Tailscale Serve points at this Postbox instance.",
    "httpsPort": 32909
  },
  "remoteConfig": "export PI_POSTBOX_URL=https://postbox.tailnet.example:32909",
  "diagnostics": []
}
Tailscale calls:
serve status --json
status --json
Mutation calls: none
```

## evidenceArtifacts

- Verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/07-verify.md`.
- Test/source/docs transcript evidence is embedded above. Browser/CDP evidence was unavailable and not applicable for this CLI/docs/source unit.

## skippedGates

- Real Tailscale daemon/login validation — skipped by design and safety constraints; tests and transcripts use fake/mocked `tailscale` commands so verification never mutates real Tailscale Serve state.
- Browser/UI screenshot/video evidence — skipped because browser/CDP is unavailable and Unit 07 observable behavior is CLI/status/docs/source-command behavior.
- Full workspace `npm test` / full `npm run typecheck` — not run; targeted Unit 07 gates plus server typecheck were required and passed. Broader workspace validation belongs to final integration verification.

## issuesFound

None.

## residualRisks

- Tailscale Serve JSON/error text may vary across real Tailscale versions; parser/error classifier is defensive and covered for expected shapes, but new variants may need follow-up.
- No real Tailscale daemon was used; this is intentional per safety constraints, but end-to-end real Tailnet behavior remains an operator/environment smoke item.
- Existing working tree includes unstaged/untracked files from this multi-unit orchestration; verification did not review every non-Unit-07 change.

## noStagedFiles

true
