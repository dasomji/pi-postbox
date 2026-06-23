# Unit 05 REPAIR — Local fallback resolution affinity release

## changedFiles

- `packages/extension/src/client/PostboxClient.ts`
- `packages/extension/test/localFallback.test.ts`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/05-repair.md`

## commandsRun

- `npm test -- packages/extension/test/localFallback.test.ts` — failed before implementation with the new RED coverage, then passed after implementation.
- `npm test -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts` — passed.
- `npm run typecheck -w @pi-postbox/extension` — passed.
- `npm test -- packages/extension/test` — passed.
- `git diff -- packages/extension/src/client/PostboxClient.ts packages/extension/test/localFallback.test.ts && git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — passed inspection; no staged files.

## validationOutput

```text
> vitest run packages/extension/test/localFallback.test.ts

Test Files  1 failed (1)
Tests       1 failed | 7 passed (8)

FAIL packages/extension/test/localFallback.test.ts > local Postbox fallback > releases an undeliverable offline local fallback resolution after the affinity deadline so retargeting can proceed
AssertionError: expected false to be true
```

```text
> vitest run packages/extension/test/localFallback.test.ts

Test Files  1 passed (1)
Tests       8 passed (8)
```

```text
> vitest run packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts

Test Files  3 passed (3)
Tests       25 passed (25)
```

```text
> @pi-postbox/extension@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
> vitest run packages/extension/test

Test Files  7 passed (7)
Tests       44 passed (44)
```

```text
-- staged --
```

## findingsAddressed

- Addressed the accepted reviewer finding that origin-pinned `localResolutions` could block active-local retargeting forever.
- Local fallback answer/cancel resolutions now get a bounded target-affinity timer when their origin is disconnected or when they block a target switch.
- If the origin remains unavailable past `targetAffinityTimeoutMs`, the local resolution is cleared, an undeliverable status is reported via `onStatus`, and deferred retargeting is retried.
- Successful origin flush and client stop now clear local-resolution affinity timers.
- Added focused regression coverage for the gap: offline local fallback resolution defers a switch, does not flush to the wrong target, reports undeliverable at the deadline, and then retargets.

## residualRisks

- The local ask promise is already resolved when a local fallback answer/cancel is recorded, so undeliverable reporting for the later failed origin flush is surfaced through `onStatus` rather than by changing the original ask result.
- The working tree contains pre-existing unstaged Unit 01-05/other planning changes outside this repair scope; this repair did not stage files.

## noStagedFiles

`git diff --cached --name-only` produced no output. No files are staged.
