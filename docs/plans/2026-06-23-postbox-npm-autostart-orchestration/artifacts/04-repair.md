# U4 REPAIR — status real data and disconnected diagnostics

## changedFiles
- `packages/extension/src/status.ts`
- `packages/extension/src/client/PostboxClient.ts`
- `packages/extension/src/index.ts`
- `packages/extension/test/resilience.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/04-repair.md`

## testsAddedOrUpdated
- `packages/extension/test/resilience.test.ts`
  - `status snapshot enriches a real connected local client with Tailnet URL, remote export, and Tailscale diagnostics`
  - `status snapshot preserves socket error and close diagnostics for a disconnected registered client`

## commandsRun
- `npm test -- packages/extension/test/status.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/resilience.test.ts`
  - Result: passed.
  - Summary: 5 test files passed; 36 tests passed.
- `npm run typecheck`
  - Result: passed.
  - Summary: `tsc -b` completed successfully.
- `git diff --cached --name-only && git status --short`
  - Result: passed.
  - Summary: no staged files; working tree still contains existing unstaged/untracked orchestration changes plus this repair.

## validationOutput
- Real `PostboxClient.getStatusSnapshot` for a connected active-local URL now calls the read-only Tailscale status inspector, fills `connection.tailnetUrl`, derives `remoteConfig`, and surfaces Tailscale diagnostics.
- Registered clients now track bounded non-sensitive socket diagnostics from connect errors, socket errors, and close events; disconnected snapshots no longer fall back to `Diagnostics: none` when the client observed a socket failure/close.
- Existing U4 command/tool status tests still pass, and targeted local fallback/extension/ask_postbox/client tests pass.

## residualRisks
- Live Tailscale CLI integration was not run; coverage uses an injected read-only inspector for deterministic connected-client regression coverage.
- The extension-side Tailscale status helper mirrors the server CLI's read-only Serve inspection behavior rather than importing server internals, to avoid adding a package dependency from the extension to the server source.

## noStagedFiles
true
