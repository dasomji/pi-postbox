# Unit 06 RED — Docs, smoke coverage, and operational diagnostics

## changedFiles

- `packages/server/test/packageDocs.test.ts` — refreshed package/operator docs assertions and added active-local/smoke isolation expectations.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-red.md` — this RED evidence artifact.

## testsAddedOrUpdated

- Updated `release packaging and operator docs > documents configuration, deployment boundary, endpoints, and manual smoke testing`:
  - Keeps existing package/operator baseline coverage.
  - Removes the stale exact `lizardtail postbox` command expectation while still requiring manual `lizardtail` guidance.
- Added `release packaging and operator docs > documents active-local routing, role configuration, and local diagnostics for operators`:
  - Requires docs to mention preferred port `32187`, `--active-local-role`, `PI_POSTBOX_ACTIVE_LOCAL_ROLE`, `active-local/dev.json`, `active-local/production.json`, config-base inputs, dev-over-production / production fallback, stale/unhealthy/unsafe/health-mismatch diagnostics, no broad discovery, and no port scanning.
  - Rejects stale operator wording that still describes `3000` as the preferred/default port.
- Added `release packaging and operator docs > documents explicit remote authority plus live retargeting and origin affinity`:
  - Requires docs to explain explicit non-loopback `PI_POSTBOX_URL` / Tailscale / hosted URLs remain authoritative and are not local recovery candidates, plus live retargeting, sent ask/local fallback origin pinning, bounded release, and deferred switching.
- Added `release packaging and operator docs > documents optional health local target identity and exact metadata matching`:
  - Requires protocol docs to mention optional `/healthz.localTarget` and exact active-local identity matching.
- Added `release packaging and operator docs > keeps the release smoke isolated from operator config and compatible with active-local health`:
  - Requires `scripts/smoke-postbox.mjs` to set `PI_POSTBOX_CONFIG_DIR` to its temp directory and inspect active-local health identity fields when present.

## commandsRun

- `npm test -- packages/server/test/packageDocs.test.ts` — failed as expected; initial full failure output was large and confirmed the same missing docs/smoke concepts.
- `npm test -- packages/server/test/packageDocs.test.ts --reporter=dot` — failed as expected; used for final RED evidence.
- `grep -E "FAIL  packages/server/test/packageDocs.test.ts|AssertionError:|Tests  |Test Files" /tmp/pi-bash-004f7595a1b30888.log` — extracted concise failure summary.
- `git status --short && git diff -- packages/server/test/packageDocs.test.ts && git diff --cached --name-only` — inspected changed files and confirmed no staged files.

## validationOutput

Targeted RED command summary:

```text
FAIL  packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents active-local routing, role configuration, and local diagnostics for operators
AssertionError: expected docs/script to mention 32187: expected '# Pi Postbox\n\nPi Postbox is a Pi ex…' to contain '32187'

FAIL  packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents explicit remote authority plus live retargeting and origin affinity
AssertionError: expected docs/script to mention explicit non-loopback: expected '# Pi Postbox\n\nPi Postbox is a Pi ex…' to contain 'explicit non-loopback'

FAIL  packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents optional health local target identity and exact metadata matching
AssertionError: expected docs/script to mention localTarget: expected '# Pi Postbox protocol overview\n\nAll…' to contain 'localTarget'

FAIL  packages/server/test/packageDocs.test.ts > release packaging and operator docs > keeps the release smoke isolated from operator config and compatible with active-local health
AssertionError: smoke must force active-local/config/machine-id writes into its temp directory: expected '#!/usr/bin/env node\nimport { spawn }…' to contain 'PI_POSTBOX_CONFIG_DIR'

Test Files  1 failed (1)
Tests  4 failed | 2 passed (6)
```

No staged files check:

```text
git diff --cached --name-only
# no output
```

## failureReasonTiedToMissingBehavior

The failures prove the Unit 06 behavior is still missing from operator-facing public surfaces:

- Current docs still describe the old local port guidance (`3000`) and do not document the active-local role files, role flag/env, precedence/fallback rules, config-base convention, or operational diagnostic categories.
- Current docs do not explain explicit non-loopback remote authority, Tailscale/hosted URLs as non-recovery candidates, or live retargeting/origin-affinity behavior.
- Current protocol docs do not document optional `/healthz.localTarget` or the exact identity match required for active-local metadata candidates.
- Current smoke script starts the CLI with a temp database only; it does not set `PI_POSTBOX_CONFIG_DIR` to isolate active-local/config/machine-id writes from the real operator config and does not inspect `localTarget` health identity fields.

## residualRisks

- The docs expectations intentionally use concept substrings rather than exact prose, but some phrases (`dev over production`, `not local recovery candidates`, `pin their origin`) still encode the contract language from the Unit 06 prompt. GREEN can satisfy them with concise operator wording.
- This RED phase used static smoke-script assertions via `packageDocs.test.ts`; it does not execute `npm run smoke` or spawn a server.
- The working tree already contains prior Unit 01-05 changes and untracked orchestration artifacts; this RED phase only changed `packages/server/test/packageDocs.test.ts` and wrote this artifact.

## noStagedFiles

true — `git diff --cached --name-only` produced no output. No files were staged.
