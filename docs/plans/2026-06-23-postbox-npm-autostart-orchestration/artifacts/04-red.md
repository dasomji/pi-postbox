# U4 RED — status model, command, and read-only tool

## changedFiles
- `packages/extension/test/status.test.ts` (new)
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/04-red.md` (new)

## testsAddedOrUpdated
- `packages/extension/test/status.test.ts`
  - `Postbox status surfaces > /postbox-status reports operator connectivity and counts without leaking pending ask content`
    - Asserts `/postbox-status` reports connected/operator fields: local URL, Tailnet URL, remote config export, open question count, autostart enabled/started-by-this-session.
    - Asserts privacy boundary: pending prompt text, option values/labels, notes/history-like content, and local answer hints are absent.
  - `Postbox status surfaces > postbox_status is registered as a read-only structured tool with the same private status fields`
    - Asserts `postbox_status` tool is registered with `annotations.readOnlyHint: true`.
    - Asserts structured `details` includes connection URLs, remote export, open question count, autostart state, diagnostics, and omits pending ask content.
  - `Postbox status surfaces > /postbox-status reports disconnected diagnostics without autostarting a server`
    - Asserts disconnected status reports unavailable/disconnected diagnostics for an unreachable configured remote.
    - Asserts read-only status command does not spawn/autostart a server.
  - `Postbox status surfaces > /postbox-status remains useful when Tailnet is unavailable by showing local URL and diagnostics`
    - Asserts Tailnet-unavailable status still includes connected/local URL and open count.
    - Asserts Tailnet diagnostic is present and no bogus `export PI_POSTBOX_URL=undefined` is shown.

## commandsRun
- `npm test -- packages/extension/test/status.test.ts`
  - Result: failed as expected (RED).
  - Summary: 4 tests failed, 0 passed in the new status test file.
- `npm test -- packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts packages/extension/test/status.test.ts`
  - Result: failed as expected (RED).
  - Summary: existing targeted files passed (22 tests), new status tests failed (4 tests), total 4 failed / 22 passed.
- `git diff --cached --stat && git diff --stat -- packages/extension/test/status.test.ts`
  - Result: passed.
  - Summary: no staged diff output; new status test remains unstaged/untracked.

## validationOutput
- `/postbox-status reports operator connectivity and counts without leaking pending ask content`
  - Failure: current output is pending-question fallback text:
    - `Postbox waiting ask-secret: SECRET_PROMPT deploy customer database?`
    - `Answer: /postbox-answer ask-secret SECRET_OPTION_SHIP,SECRET_OPTION_ABORT ...`
  - Why intended: proves `/postbox-status` still leaks prompt/options and does not yet report connectivity/operator status.
- `postbox_status is registered as a read-only structured tool with the same private status fields`
  - Failure: `expected undefined to be defined` for `harness.tools.get("postbox_status")`.
  - Why intended: proves the read-only structured status tool is not registered yet.
- `/postbox-status reports disconnected diagnostics without autostarting a server`
  - Failure: current disconnected output is `No pending Postbox asks.` instead of unavailable diagnostics.
  - Why intended: proves status still describes pending asks only; spawn assertion remains positioned to guard the read-only/no-autostart requirement during GREEN.
- `/postbox-status remains useful when Tailnet is unavailable by showing local URL and diagnostics`
  - Failure: current output is `No pending Postbox asks.` instead of local URL + Tailnet unavailable diagnostic.
  - Why intended: proves Tailnet-unavailable/local-useful status behavior is missing.

## residualRisks
- The test specifies `annotations.readOnlyHint: true` as the read-only registration marker. If Pi standardizes a different read-only marker, GREEN may need to either include this compatibility annotation or adjust with supervisor approval.
- The structured `postbox_status` details shape is intentionally concrete (`connection`, `openQuestionCount`, `autostart`, `diagnostics`) to lock the public contract; implementation should keep equivalent fields stable.
- Existing repository has many unrelated uncommitted/untracked U1–U3/planning changes; this RED phase did not stage or modify them.

## noStagedFiles
true
