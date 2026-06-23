# Unit 07 GREEN — Tailnet-private Tailscale Serve auto-exposure and status

## changedFiles

- `packages/server/src/tailscaleServe.ts` (new isolated/mockable Tailscale CLI integration)
- `packages/server/src/cli.ts` (serve/status parse surface, startup exposure, offline status reporting)
- `scripts/dev.mjs` (actual Vite UI port selection and best-effort dev Tailscale Serve exposure)
- `README.md` (automatic Tailnet-private Serve/status/explicit remote setup docs)
- `docs/configuration.md` (opt-out/status/conflict/remediation configuration docs)
- `docs/deployment.md` (startup/dev/status Tailnet-private Serve operational docs)
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/07-green.md` (this artifact)

## commandsRun

- `npm test -- packages/server/test/tailscaleServe.test.ts`
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
- `npm test -- packages/server/test/devLauncher.test.ts`
- `npm run typecheck -w @pi-postbox/server`
- `node --check scripts/dev.mjs`
- `grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts || true`
- `grep -RInE 'tailscale[[:space:]]+funnel[[:space:]]+--bg|pi-postbox-server[^\n]*(--funnel|--public)|automatic[^\n]*(public|Funnel)' README.md docs/configuration.md docs/deployment.md || true`
- `git status --short && git diff --cached --name-only`

## validationOutput

- `npm test -- packages/server/test/tailscaleServe.test.ts`
  - Passed: 1 test file, 8 tests.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
  - Passed after docs updates: 3 test files, 26 tests.
- `npm test -- packages/server/test/devLauncher.test.ts`
  - Passed: 1 test file, 4 tests.
- `npm run typecheck -w @pi-postbox/server`
  - Passed with no TypeScript errors.
- `node --check scripts/dev.mjs`
  - Passed with no syntax errors/output.
- Source/docs Funnel inspection:
  - `packages/server/src` and `scripts` grep produced no `tailscale funnel`/`funnel` command path matches.
  - `README.md`, `docs/configuration.md`, and `docs/deployment.md` grep produced no automatic public/Funnel command-path matches.
- `git diff --cached --name-only`
  - No output; no staged files.

## implementationNotes

- Added `tailscaleServe.ts` with injectable command execution, pre-mutation `tailscale serve status --json` inspection, idempotent same-target detection, conflict diagnostics, permission remediation, loopback-target fallback to bare port, DNS-name trimming, and Tailscale IPv4 fallback.
- CLI parsing now distinguishes `serve` and offline `status`, supports `status --json`, and honors `--no-tailscale` / `PI_POSTBOX_TAILSCALE=off` for startup mutation.
- Server startup remains best-effort: local bind/metadata publication completes first; Tailscale errors are printed diagnostics and do not throw out of startup.
- Offline status reads active-local metadata, probes `/healthz`, inspects Tailscale Serve when a local target exists, and prints/serializes local URL, Tailnet URL, role, availability, remediation, and copy-paste `export PI_POSTBOX_URL=...` when available.
- Dev launcher now allocates a free Vite UI port when `5173` is busy, passes the selected port to Vite and `POSTBOX_DEV_WEB_PORT`, keeps backend active-local metadata on the backend API port, and exposes the selected UI port over Tailscale Serve when enabled/non-conflicting.
- Docs now describe automatic Tailnet-private Serve, non-clobbering conflict behavior, opt-out, status commands, remediation, and explicit remote `PI_POSTBOX_URL` setup.

## residualRisks

- Status reporting is intentionally concise and defensive; real-world Tailscale Serve JSON variants beyond the tested `Web`/`Handlers`/`Proxy` shape may need follow-up parser broadening.
- Dev launcher Tailscale exposure is best-effort and runs before Vite is spawned; Serve can point at the selected port before Vite finishes starting, which matches persistent Serve behavior but may show a transient unavailable page.
- This unit does not implement any automatic cross-machine Pi discovery; remote machines still require copied `PI_POSTBOX_URL`.
- The working tree contains many pre-existing unstaged/untracked files from earlier units; this GREEN phase did not stage anything.

## noStagedFiles

true
