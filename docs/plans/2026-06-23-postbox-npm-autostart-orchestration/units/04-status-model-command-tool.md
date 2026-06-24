# U4: Status model, command, and read-only tool

## Contract
Replace pending-question `/postbox-status` behavior with privacy-preserving connectivity/operator status and expose equivalent structured data through read-only `postbox_status` tool.

## Acceptance criteria
- `/postbox-status` reports connectivity, active/local URL when known, Tailnet URL when available, remote config export line, open question count, autostart enabled/started-by-this-session state, and diagnostics.
- `postbox_status` returns structured status with equivalent fields and is read-only.
- Status never includes pending question prompt text, options, answers, notes, history, or request contents; only counts.
- Disconnected status reports unavailable diagnostics and does not autostart.
- Tailnet unavailable still produces useful local status and diagnostics.

## Non-goals
- Do not implement `/postbox` browser opening.
- Do not change question answer/cancel behavior except as needed to remove status content leakage.
- Do not add public Funnel/auth behavior.

## Likely files/surfaces
- `packages/extension/src/status.ts`
- `packages/extension/src/index.ts`
- `packages/extension/src/commands/localFallback.ts`
- `packages/extension/src/client/PostboxClient.ts`
- Tests: `packages/extension/test/localFallback.test.ts`, `packages/extension/test/extension.test.ts`, `packages/extension/test/askPostbox.test.ts`

## Targeted verification commands
- `npm test -- packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts`
- Add targeted status tests as appropriate.

## Evidence expectations
- RED artifact shows failing status privacy/connectivity/tool tests.
- GREEN artifact shows targeted tests passing.

## Current state
Pending RED.

## Phase artifacts
- RED: `../artifacts/04-red.md`
- GREEN: `../artifacts/04-green.md`
- REVIEW: `../artifacts/04-review.md`
- VERIFY: `../artifacts/04-verify.md`
