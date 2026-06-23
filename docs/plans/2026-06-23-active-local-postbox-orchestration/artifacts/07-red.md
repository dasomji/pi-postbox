# Unit 07 RED — Tailnet-private Tailscale Serve auto-exposure and status

## changedFiles

- `packages/server/test/tailscaleServe.test.ts` (new)
- `packages/server/test/cli.test.ts`
- `packages/server/test/devLauncher.test.ts`
- `packages/server/test/packageDocs.test.ts`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/07-red.md`

## testsAddedOrUpdated

- `packages/server/test/tailscaleServe.test.ts`
  - `exposes the actual bound Postbox port after inspecting Serve status and reports the Tailnet URL`
  - `treats an existing same-target Serve mapping as idempotent and does not mutate Serve`
  - `does not overwrite an existing mapping for a different local target`
  - `reports missing-cli/logged-out as an unavailable diagnostic instead of throwing`
  - `sanitizes permission failures and includes operator plus manual Serve guidance`
  - `retries with a bare local port when loopback URL targets are rejected`
  - `reports status from Serve state and falls back to a Tailscale IPv4 URL when DNS is absent`
  - Assertions use a fake command executor and never invoke real Tailscale. They lock command order/shape, DNS trailing-dot trimming, non-clobbering behavior, permission remediation, bare-port retry, status parsing, and no `funnel` command path.
- `packages/server/test/cli.test.ts`
  - Updated default CLI parse expectation to include `command: "serve"` and `tailscaleEnabled: true`.
  - Added `supports explicit Tailscale Serve opt-out by flag or environment` for `--no-tailscale` and `PI_POSTBOX_TAILSCALE=off`.
  - Added `parses offline status commands with stable human and JSON modes instead of starting the server` for `status` and `status --json`.
- `packages/server/test/devLauncher.test.ts`
  - Extended fake PATH commands with a fake `tailscale` CLI.
  - Relaxed existing web invocation assertion to allow future Vite port arguments while preserving backend dev role/API behavior.
  - Added `selects and exposes the actual Vite UI port when 5173 is busy`; asserts Vite receives an actual non-5173 UI port and Tailscale Serve targets that UI port, while backend remains `--active-local-role dev`.
  - Added `skips dev Tailscale Serve mutation when PI_POSTBOX_TAILSCALE=off`.
- `packages/server/test/packageDocs.test.ts`
  - Added `documents automatic Tailnet-private Serve exposure, safe opt-out, status, and explicit remote setup`; asserts automatic Tailnet-private Serve docs, opt-out, non-clobbering/conflict wording, `pi-postbox-server status`, `status --json`, copy-paste `export PI_POSTBOX_URL=`, manual serve command shape, and no automatic Funnel/public command path.

Existing extension tests already cover explicit remote no-hijack (`packages/extension/test/activeLocalTargetResolver.test.ts`, `packages/extension/test/resilience.test.ts`, and `packages/extension/test/extension.test.ts`), so no additional extension regression was added for Unit 07.

## commandsRun

- `npm test -- packages/server/test/tailscaleServe.test.ts`
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
- `npm test -- packages/server/test/devLauncher.test.ts`
- `git diff --cached --name-only`

## validationOutput

- `npm test -- packages/server/test/tailscaleServe.test.ts`
  - Failed as expected before test execution because `packages/server/src/tailscaleServe.ts` / `../src/tailscaleServe.js` does not exist.
  - Key output: `Error: Cannot find module '../src/tailscaleServe.js' imported from .../packages/server/test/tailscaleServe.test.ts`.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
  - Failed as expected: 3 files failed; 14 tests passed; 4 assertion failures plus the missing `tailscaleServe` module suite failure.
  - CLI failures show `parseCliOptions` currently returns host/port/database/role but lacks `command`, `tailscaleEnabled`, and status parsing fields.
  - Docs failure shows docs do not yet mention `automatic Tailnet-private` Serve exposure or the new operational concepts.
- `npm test -- packages/server/test/devLauncher.test.ts`
  - Failed as expected: 1 failed, 3 passed.
  - Failure: `expected undefined to be defined` for the actual Vite UI port when `5173` is busy, proving `scripts/dev.mjs` does not yet select/pass an actual UI port or expose it via Tailscale.
- `git diff --cached --name-only`
  - No output; no staged files.

## expectedFailures

- Missing `packages/server/src/tailscaleServe.ts` is the clean RED signal for the new isolated Tailscale integration layer.
- CLI parser lacks Unit 07 mode/option surface (`command: serve/status`, `status --json`, `tailscaleEnabled`, `--no-tailscale`, `PI_POSTBOX_TAILSCALE=off`).
- Dev launcher still uses the hard-coded Vite port behavior and does not expose the actual UI port through fake Tailscale Serve.
- README/configuration/deployment docs still describe manual lizardtail flow and do not document automatic Tailnet-private Serve exposure/status/opt-out/conflict behavior.

## residualRisks

- The new `tailscaleServe.test.ts` intentionally imports the missing module, so its detailed test bodies will not execute until GREEN creates `packages/server/src/tailscaleServe.ts` with the tested public functions.
- CLI startup-output and full offline `pi-postbox-server status` behavior are currently driven through parser/status-surface tests rather than a spawned CLI transcript because the existing `main` starts a long-running server and has no test-friendly command runner seam yet.
- There are many pre-existing unstaged/untracked files from earlier units in this working tree; this RED phase did not stage anything.

## noStagedFiles

true
