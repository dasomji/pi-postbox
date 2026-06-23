# Unit 04 REPAIR — Accepted reviewer findings

## changedFiles

- `packages/extension/src/activeLocalTargetResolver.ts`
  - Replaced prefix-based configured loopback detection with strict loopback authority handling.
  - DNS names such as `127.evil.example` remain explicit non-loopback targets; `localhost` is normalized to `127.0.0.1` for loopback-only probing.
- `packages/extension/src/index.ts`
  - Added a no-client active-local startup supervisor for unavailable local startup cases.
  - Supervisor polls with capped backoff, creates/registers a client once eligible active-local/configured-loopback target resolution succeeds, stops on session replacement/shutdown, and exits without retargeting when a client already exists.
- `packages/extension/test/activeLocalTargetResolver.test.ts`
  - Added regression coverage for `127.*` DNS hostname misclassification.
- `packages/extension/test/extension.test.ts`
  - Added fake-timer coverage for delayed active-local metadata startup recovery and deactivated supervisor cleanup.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/04-repair.md`
  - Repair evidence artifact.

## commandsRun

- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts`
  - Result: passed.
- `npm run typecheck -w @pi-postbox/extension`
  - Result: passed.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts && npm run typecheck -w @pi-postbox/extension`
  - Result: passed.
- `if [ -z "$(git diff --cached --name-only)" ]; then echo "no staged files"; else git diff --cached --name-only; fi`
  - Result: `no staged files`.

## validationOutput

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts

 Test Files  3 passed (3)
      Tests  18 passed (18)
```

```text
> @pi-postbox/extension@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
no staged files
```

## findingsAddressed

1. `isLoopbackHostname()` no longer uses `startsWith("127.")`; configured loopback recovery now requires protocol-safe metadata URL normalization or a strict configured loopback authority (`127.x.x.x`, `[::1]`, or `localhost` normalized to `127.0.0.1`). Added a regression test proving `http://127.evil.example:32187/` is preserved as `explicit-remote` and active-local health is not probed.
2. Added no-client active-local startup supervision. When initial resolution is unavailable, the extension schedules local polling with capped backoff, preserves sanitized unavailable rationale while waiting, registers a `PostboxClient` when eligible metadata appears, stops on deactivation/shutdown/session replacement, and checks for an existing client before each registration attempt so it does not retarget an already-connected client. Added fake-timer recovery and deactivation tests.

## residualRisks

- Supervisor polling is intentionally limited to no-client unavailable startup paths; it does not implement Unit 05 live retargeting or target affinity.
- Existing module-global client lifecycle behavior outside the accepted findings was not broadly refactored.

## noStagedFiles

`git diff --cached --name-only` produced no output (`no staged files`). No files are staged.
