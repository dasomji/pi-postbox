# POSTBOX-7 plan: single-user merge marker in doors.md

Ticket: POSTBOX-7 (Plane `personal`). Review mode: evidence. Base: `origin/main` at
`f0828fee7e73e01ae64b83b8fcf6b3069e9d4c06`. Blockers POSTBOX-1 and KITCHEN-27 are Done.

## Merge constraint (binding)

Scope change 2026-11-07: pi-postbox publishes to npm on every push to `main`, so
every pi-postbox merge needs Daniel's per-PR G7 approval, even with the marker.
This PR also changes doors.md markers (merge authority), which always needs
per-PR G7 approval. The agent does not merge without that recorded approval, and
the marker never governs this PR.

## Chunk 1: doors.md marker and repo version bump (implementer, one owner)

Outcome:
- `docs/agents/doors.md`: replace the retired `## Pilot opt-in` /
  `auto-merge: enabled` section with the exact line `single-user: rollback-ok`,
  a `rollback:` line, the "main publishes on push" statement, and the per-PR
  approval rule while publishing is automatic. Keep every forced one-way row.
- Repository version 0.5.10 -> 0.5.11 across root, workspaces, lockfile metadata
  and the version-mirroring files (AGENTS.md rule; ticket says "change only that
  file", but the repo's mandatory bump rule applies to every change).

Owned files: `docs/agents/doors.md`, version files listed by
`git grep 0.5.10` plus `package-lock.json`.

Status: done in `13ec874f8ab97055e02da152d1ff3012e31dea04` (Codex gpt-6.1-sol). L1 199 s,
L2 465 s (first attempt hit a 5 s Vitest timeout in image staging under load; rerun
unchanged passed), L3 37 s reporting 0.5.11, `npm pack --dry-run` whitelist clean.
Mutation proof skipped: docs + version metadata, no behavior seam.

## Verification

- L1 `npm run check:fast` (staged), L2 `npm run check:full -- --base origin/main`.
- L3 `npm run verify:app` (Coolify) because the version bump changes runtime identity.
- Cross-family L4 + door confirmation: author is Codex, so the reviewer is
  Claude (roles.toml reviewer-of-gpt-code). Status: in progress.

## Findings

(none yet)
