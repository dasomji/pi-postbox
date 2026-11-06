# POSTBOX-1 plan: migrate pi-postbox onto the kitchen layout

Ticket: [POSTBOX-1](https://plane.audiopoesis.com/personal/projects/d4676922-3fa1-4877-8b0b-8ae49299b1c0/work-items/4bee77d6-d9dd-4ec9-ad31-e5e940d18897). Skill: kitchen `skills/migrate` (procedure) and `checklist.md` (report). Dry run: kitchen `research/32-migration-dry-run-pi-postbox.md` (2026-11-05). Review mode: **evidence**; Daniel reviews and merges. Signed off 2026-11-05.

Base: `origin/main` `1529347` (no `spec/POSTBOX-1` branch). Default branch `main`. Registered checkout `/home/dev/Development/pi-daniel/extensions/dashboard` (detached `a1f5940`) is not touched, and neither is shared clone config (`core.hooksPath` stays unset).

Version: one bump for the whole PR, `0.5.7` → `0.5.8`, owned by chunk B (root, `packages/{extension,server,protocol}`, `apps/web`, `package-lock.json`, version-pinned tests and `docs/protocol.md` release line). Protocol version unchanged unless a contract changes (it should not).

## Chunks

| Chunk | Outcome | Owned files | Depends on | Status |
|---|---|---|---|---|
| A · Contracts and knowledge | Lean `AGENTS.md` with the verified Plane block, `CLAUDE.md` = `@AGENTS.md`, `GLOSSARY.md` from `CONTEXT.md` (fixing the session-replacement and exact-fork holds), ADRs 0001–0004 kept plus any new extracted ADRs, `docs/out-of-scope/*`, `docs/agents/development.md` and `doors.md`, README/Android README drift fixed, retained product docs re-routed. Inventory of every work-scoped record, extraction, then retirement of 217 work records, `CONTEXT.md`, `IMPLEMENTATION_REPORT.md`, `docs/question-images-verification.md`; 14 evidence files uploaded via `evidence put` before removal; memory inspection; follow-up list for Plane. | `AGENTS.md`, `CLAUDE.md`, `GLOSSARY.md`, `CONTEXT.md`, `IMPLEMENTATION_REPORT.md`, `README.md`, `apps/android/README.md`, `docs/**` except `docs/agents/verify.md` and the `docs/protocol.md` release line, `docs/work/POSTBOX-1/report.md` | — | done: 63d489c, af092e3, a16ce27 (232 retired, 11 kept, 0 uncertain; 14 evidence uploads ok) |
| B · Verification contract | Real `lint`, `check:fast`, `check:full`, `verify:app` scripts; `.githooks/pre-commit` + installer that never touches shared config without consent; protocol-discipline base handling for PR/main/staged; `ci.yml` on PRs **and** main running `check:full` with stable `validate`/`android` jobs; `.gitignore` for `.kitchen/` and local evidence; npm tarball excludes agent docs/work files; `docs/agents/verify.md`; version bump. `publish.yml` untouched unless review shows a need. | `package.json`, `apps/web/package.json`, `packages/*/package.json`, `package-lock.json`, `.githooks/**`, `scripts/**`, `.github/workflows/ci.yml`, `.gitignore`, lint/format config files, `docs/agents/verify.md`, version-pinned tests, tests for the new scripts | — (disjoint from A; runs in an isolated worktree, merged back here) | done: d16713d, f3583fe on t3/postbox-1-verify-contract; merged at acbffcb |
| C · Integration | Merge B into this branch, run docs/link lint over A's docs, fix routing, final ladder L1/L2/L3 at one SHA, L4 cross-family review, delete `docs/work/POSTBOX-1/`. | — (orchestrator coordinates; fixes go to the owning chunk's implementer) | A, B | in progress: ladder green at acbffcb (lint:docs, check:full 642 tests + Android, verify:app); L3 visuals at d850cee: browser journeys pass, outage journey FAIL (pre-existing, POSTBOX-5), Android BLOCKED (no KVM); L4 round 1: 2 process blockers, 5 should-fix, 3 nits; fix round 1 running |

## In-scope findings

- Host npm 12.2.0 breaks `packageDocs.test.ts` packaging cases (prepack output parsed as JSON); npm 11.15.0 (publish.yml) passes. check:full must pin or tolerate this (chunk B).
- Default-concurrency full suite flaked at af092e3: `packages/extension/test/resilience.test.ts:535`, `packages/server/test/completeAsyncLoop.test.ts:8` (teardown timeout). Byte-identical to main; isolated reruns and `--maxWorkers=4` pass. Integration must decide check:full worker policy and record the limit.
- Chunk B: `scripts/test-vitest.mjs` runs packaging/smoke files serially; verify.md pins npm 10.9.4 via `npm exec` on this npm 12 host. B also saw one reconnect test fail once, then pass on isolated and full reruns.
- Security: during chunk B, a diagnostic printed an npm credential into the child transcript. It is not in any repo file or commit (scanned). Daniel should rotate that npm token.

## Follow-ups for Plane (beyond this ticket)

- POSTBOX-2 native History and session metadata parity (F1)
- POSTBOX-3 cross-client and physical-device release evidence (F2)
- POSTBOX-4 GitHub backlog reconciliation (F3)
- POSTBOX-5 web UI shows Connected/Question resolved during server outage (pre-existing; found by L3)
- F4 deferred choices: no ticket (no signed requirement)

## Merge approval

2026-11-06, relayed by the kitchen orchestrator: Daniel said in chat "you still have merge-approval". The relay asks for G7 approval (npm publish on merge), and for this thread to merge once the G3 gates pass, followed by the G6 publish check. Conflict to resolve before merging: merge G8 and migrate step 7 say migration PRs always hand back in evidence mode and that G7 does not let the agent merge a migration PR.

Resolved 2026-11-06: Daniel wrote "I approve the merge" in this work thread. That is explicit approval for this thread to squash-merge the POSTBOX-1 migration PR, overriding G8's evidence-mode hand-back for this PR only. G3 technical gates still apply. A scope change beyond the signed-off ticket invalidates the approval.

## L4 rounds

- Round 1 (d850cee), cross-family: no code blockers.
  - Process blocker 1: an agent merge would make `auto-merge: enabled` effective without Daniel merging it. Resolution: Daniel merges this PR himself. L3 is red/blocked, so the PR goes to him anyway; if he wants an agent merge, he must explicitly cover the opt-in.
  - Process blocker 2: delete `docs/work/` before merge.
  - Should-fix: doors publish rule vs opt-in; no gate-weakening door; check:fast gaps for doc-reading tests, Android Vitest files and generated Kotlin; smoke stderr lost; main-push CI cancellation; npm token rotation (Daniel).
  - Nits: zero-SHA recovery path; name POSTBOX-2..5 in android.md; VAPID key storage fact lost from configuration.md.
