# U4 GREEN — status model, command, and read-only tool

## changedFiles
- `packages/extension/src/status.ts` (new)
- `packages/extension/src/autostart.ts`
- `packages/extension/src/client/PostboxClient.ts`
- `packages/extension/src/commands/localFallback.ts`
- `packages/extension/src/index.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/04-green.md` (new)

## testsAddedOrUpdated
- None in GREEN. Existing RED tests in `packages/extension/test/status.test.ts` now pass.

## commandsRun
- `npm test -- packages/extension/test/status.test.ts`
  - Result: passed.
  - Summary: 1 test file passed; 4 status tests passed.
- `npm test -- packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/status.test.ts`
  - Result: passed.
  - Summary: 4 test files passed; 26 tests passed.
- `npm run typecheck`
  - Result: passed.
  - Summary: `tsc -b` completed successfully.
- `git diff --cached --stat`
  - Result: passed.
  - Summary: no staged files.

## validationOutput
- `/postbox-status` now formats a shared privacy-preserving status snapshot instead of pending ask prompts/options.
- `postbox_status` is registered with `annotations.readOnlyHint: true` and returns structured `details` containing connection, remote config, open question count, autostart, and diagnostics.
- Disconnected status resolves diagnostics read-only through active-local target resolution and does not call autostart/spawn.
- Tailnet-unavailable snapshots still render local URL, open question count, and Tailscale diagnostics without emitting `export PI_POSTBOX_URL=undefined`.

## reviewFindings
- None from GREEN implementation. No review pass has been run yet.

## residualRisks
- The extension reports Tailnet URL/remote export from client-provided or active remote status; it does not independently inspect Tailscale Serve from the extension package.
- Repository still contains unrelated pre-existing U1–U3/planning changes and untracked files; this GREEN pass did not stage anything.

## noStagedFiles
true
