# U4 VERIFY — status model, command, and read-only tool

## result
PASS

## requirementsChecked
- `/postbox-status` reports operator status rather than pending ask content: verified in `packages/extension/src/commands/localFallback.ts:50-55`, formatter coverage in `packages/extension/src/status.ts:159-168`, targeted test assertions in `packages/extension/test/status.test.ts:157-172`, and the product transcript below.
- Status includes connectivity, active/local URL, Tailnet URL when available, remote config export, open question count, autostart enabled/started-by-this-session, Tailscale state, and diagnostics: verified by targeted tests (`packages/extension/test/status.test.ts:165-171`, `packages/extension/test/resilience.test.ts:129-144`) and direct command transcript.
- `postbox_status` is registered as a structured read-only tool with equivalent private status fields: verified in `packages/extension/src/index.ts:85-94`, test assertions in `packages/extension/test/status.test.ts:175-205`, and direct tool-registration transcript (`readOnlyHint: true`, empty parameter object, structured `details`).
- Privacy boundary holds: status tests inject secret prompt/options/notes/history and assert absence (`packages/extension/test/status.test.ts:157-172`, `packages/extension/test/status.test.ts:185-205`); direct command transcript reports `secretContentLeaked=false`.
- Disconnected/unavailable status reports diagnostics and does not autostart: verified in `packages/extension/src/status.ts:58-103`, test assertion that `spawn` is not called in `packages/extension/test/status.test.ts:207-227`, and direct unavailable tool details with missing active-local diagnostics.
- Tailnet unavailable/available local paths remain useful: verified by Tailnet-unavailable command coverage in `packages/extension/test/status.test.ts:230-257`, real connected-client enrichment through the read-only inspector in `packages/extension/src/client/PostboxClient.ts:248-263` and `packages/extension/src/status.ts:129-156`, and regression coverage in `packages/extension/test/resilience.test.ts:109-146`.
- R6 safety/read-only intent: status collection uses resolver/status snapshot paths and no autostart call; mutating autostart remains in `ask_postbox` path, while `postbox_status` execution only calls `collectExtensionPostboxStatusSnapshot` (`packages/extension/src/index.ts:91-93`).

## commandsRun
- `git status --short && git diff --stat && git diff --cached --stat` — passed; inspected worktree and confirmed no staged diff output before verification.
- Read U4 dossier and artifacts: `04-red.md`, `04-green.md`, `04-review.md`, `04-repair.md`, `04-rereview.md` — passed; accepted review issues were repaired and rereview reported no findings.
- `npm test -- packages/extension/test/status.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/resilience.test.ts` — passed; 5 test files, 36 tests.
- `npm run typecheck` — passed; `tsc -b` completed successfully.
- `npm test` — passed; 29 test files, 162 tests.
- Product evidence transcript command: `tmpdir=$(mktemp -d); PI_POSTBOX_CONFIG_DIR="$tmpdir" node --input-type=module <<'NODE' ... NODE; rm -rf "$tmpdir"` — passed; exercised built `/postbox-status` command registration/handler and `postbox_status` tool registration/execution without staging or app source edits.
- `npm run build` — passed; `tsc -b`, Vite web build, and web asset copy completed.
- `git diff --cached --name-only && git status --short` — passed; no staged files after verification commands.

## evidenceArtifacts

### Direct product transcript

```text
--- /postbox-status command transcript ---
Pi Postbox status
Connection: connected
Active URL: http://127.0.0.1:3500/
Local URL: http://127.0.0.1:3500/
Tailnet URL: https://postbox.tailnet.example/
Remote config:
export PI_POSTBOX_URL=https://postbox.tailnet.example/
Open questions: 1
Autostart: enabled (started by this session)
Tailscale: served - Tailscale Serve points at this Postbox instance.
Diagnostics: none
secretContentLeaked=false
--- postbox_status tool registration ---
{
  "registered": true,
  "readOnlyHint": true,
  "parameters": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
--- postbox_status unavailable execution details ---
{
  "connection": {
    "state": "unavailable"
  },
  "openQuestionCount": 0,
  "autostart": {
    "enabled": true,
    "startedByThisSession": false
  },
  "diagnostics": [
    "Pi Postbox is not connected.",
    "dev.json:dev:missing",
    "production.json:production:missing"
  ],
  "tailscale": {
    "state": "unavailable",
    "diagnostic": "No healthy Postbox target is available."
  }
}
```

### Test/build evidence
- Targeted U4 gate: 5 files / 36 tests passed.
- Full test gate: 29 files / 162 tests passed.
- Typecheck: `tsc -b` passed.
- Build: TypeScript + Vite + asset copy passed.

## skippedGates
- Live Tailscale CLI/server integration was not run: it depends on host Tailscale login/Serve state and is outside the deterministic U4 acceptance scope. Coverage uses injected read-only Tailscale inspector regression tests plus formatter/tool/command transcript evidence.
- `npm run smoke` was not run: the release smoke script validates packaged server ask/answer/history flow, not the U4 extension status surfaces; full tests, typecheck, and build were run instead.

## issuesFound
None.

## residualRisks
- No live Tailnet environment was exercised, so real `tailscale serve status --json` shape/host behavior remains covered by deterministic inspector tests rather than end-to-end host integration.
- `postbox_status` on a connected local server may call the host `tailscale` CLI to collect read-only diagnostics; verification confirmed no autostart/server spawn path, but did not simulate a hanging Tailscale CLI.
- The worktree contains unrelated U1-U3/planning changes; verification focused on U4 surfaces and did not certify unrelated modified files.

## noStagedFiles
true
