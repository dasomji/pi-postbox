# POSTBOX-1 plan: migrate pi-postbox onto the kitchen layout

Ticket: [POSTBOX-1](https://plane.audiopoesis.com/personal/projects/d4676922-3fa1-4877-8b0b-8ae49299b1c0/work-items/4bee77d6-d9dd-4ec9-ad31-e5e940d18897). Skill: kitchen `skills/migrate` (procedure) and `checklist.md` (report). Dry run: kitchen `research/32-migration-dry-run-pi-postbox.md` (2026-11-05). Review mode: **evidence**; Daniel reviews and merges. Signed off 2026-11-05.

Base: `origin/main` `1529347` (no `spec/POSTBOX-1` branch). Default branch `main`. Registered checkout `/home/dev/Development/pi-daniel/extensions/dashboard` (detached `a1f5940`) is not touched, and neither is shared clone config (`core.hooksPath` stays unset).

Version: one bump for the whole PR, `0.5.7` → `0.5.8`, owned by chunk B (root, `packages/{extension,server,protocol}`, `apps/web`, `package-lock.json`, version-pinned tests and `docs/protocol.md` release line). Protocol version unchanged unless a contract changes (it should not).

## Chunks

| Chunk | Outcome | Owned files | Depends on | Status |
|---|---|---|---|---|
| A · Contracts and knowledge | Lean `AGENTS.md` with the verified Plane block, `CLAUDE.md` = `@AGENTS.md`, `GLOSSARY.md` from `CONTEXT.md` (fixing the session-replacement and exact-fork holds), ADRs 0001–0004 kept plus any new extracted ADRs, `docs/out-of-scope/*`, `docs/agents/development.md` and `doors.md`, README/Android README drift fixed, retained product docs re-routed. Inventory of every work-scoped record, extraction, then retirement of 217 work records, `CONTEXT.md`, `IMPLEMENTATION_REPORT.md`, `docs/question-images-verification.md`; 14 evidence files uploaded via `evidence put` before removal; memory inspection; follow-up list for Plane. | `AGENTS.md`, `CLAUDE.md`, `GLOSSARY.md`, `CONTEXT.md`, `IMPLEMENTATION_REPORT.md`, `README.md`, `apps/android/README.md`, `docs/**` except `docs/agents/verify.md` and the `docs/protocol.md` release line, `docs/work/POSTBOX-1/report.md` | — | pending |
| B · Verification contract | Real `lint`, `check:fast`, `check:full`, `verify:app` scripts; `.githooks/pre-commit` + installer that never touches shared config without consent; protocol-discipline base handling for PR/main/staged; `ci.yml` on PRs **and** main running `check:full` with stable `validate`/`android` jobs; `.gitignore` for `.kitchen/` and local evidence; npm tarball excludes agent docs/work files; `docs/agents/verify.md`; version bump. `publish.yml` untouched unless review shows a need. | `package.json`, `apps/web/package.json`, `packages/*/package.json`, `package-lock.json`, `.githooks/**`, `scripts/**`, `.github/workflows/ci.yml`, `.gitignore`, lint/format config files, `docs/agents/verify.md`, version-pinned tests, tests for the new scripts | — (disjoint from A; runs in an isolated worktree, merged back here) | pending |
| C · Integration | Merge B into this branch, run docs/link lint over A's docs, fix routing, final ladder L1/L2/L3 at one SHA, L4 cross-family review, delete `docs/work/POSTBOX-1/`. | — (orchestrator coordinates; fixes go to the owning chunk's implementer) | A, B | pending |

## In-scope findings

(none yet)

## Follow-ups for Plane (beyond this ticket)

(collected from chunk reports; the orchestrator files them)
