# Unit 06 GREEN — Docs, smoke coverage, and operational diagnostics

## changedFiles

- `README.md` — updated quick-start/server config wording to preferred port `32187`, active-local role flag/env, config-base metadata paths, and explicit remote authority summary.
- `docs/configuration.md` — added active-local operator routing section covering path convention, role precedence, diagnostics, explicit remote authority, loopback recovery, live retargeting, and target affinity.
- `docs/deployment.md` — updated local/dev/lizardtail port guidance to `32187`, preserved manual Tailscale/lizardtail deployment guidance, and clarified Tailscale/hosted URLs are authoritative non-loopback targets rather than local recovery candidates.
- `docs/protocol.md` — documented optional `/healthz.localTarget`, exact active-local identity matching, and client routing compatibility.
- `scripts/smoke-postbox.mjs` — isolated smoke server writes with temp `PI_POSTBOX_CONFIG_DIR`/`PI_POSTBOX_CONFIG_PATH`, pins smoke role to `production`, and verifies `/healthz.localTarget` role/url/instance shape when present.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-green.md` — this GREEN evidence artifact.

## commandsRun

- `npm test -- packages/server/test/packageDocs.test.ts` — first GREEN attempt failed: docs were still missing exact lowercase `sent asks` concept.
- `npm test -- packages/server/test/packageDocs.test.ts` — passed after wording fix.
- `node --check scripts/smoke-postbox.mjs` — passed syntax check for smoke script edits.
- `npm test -- packages/server/test/packageDocs.test.ts && node --check scripts/smoke-postbox.mjs && git diff --cached --name-only` — final combined rerun passed; no staged files output.
- `grep` for stale `3000` examples in touched operator docs — passed/no matches.
- `git status --short && git diff -- ... --stat && git diff --cached --name-only` — inspected working tree and confirmed no staged files.

## validationOutput

```text
> npm test -- packages/server/test/packageDocs.test.ts

Test Files  1 passed (1)
Tests       6 passed (6)
```

```text
> node --check scripts/smoke-postbox.mjs
# no output (syntax OK)
```

```text
> grep stale 3000 patterns in README.md/docs/configuration.md/docs/deployment.md/docs/protocol.md
No matches found
```

```text
> git diff --cached --name-only
# no output
```

## residualRisks

- Full `npm run smoke` was not run because it requires a built packaged CLI/UI; the bounded syntax check was run instead.
- Working tree contains prior Unit 01-05 implementation changes and untracked orchestration artifacts outside this GREEN scope.
- Docs follow the Unit 06 contract and avoid documenting Unit 07 automatic Tailscale Serve/status as currently available.

## noStagedFiles

true — `git diff --cached --name-only` produced no output. No files were staged.
