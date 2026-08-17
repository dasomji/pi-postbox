# Postbox live-audit remediation

Date: 2026-08-15
Status: complete — correctness fixes, HTML, full validation, live restart, and Telegram delivery

## Goal

Fix the actionable findings in `docs/audits/2026-08-15-postbox-tool-architecture-live-test.md`, produce a self-contained HTML comparison of context-heavy tool outputs and reduction proposals (including rationale, side effects, and specification collisions), validate against a fresh version/server, and send the HTML plus a concise outcome report through Pi Telegram.

## Pending scope decision

Postbox Question: `postbox-findings-fix-scope-20260815`

Options:

1. `bugs_only_report_verbose` (recommended) — fix correctness/compatibility/restart-diagnostic defects; analyze public API redesigns only in HTML.
2. `safe_api_improvements` — additionally implement backward-compatible API improvements that preserve current defaults/specs.
3. `all_redesigns` — implement every recommendation, including breaking protocol redesigns.

The first Question was cancelled by smart compaction before an Answer. A replacement Question, `postbox-findings-fix-scope-20260815-retry`, remained unanswered after repeated bounded polls and was cancelled at revision 2 with rationale. The safest reversible `bugs_only_report_verbose` scope was used: correctness defects were fixed and public redesigns remain HTML proposals.

## Version and worktree constraints

- Versions were bumped from `0.1.2` to `0.1.3` before new implementation/testing, across root, all workspaces, internal protocol pins, and `package-lock.json`.
- Root `@pi-postbox/protocol` remains `file:packages/protocol`.
- The working tree already contains substantial user changes predating this remediation in README, extension source/tests, protocol source, server CLI/tests, and `scripts/dev.mjs`. Integrate carefully; do not revert or overwrite them.
- `AGENTS.md` requires a version bump plus rebuilt/restarted exact-freshness proof for each repository change.
- No subagent launcher is available in the current toolset/MCP gateway, so the strict `orchestrate-coding` coordinator flow cannot be used. Continue with direct small test-first slices and independent final checks.

## Findings grouped by likely treatment

### Concrete correctness / compatibility fixes

1. **Application and build identity**
   - Health currently reports `version: PROTOCOL_VERSION` because CLI does not pass the server package version to `createPostboxApp`.
   - `PROTOCOL_VERSION` is still `0.1.0` despite incompatible tool/protocol redesign.
   - Dev `buildId` is only `dev-<checkoutId>` and cannot identify executable content.
   - Likely fix: read package version from `packages/server/package.json`, pass it into app health, bump protocol identity to the new coordinated version, and compute a deterministic runtime-content fingerprint for default/dev build IDs. Keep package version and protocol identity separate fields.
   - Relevant files: `packages/protocol/src/health.ts`, `packages/server/src/cli.ts`, `scripts/dev.mjs`, resolver/status tests and docs.

2. **`list_question_status` filter composition**
   - Current `if / else if` ignores `readState` whenever `status` is present.
   - `includeTerminal` is accepted but unused.
   - Proposed semantics: explicit `status` and `readState` compose conjunctively. With neither explicit filter, default stays pending + unread Answers; `includeTerminal: true` broadens that unfiltered default to all lifecycle states. Explicit filters remain authoritative.
   - Relevant code: `packages/server/src/services/requestStore.ts:517+`; existing seams in `questionDiscovery.test.ts`, `lifecycleResolution.test.ts`, and `postboxWait.test.ts`.

3. **Recovery first-read semantics**
   - `getAnswerForRecovery` pre-writes `first_reader_*`, then calls normal `getAnswer`, guaranteeing `alreadyRead: true` even for the winner.
   - Refactor to a shared internal read path that separates authorization owner from actual reader, preserving one transactional first-read result. First recovery winner should get `alreadyRead: false`; later readers get true.
   - Relevant seam: `packages/server/test/ownershipTransfer.test.ts`.

4. **Restart diagnostics**
   - Current target polling/reconnect behavior intentionally pins unresolved work for a bounded target-affinity period, consistent with `docs/protocol.md`; the real defect is opacity.
   - `deferTargetSwitch` calls `onStatus` but does not persist the detail in `connectionDiagnostics`; reconnect scheduling exposes no next retry timestamp/delay.
   - Likely compatible fix: persist deferred-target/affinity and reconnect-scheduled diagnostics in status, include current server identity in status snapshots, and preserve the existing safety behavior rather than shortening it blindly.
   - Relevant files: `packages/extension/src/client/PostboxClient.ts`, `packages/extension/src/status.ts`, `packages/extension/src/serverTargetResolver.ts`, extension resilience/status tests.

### Public contract / verbosity proposals awaiting scope answer

