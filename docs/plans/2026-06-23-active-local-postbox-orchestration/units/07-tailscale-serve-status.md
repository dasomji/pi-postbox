# Unit 07 — Tailnet-private Tailscale Serve auto-exposure and status

Status: complete

Parent source plan unit: U7 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: make a running Postbox immediately reachable from other Tailnet devices when Tailscale is available, while preserving safe local startup, avoiding destructive Serve changes, and keeping remote Pi clients explicit via copied `PI_POSTBOX_URL`.

Acceptance criteria:
- Add an isolated, mockable Tailscale integration layer, expected at `packages/server/src/tailscaleServe.ts`, that shells out to the installed `tailscale` CLI without adding a long-running SDK dependency.
- Production server startup, after binding the final local URL/port, performs best-effort Tailnet-private Tailscale Serve exposure unless disabled by `--no-tailscale` or `PI_POSTBOX_TAILSCALE=off`.
- Production exposure uses the actual bound Postbox port, including fallback ports, with command shape equivalent to `tailscale serve --bg --https <actual-port> http://127.0.0.1:<actual-port>`.
- Exposure inspects `tailscale serve status --json` before mutating. Existing same-target mappings are idempotent; non-Postbox/conflicting mappings are not overwritten and produce a concise diagnostic/remediation hint.
- Missing CLI, logged-out Tailscale, Serve unavailable, permission denied, command failure, or conflicts never fail local Postbox startup; startup prints the local URL plus concise Tailscale status/diagnostic.
- Permission-denied diagnostics include actionable guidance similar to lizardtail: run `sudo tailscale set --operator=$USER` once, or run the printed manual `tailscale serve --bg --https ...` command with appropriate privileges.
- If `tailscale serve` rejects the loopback URL target but accepts a bare-port target, retry with the bare-port form and report success.
- No code path enables Tailscale Funnel or public internet exposure automatically. Do not add Funnel support.
- Add `pi-postbox-server status` and `pi-postbox-server status --json`.
  - Status works without a running server by inspecting active-local metadata, probing `/healthz` when a candidate exists, and reading Tailscale Serve status when available.
  - Human output includes local URL, Tailnet URL when available, role, conflict/error status, remediation where useful, and a copy-paste `export PI_POSTBOX_URL=...` line for remote Pi machines.
  - JSON output is stable enough for tests and reports running local URL, Tailnet URL, selected role, availability/conflict/error state, and copy-paste remote config when available.
  - Tailnet URL construction follows the lizardtail reference: read `tailscale status --json`, prefer `Self.DNSName` with the trailing dot removed, and fall back to a Tailscale IPv4 address if needed.
- Update `scripts/dev.mjs` so development exposure targets the actual Vite UI port, not the backend API port. If `5173` is busy, dev detects/allocates a free UI port, passes it to Vite, and exposes that actual UI port over Tailscale when safe/non-conflicting. Backend active-local metadata still advertises the backend API URL for Pi extension traffic.
- Update docs (`README.md`, `docs/configuration.md`, `docs/deployment.md`) to explain automatic Tailnet-private Serve exposure, opt-out, conflict behavior, `pi-postbox-server status`, and copy-paste `PI_POSTBOX_URL` guidance for other machines.
- Preserve explicit remote behavior: other Pi machines do not discover Tailnet URLs automatically; users/scripts configure `PI_POSTBOX_URL` from startup/status output. Extension explicit non-loopback `PI_POSTBOX_URL` remains strict and is not replaced by locally detected Tailnet URLs.

Non-goals:
- Do not enable Tailscale Funnel or any public internet exposure.
- Do not require Tailscale for local startup or tests.
- Do not overwrite or delete non-Postbox Tailscale Serve mappings.
- Do not implement cross-machine automatic discovery for Pi extensions.
- Do not revisit active-local resolver/client retargeting except focused regression coverage for explicit remote no-hijack if needed.
- Do not introduce a broad Tailscale SDK or background daemon dependency; keep command execution isolated and mockable.

