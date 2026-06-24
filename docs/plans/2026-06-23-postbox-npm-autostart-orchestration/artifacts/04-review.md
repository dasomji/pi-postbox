# U4 REVIEW — status model, command, and read-only tool

## Findings

1. **Severity:** Medium  
   **Location:** `packages/extension/src/client/PostboxClient.ts:233`  
   **Requirement/pattern violated:** R6/U4 requires `/postbox-status` and `postbox_status` to report Tailnet URL when available, remote config export, and Tailnet-unavailable diagnostics; the plan specifically says to reuse server status JSON behavior where practical (`docs/plans/2026-06-23-001-feat-postbox-npm-autostart-plan.md:275-291`).  
   **Issue:** The real connected-client status path only calls `createUrlStatusSnapshot` with `currentServerUrl` and `diagnostics: []` (`packages/extension/src/client/PostboxClient.ts:233-242`). For the common active-local/autostarted local server case, that can report the local URL but has no path to discover/populate the server's Tailnet URL, remote export line, or Tailscale unavailable diagnostic. The Tailnet-unavailable GREEN test does not exercise the real implementation; it injects a mocked `statusSnapshot` containing Tailscale fields (`packages/extension/test/status.test.ts:230-245`).  
   **Required fix:** Populate connected/local snapshots from a read-only server status source (for example the existing server status JSON/collector or an equivalent read-only endpoint/helper) so actual local connections include Tailnet URL + remote export when available and Tailscale diagnostics when unavailable. Add coverage that uses the real status path rather than a mocked `PostboxClient.getStatusSnapshot`.

2. **Severity:** Medium  
   **Location:** `packages/extension/src/client/PostboxClient.ts:241`  
   **Requirement/pattern violated:** U4 acceptance requires disconnected status to report unavailable diagnostics.  
   **Issue:** `PostboxClient` records `connectionState = "disconnected"` on socket error/close (`packages/extension/src/client/PostboxClient.ts:335-345`), but `getStatusSnapshot` always returns `diagnostics: []` (`packages/extension/src/client/PostboxClient.ts:236-242`). If a registered client loses its socket, `/postbox-status`/`postbox_status` will render `Connection: disconnected` with `Diagnostics: none`, even though the requirement asks for unavailable diagnostics. Existing disconnected coverage only covers the no-client resolver path, not an existing client that disconnects.  
   **Required fix:** Track and expose a non-sensitive last connection diagnostic (for example `websocket:disconnected`, `socket-error:<safe message>`, or resolver/autostart status) in the client snapshot, and add a regression test for a connected client transitioning to disconnected.

## Validation notes

- Nested Claude reviewer was not attempted per task instruction.
- Scope checked: U4 dossier, implementation plan R6/U4 section, `04-red.md`, `04-green.md`, current U4 source/diff for `packages/extension/src/status.ts`, `packages/extension/src/index.ts`, `packages/extension/src/client/PostboxClient.ts`, `packages/extension/src/commands/localFallback.ts`, and `packages/extension/test/status.test.ts`.
- Targeted U4 tests and typecheck pass, but the findings above are gaps in the real status data source and disconnected-client diagnostics that current tests do not exercise.

## commandsRun

- `git status --short && git diff --stat` — passed; inspected current worktree and diff stat.
- Read `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/units/04-status-model-command-tool.md`, `artifacts/04-red.md`, and `artifacts/04-green.md` — passed; reviewed U4 contract and TDD evidence.
- `git diff -- packages/extension/src/status.ts packages/extension/src/index.ts packages/extension/src/client/PostboxClient.ts packages/extension/src/commands/localFallback.ts packages/extension/test/status.test.ts` — passed; inspected relevant U4 diff.
- `npm test -- packages/extension/test/status.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts` — passed; 4 files / 26 tests.
- `npm run typecheck` — passed; `tsc -b` completed successfully.
- `git diff --cached --name-only && git status --short` — passed; confirmed no staged files before writing this review artifact.
- `nl -ba packages/extension/src/client/PostboxClient.ts | sed -n '220,245p'; nl -ba packages/extension/src/status.ts | sed -n '1,120p'; nl -ba packages/extension/test/status.test.ts | sed -n '226,260p'; nl -ba docs/plans/2026-06-23-001-feat-postbox-npm-autostart-plan.md | sed -n '275,292p'` — passed; gathered line-numbered evidence for findings.

## residualRisks

- No live server/Tailscale integration was run; review conclusions are based on code inspection plus targeted tests.
- Repository contains unrelated pre-existing U1-U3/planning changes; this review focused on U4-relevant surfaces.

## noStagedFiles

true
