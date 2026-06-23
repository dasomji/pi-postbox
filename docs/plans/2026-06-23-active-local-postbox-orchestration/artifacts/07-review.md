# Unit 07 REVIEW — Tailnet-private Tailscale Serve auto-exposure and status

## Findings

1. **Severity:** Medium  
   **Location:** `scripts/dev.mjs:291`  
   **Requirement/pattern violated:** Unit 07 / R18 requires development exposure to target the actual Vite UI port, not the backend API port.  
   **Issue:** The dev launcher now exposes the selected Vite UI port itself, but it starts `pi-postbox-server` without `--no-tailscale` or an equivalent child-only opt-out. Because the server CLI defaults Tailscale auto-exposure on, `npm run dev` will also let the backend child mutate Tailscale Serve for the backend API port. This widens dev exposure beyond the requested Vite UI mapping and can create an extra/conflicting Serve mapping.  
   **Required fix:** Disable server-child Tailscale auto-exposure in `scripts/dev.mjs` (for example pass `--no-tailscale` to the backend child, or set a child-only `PI_POSTBOX_TAILSCALE=off`) while preserving the launcher-managed Vite UI exposure and global opt-out behavior.

2. **Severity:** Low  
   **Location:** `packages/server/src/tailscaleServe.ts:82`  
   **Requirement/pattern violated:** Unit 07 requires the loopback-target fallback to be safe and specifically for the case where Tailscale rejects the loopback URL target.  
   **Issue:** Any non-permission failure from the primary `tailscale serve --bg --https <port> http://127.0.0.1:<port>` command triggers a second Serve mutation using the bare port form. That also retries on unrelated failures (for example daemon/Serve errors or other command failures) rather than only on target-form incompatibility, making the fallback broader than the documented safe retry path.  
   **Required fix:** Gate the bare-port retry on an error classifier for URL/target-form rejection; otherwise return an unavailable diagnostic/remediation without issuing a second mutation.

## Claude reviewer

- Result: Not run. The task allowed skipping/recording unavailable due known prior hangs unless bounded to <=8 seconds; nested Claude was skipped to avoid the known hang mode.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --name-only`
  - `git diff --stat && git diff -- packages/server/src/tailscaleServe.ts packages/server/src/cli.ts scripts/dev.mjs README.md docs/configuration.md docs/deployment.md packages/server/test/tailscaleServe.test.ts packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts packages/server/test/packageDocs.test.ts`
  - `grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts README.md docs/configuration.md docs/deployment.md || true`
  - `npm test -- packages/server/test/tailscaleServe.test.ts`
  - `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
  - `npm test -- packages/server/test/devLauncher.test.ts`
  - `npm run typecheck -w @pi-postbox/server`
  - `node --check scripts/dev.mjs && grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts || true && grep -RInE 'tailscale[[:space:]]+funnel[[:space:]]+--bg|pi-postbox-server[^\n]*(--funnel|--public)|automatic[^\n]*(public|Funnel)' README.md docs/configuration.md docs/deployment.md || true && git diff --cached --name-only`
- Scope checked: Unit dossier, RED/GREEN artifacts, parent U7 plan, ADR, lizardtail reference excerpts, relevant implementation/docs/tests/diff, command-shape/public-Funnel grep, targeted tests/typecheck/script syntax.

## commandsRun

- `npm test -- packages/server/test/tailscaleServe.test.ts` — passed, 1 file / 8 tests.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts` — passed, 3 files / 26 tests.
- `npm test -- packages/server/test/devLauncher.test.ts` — passed, 1 file / 4 tests.
- `npm run typecheck -w @pi-postbox/server` — passed.
- `node --check scripts/dev.mjs` — passed with no output.
- Funnel/public exposure grep — no source/script command-path matches; docs only mention intentional lizardtail public/Funnel outside Postbox automatic path.
- `git diff --cached --name-only` — no output.

## noFileEdits

- No implementation, test, or product documentation files were edited by this reviewer.
- This review artifact was written as requested.