Likely files/surfaces:
- Create: `packages/server/src/tailscaleServe.ts`
- Modify: `packages/server/src/cli.ts`
- Modify: `scripts/dev.mjs`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/deployment.md`
- Tests: `packages/server/test/tailscaleServe.test.ts`
- Tests: `packages/server/test/cli.test.ts`
- Tests: `packages/server/test/packageDocs.test.ts`
- Tests: `packages/server/test/devLauncher.test.ts`
- Possibly tests: extension explicit remote no-hijack regression if RED finds current coverage insufficient.

Relevant existing code/docs:
- `packages/server/src/cli.ts` owns server startup, `--active-local-role`, `PI_POSTBOX_ACTIVE_LOCAL_ROLE`, default `32187`, fallback binding behavior, and startup output.
- `packages/server/src/activeLocalTarget.ts` owns active-local metadata path convention and role file publishing.
- `packages/protocol/src/health.ts` and `packages/server/src/app.ts` expose `/healthz.localTarget` for identity checks.
- `scripts/dev.mjs` owns dev orchestration, backend API port, web UI process launch, and active-local dev role.
- `docs/configuration.md`, `docs/deployment.md`, and `README.md` currently describe active-local behavior and manual lizardtail/Tailscale guidance from Unit 06.
- Lizardtail reference: `/home/dev/Development/lizardtail/src/index.ts`, especially command-exec shape, fake CLI tests, `exposeWithTailscaleDetailed`, `getTailscaleDnsName`, `getTailscaleExposureStatus`, status `Web` parsing, permission-error help, and tailnet URL construction.
- ADR: `docs/adr/0002-tailnet-private-tailscale-auto-exposure.md` defines trust boundary and safety decisions.

Targeted validation commands for role agents:
- `npm test -- packages/server/test/tailscaleServe.test.ts`
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
- `npm test -- packages/server/test/devLauncher.test.ts` if dev launcher changes/tests are included.
- `npm run typecheck -w @pi-postbox/server`
- `node --check scripts/dev.mjs`
- Source/grep inspection that no command invokes `tailscale funnel` and docs do not describe public/Funnel auto-exposure.
- CLI/API transcript evidence from fake Tailscale command tests or bounded spawned CLI smoke; do not require real Tailscale.

Safety constraints:
- Parent coordinator must not edit implementation/test files or run validation directly; role agents run validation.
- Tests must not require a real logged-in Tailscale daemon. Use fake CLI/mocked command execution and temp directories.
- Tailscale mutation in tests must be fake-only; never run real `tailscale serve` in CI/test code.
- Keep startup robust: Tailscale failures must be diagnostics, not process failures.
- Avoid exact prose overfitting in docs tests; assert stable operational concepts and command flags.
- Keep one writer at a time. Do not start implementation before RED artifact proves intended failures.

Suggested RED focus:
- Add `packages/server/test/tailscaleServe.test.ts` with a fake command executor covering:
  - CLI missing/logged out/permission denied/success/conflict/idempotent same mapping.
  - `tailscale serve status --json` inspection before mutation.
  - command shape `tailscale serve --bg --https <actual-port> http://127.0.0.1:<actual-port>` and no `tailscale funnel` invocation.
  - loopback URL rejection followed by bare-port retry success.
  - DNS name construction from `tailscale status --json` `Self.DNSName`, trailing-dot removal, and IPv4 fallback.
- Extend `packages/server/test/cli.test.ts` for:
  - startup best-effort exposure on final bound port and local + Tailnet output.
  - fallback bound port exposure when preferred `32187` is busy.
  - `--no-tailscale` and `PI_POSTBOX_TAILSCALE=off` skip Serve mutation.
  - `pi-postbox-server status` and `status --json` work from active-local metadata/temp config without a running server, including remediation/export line.
- Extend `packages/server/test/devLauncher.test.ts` for:
  - Vite UI port selection when `5173` is busy.
  - Vite receives the actual UI port.
  - Tailscale exposure targets the UI port, while backend active-local metadata remains backend API role/url.
  - Opt-out skips dev Tailscale mutation.
- Extend `packages/server/test/packageDocs.test.ts` for:
  - automatic Tailnet-private Serve docs, opt-out, conflict/non-clobbering, status command, copy-paste `PI_POSTBOX_URL`, no Funnel/public auto-exposure.
- If current extension tests do not already lock it, add a focused regression proving explicit non-loopback/Tailscale `PI_POSTBOX_URL` remains authoritative and is not replaced by locally detected active-local/Tailnet URLs.
- RED should prove failures against missing `tailscaleServe.ts`, missing status command, current dev UI port behavior, and missing docs.

Phase artifacts:
- RED: `../artifacts/07-red.md`
- GREEN: `../artifacts/07-green.md`
- REVIEW: `../artifacts/07-review.md`
- REPAIR: `../artifacts/07-repair.md` if needed
- REREVIEW: `../artifacts/07-rereview.md` if needed
- VERIFY: `../artifacts/07-verify.md`

Current phase: complete.

Latest validation: VERIFY passed. Targeted Tailscale/CLI/docs/dev-launcher tests, server typecheck, dev script syntax, source/docs grep inspections, and fake-Tailscale startup/status CLI transcripts passed. See `../artifacts/07-verify.md`.

Risks:
- Tailscale CLI may not be installed/logged in locally; tests must use fake CLI/mocked execution.
- Status JSON shapes may vary; implementation should parse defensively and preserve useful diagnostics without crashing.
- Dev launcher changes can introduce long-running/racy tests; prefer fake child processes, allocated temp ports, bounded timeouts, and cleanup.
- CLI status can accidentally mutate state; `status` should inspect/report, not enable Serve.
- Startup can accidentally become dependent on Tailscale; all Tailscale paths must be best-effort.
- Docs can overpromise automatic discovery. Keep remote machine setup explicit via copied `PI_POSTBOX_URL`.
- Reviewer nested Claude can hang; ask reviewers to skip or bound nested Claude to <=8 seconds.
