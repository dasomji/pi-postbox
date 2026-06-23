# Unit 04 GREEN — Extension target resolver and initial selection

## changedFiles

- `packages/extension/src/activeLocalTargetResolver.ts` (new resolver seam for active-local startup target selection)
- `packages/extension/src/index.ts` (startup now uses resolved target URL and surfaces sanitized unavailable rationale)
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/04-green.md` (this artifact)

## commandsRun

- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts`
  - Result: passed.
- `npm run typecheck -w @pi-postbox/extension`
  - Result: passed.
- `git diff --cached --name-only`
  - Result: no staged files.

## validationOutput

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts

 Test Files  3 passed (3)
      Tests  15 passed (15)
```

```text
> @pi-postbox/extension@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

## residualRisks

- Resolver default freshness window is intentionally permissive because startup also requires a successful bounded `/healthz` check with exact active-local identity for metadata targets; explicit resolver tests still exercise staleness with a supplied TTL.
- This implements initial/no-client target selection only. It does not retarget an already connected client, add pending-ask target affinity, or add Tailscale Serve/status behavior.

## noStagedFiles

`git diff --cached --name-only` produced no output. No files are staged.
