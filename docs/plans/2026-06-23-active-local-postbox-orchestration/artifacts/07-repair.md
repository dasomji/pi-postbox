# Unit 07 REPAIR — accepted review findings

## changedFiles

- `scripts/dev.mjs`
- `packages/server/src/tailscaleServe.ts`
- `packages/server/test/devLauncher.test.ts`
- `packages/server/test/tailscaleServe.test.ts`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/07-repair.md`

## commandsRun

- `npm test -- packages/server/test/tailscaleServe.test.ts`
- `npm test -- packages/server/test/devLauncher.test.ts`
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
- `npm run typecheck -w @pi-postbox/server`
- `node --check scripts/dev.mjs`
- `grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts || true`
- `git diff --cached --name-only | sed -n '1,20p'`

## validationOutput

- `npm test -- packages/server/test/tailscaleServe.test.ts`
  - Passed: 1 test file, 9 tests.
- `npm test -- packages/server/test/devLauncher.test.ts`
  - Passed: 1 test file, 4 tests.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts`
  - Passed: 3 test files, 27 tests.
- `npm run typecheck -w @pi-postbox/server`
  - Passed with no TypeScript errors.
- `node --check scripts/dev.mjs`
  - Passed with no output.
- Source Funnel inspection
  - No matches in `packages/server/src` or `scripts` for `tailscale funnel` / `funnel` command paths.
- Staging check
  - `git diff --cached --name-only` produced no output.

## findingsAddressed

1. Dev launcher backend child now passes `--no-tailscale` while still passing `--active-local-role dev`; launcher-managed Tailscale Serve exposure remains targeted at the selected Vite UI port and still honors global `PI_POSTBOX_TAILSCALE=off`.
2. Bare-port retry is now gated by `isLoopbackUrlTargetRejection`; unrelated primary `tailscale serve` failures return an unavailable diagnostic/remediation without issuing a second Serve mutation. Added focused coverage that asserts no bare-port retry for a non-target-form failure.

## residualRisks

- The loopback target rejection classifier is intentionally conservative and based on CLI error text; future Tailscale versions with different wording may require classifier broadening.
- No real Tailscale daemon was used; validation relies on fake/mocked command execution as required by the unit safety constraints.

## noStagedFiles

true
