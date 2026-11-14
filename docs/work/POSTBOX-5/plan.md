# POSTBOX-5 plan: outage-safe web connection state

Ticket: https://plane.audiopoesis.com/personal/projects/d4676922-3fa1-4877-8b0b-8ae49299b1c0/work-items/7acf669d-6a40-4d8a-bc26-d5011dbaa58a
Review mode: evidence (Opus reviews GPT code). Merge publishes to npm: hand back merge-ready; Daniel merges.
Base: origin/main f0828fe.

## Chunk A: web outage behaviour, test and verify:app journey (owner: implementer, codex gpt-6.1-sol)

Outcome:
- While the server is unreachable the connection indicator leaves "Connected" within the reconnect timeout.
- Pending Questions stay shown as pending (or unknown/stale), never "Question resolved".
- Answer controls show that a submission cannot be delivered while offline.
- Restart recovery is unchanged.
- Web test(s) plus an outage step in the `verify:app` journey cover it; regression proofs recorded.
- Android client checked for the same behaviour: fix if in scope and small, otherwise record and file a follow-up.
- Version bump across root, workspaces and lockfile.

Owned files: `apps/web/src/**`, `scripts/smoke-postbox.mjs` / `scripts/test/**` (journey), `apps/android/**` (only if needed), manifests + `package-lock.json`, `docs/agents/verify.md` (cited claims only).

Blocks/dependencies: none.

Status: in progress.

## Findings

(none yet)
