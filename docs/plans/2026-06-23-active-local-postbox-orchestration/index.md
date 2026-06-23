# Active-local Postbox routing orchestration

Goal: implement `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md` with serial TDD units, preserving explicit remote/Tailscale configuration and adding best-effort Tailnet-private Tailscale Serve support.

Current state:
- Planning/docs are updated but implementation has not started in this orchestration.
- Parent coordinator must not edit implementation/test files or run validation directly.
- Project-agent-auditor completed: `ecb313ba-721c-48b2-9750-171f5680a022`; no project-local overrides needed.
- Browser/CDP evidence likely unavailable because no Chrome/Chromium executable was found; use CLI/API/log evidence fallback unless installed later.
- `pi-intercom`/live supervisor bridge unavailable; children should report blockers in final output.
- Role tool smoke preflight completed. All target agents reported required tools including `smart_compact`; browser/CDP remains unavailable and CLI/API/log fallback evidence is accepted. Agents noted missing repo-local `AGENTS.md`/`CLAUDE.md`/`plan.md`/`progress.md`; this is non-blocking because workspace instructions are supplied by Pi project context and orchestration docs are under this directory.
- Unit 01 complete: RED/GREEN/REVIEW/VERIFY all passed; see `units/01-active-local-contract.md` and artifacts `artifacts/01-*.md`.
- Unit 02 complete: RED/GREEN/REVIEW/REPAIR/REREVIEW/VERIFY all passed; see `units/02-server-metadata-publishing.md` and artifacts `artifacts/02-*.md`.
- Unit 03 complete: RED/GREEN/REVIEW/VERIFY failed once on a racy test seam, then REPAIR/REREVIEW/VERIFY rerun passed; see `units/03-dev-launcher-role.md` and artifacts `artifacts/03-*.md`.
- Unit 04 complete: RED/GREEN/REVIEW/REPAIR/REREVIEW/VERIFY all passed; see `units/04-extension-target-resolver.md` and artifacts `artifacts/04-*.md`.
- Unit 05 complete: RED/GREEN/REVIEW/REPAIR/REREVIEW/VERIFY all passed; see `units/05-live-client-retargeting.md` and artifacts `artifacts/05-*.md`.
- Unit 06 complete: RED/GREEN/REVIEW/REPAIR/REREVIEW/REPAIR-2/REREVIEW-2/VERIFY all passed; see `units/06-docs-smoke-operational-diagnostics.md` and artifacts `artifacts/06-*.md`.
- Unit 07 complete: RED/GREEN/REVIEW/REPAIR/REREVIEW/VERIFY all passed; see `units/07-tailscale-serve-status.md` and artifacts `artifacts/07-*.md`.
- Final full-change review found three actionable integration issues; final repair completed and final rereview passed. See `artifacts/final-review.md`, `artifacts/final-repair.md`, and `artifacts/final-rereview.md`.
- Final verification passed for the complete branch. See `artifacts/final-verify.md`.
- Next action: ready for commit/PR preparation if requested.

Source plan:
- `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`
- PRD: `docs/prd/pi-postbox.md`
- ADR: `docs/adr/0001-pi-session-replacement-lifecycle.md`
- ADR: `docs/adr/0002-tailnet-private-tailscale-auto-exposure.md`
- Lizardtail reference: `/home/dev/Development/lizardtail/src/index.ts`

Units:
1. [Define active-local metadata contract and safety helpers](units/01-active-local-contract.md) — complete
2. [Publish server metadata and health identity](units/02-server-metadata-publishing.md) — complete
3. [Mark dev server role in `scripts/dev.mjs`](units/03-dev-launcher-role.md) — complete
4. [Extension target resolver and initial selection](units/04-extension-target-resolver.md) — complete
5. [Live client retargeting with target affinity](units/05-live-client-retargeting.md) — complete
6. [Docs, smoke coverage, and operational diagnostics](units/06-docs-smoke-operational-diagnostics.md) — complete
7. [Auto-expose Postbox over Tailnet-private Tailscale Serve](units/07-tailscale-serve-status.md) — complete

Decisions:
- Non-loopback `PI_POSTBOX_URL` / config remains authoritative and is never replaced by active-local metadata.
- Active-local metadata is loopback-only, role-scoped, bounded, and health-verified.
- Dev outranks production while fresh/healthy; production is fallback.
- Sent asks and local fallback resolutions pin their origin target until resolved/flushed/expired/released by a bounded client-owned deadline.
- Preferred server port changes from `3000` to `32187`.
- Tailscale Serve auto-exposure is best-effort, Tailnet-private only, non-clobbering, opt-out capable, and remote machines still configure explicit `PI_POSTBOX_URL`.

Cross-unit risks:
- Resolver and client retargeting can accidentally hijack explicit remote/Tailscale URLs; tests must cover startup and live reconnect/poll cases.
- File safety hardening can grow too broad; keep v1 to fixed filenames, atomic writes, bounded parsing, no symlink following, and clear diagnostics.
- Target affinity must avoid duplicate asks without pinning dead targets forever.
- Tailscale status JSON shapes may vary; implementation should be tolerant and command execution isolated/mocked.

Evidence mode:
- Unit-level verifier should collect command output and, for observable CLI/server behavior, CLI transcripts or API response samples. Browser screenshots are only needed if UI behavior changes.
- Browser/CDP evidence fallback is active for now: auditor found verifier has the `web-browser` skill, but local Chrome/Chromium executables were not installed.

Capability audit summary:
- `test-writer`, `implementer`, `tdd-reviewer`, and `verifier` all have `smart_compact`.
- `tdd-reviewer` remains read-only.
- No project-specific skills/MCP/settings overrides are needed.
- MCP has no configured servers/tools in this project.

Latest validation:
- Final verification passed: targeted protocol/server/extension tests, full `npm test` (27 files / 140 tests), package/full workspace typechecks, `npm run build`, `npm run smoke` with Tailscale disabled, source/grep inspections, and fake-Tailscale `status --json` transcript all passed. See `artifacts/final-verify.md`.
- Real Tailscale daemon validation was intentionally skipped by safety requirement; fake/mocked CLI and source inspection were used.
- No validation run by coordinator. Validation was performed by role agents.
