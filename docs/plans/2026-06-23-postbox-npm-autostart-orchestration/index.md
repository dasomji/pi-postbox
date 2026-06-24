# Orchestration: Postbox combined npm package and autostart

## Goal
Implement `docs/plans/2026-06-23-001-feat-postbox-npm-autostart-plan.md` using serial TDD units with subagent RED/GREEN/REVIEW/VERIFY phases.

## Current state
- Status: U1-U6 verified PASS; running final full-change review/verification.
- Existing uncommitted planning/setup changes are intentional and should be preserved: `README.md`, `.pi/settings.json`, `CONTEXT.md`, ADR 0003, implementation plan.
- Global user Pi settings were repaired outside repo by filtering `git:github.com/dasomji/pi-postbox`; do not commit global settings.

## Units
1. U1 package metadata/tarball shape — PASS, dossier: `units/01-package-metadata-tarball.md`
2. U2 health-verified preferred server resolution — PASS, dossier: `units/02-health-verified-preferred-server.md`
3. U3 package-local server autostart supervisor — PASS, dossier: `units/03-package-local-autostart.md`
4. U4 status model, command, and read-only tool — PASS, dossier: `units/04-status-model-command-tool.md`
5. U5 user-only `/postbox` browser command — PASS, dossier: `units/05-postbox-browser-command.md`
6. U6 docs, ADR alignment, and smoke coverage — PASS, dossier: `units/06-docs-smoke.md`

## Next action
Run final full-change review and final verification.

## Decisions / constraints
- One writer at a time in the main worktree.
- Parent/orchestrator does not edit implementation/test files.
- Keep Pi package install docs distinct from shell CLI install docs.
- Do not undo `.pi/settings.json` unless intentionally changing dev setup.

## Cross-unit risks
- Packed package may miss runtime files.
- Internal workspace package imports may fail after package install if builds/exports are incomplete.
- Autostart must not leak browser-opening as an LLM tool.
- Status must not expose pending question contents.

## Preflight summary
- Project-agent-auditor found no blocking missing project capability and made no changes.
- Target roles can start; `smart_compact` available.
- MCP has no configured servers; acceptable.
- Browser/CDP evidence may be limited because Chrome/Chromium was not found in PATH; use CLI/API/package evidence fallback unless a browser becomes available.
- Repo root has no `AGENTS.md`/`CLAUDE.md`; rely on README, workspace instructions, plan, ADR, and orchestration dossiers.
- Next action: RED for U1 with `test-writer`.