- Structured pending `get_answer` result instead of error-like `Answer not found`.
- Explicit `repositoryId`/`worktreeId`/`featureId` naming or clearer descriptions.
- Privacy-preserving assignable-owner discovery.
- Batch-level shared context/default expansion.
- Optional compact/projection modes for complete details and history.
- Explicit patch/replace semantics for `revise`.
- Optional opaque `ifMatch` shorthand versus the spec-mandated dual revisions.
- Short server-side cursors versus current robust stateless query-bound cursor.

## Specification constraints already confirmed

- `docs/prd/pi-postbox.md` requires rich context persistence, concise final Answer returns, restart recovery, exponential reconnect, idempotency, schema agreement, and privacy-preserving status.
- `docs/protocol.md` explicitly requires:
  - complete rich context for every persisted new Question;
  - full dual `revision` + `ownerRevision` on every update;
  - origin-instance affinity for unresolved work until completion or bounded deadline;
  - profile metadata/health exact match on profile, instance, URL, protocol version, and build ID;
  - clients to use health protocol version before relying on newer fields.
- Therefore changing default complete detail/history output, replacing dual revisions, or removing origin affinity would collide with current contracts. Additive opt-in projections/default expansion can avoid those collisions.

## HTML artifact plan

Target path: `docs/audits/2026-08-15-postbox-verbose-output-reduction.html`

Create a standalone, responsive HTML file (no remote assets/scripts) with side-by-side escaped examples and byte/character comparisons for:

1. repeated batch handoff context → batch-level defaults expanded server-side;
2. complete `get_questions` payload → opt-in compact/projection mode;
3. repeated full history snapshots → opt-in initial snapshot + event deltas;
4. dual revision update payload → optional shorthand analysis, while explaining the explicit protocol collision;
5. long stateless cursor → short stateful handle analysis and restart/expiry tradeoff;
6. multi-call owner-discovery workflow → compact scoped owner candidates and privacy risks.

For each: show current output/input, suggested shape, why it saves context, likely side effects, exact PRD/protocol compatibility, and recommendation (`implement additively`, `document only`, or `do not change default`). Use actual sanitized Postbox examples where possible. Validate the HTML locally, then send it with `telegram_send_file`; send a concise summary with `telegram_send_message` when all fixes and validation are complete.

## Implementation progress

Completed test-first correctness slices:

- `list_question_status` now composes lifecycle/read filters and gives `includeTerminal` defined unfiltered semantics.
- Recovery reads share one transactional read path that separates the authorized owner from the actual reader.
- CLI health uses server package version `0.1.3`; protocol identity is `0.1.3`; default build id is `version+sha256.<runtime-content-prefix>`; the dev launcher no longer supplies a checkout-static build id.
- Extension status now preserves server version/protocol/instance/build identity, scheduled reconnect delay/target, and deferred target/affinity diagnostics. Deferred targets retain their full resolved identity when later applied.
- Scope-ID and revise replacement semantics are explicit in tool schema descriptions and protocol docs.
- Standalone HTML completed at `docs/audits/2026-08-15-postbox-verbose-output-reduction.html`.

## Validation state

Before this remediation, version `0.1.2` passed build, typecheck, and 93 files / 560 tests. Current focused 0.1.3 validation:

- status/recovery red tests failed as expected, then 2 files / 8 tests passed green;
- identity/dev-launcher focused suite passed, 5 files / 21 tests;
- restart/status diagnostics focused suite passed, 2 files / 34 tests, and the wider related 5-file suite had 62/63 pass before the one test-fixture URL was corrected;
- `npm run typecheck` passed;
- `git diff --check` passed;
- HTML parsed with Python, has no remote script/link/image resources, loaded in headless Chrome with 6 comparison cards, populated byte counters, and zero desktop horizontal overflow. Screenshot: `/tmp/screenshot-2026-08-15T15-01-37-816Z.png`.

Final validation completed:

- `npm run build` passed, including the production Vite bundle and copied server assets;
- `npm run typecheck` passed;
- `npm test` passed: 94 files / 563 tests;
- `npm run smoke` passed the complete health/UI/extension/question/restart/history scenario;
- manifest and lockfile workspace versions all equal `0.1.3`;
- `git diff --check` passed;
- the stable development server on `127.0.0.1:41657` was restarted after build. Health reports application/protocol `0.1.3`, profile `development:79522f2660390417`, instance `b5f815fb-15a6-479d-a735-6a66d797f201`, and build `0.1.3+sha256.8a4deafd1cd9d4a0`. An independent runtime-directory calculation returned the same build id. The server process started at 15:04:29, after the validated build.

Final required gates:

- focused red/green tests per implemented finding;
- `npm run build`;
- `npm run typecheck`;
- `npm test`;
- likely `npm run smoke` because identity/CLI/protocol packaging changes are involved;
- restart checkout dev launcher on stable port `41657` after all changes;
- verify `/healthz` advertises package version `0.1.3`, bumped protocol identity, and content-specific build ID;
- verify process start is newer than build/source and test available tools with the fresh protocol runtime;
- note that the currently loaded Pi extension will likely require `/reload` after the protocol bump before `postbox_status` can reconnect.
