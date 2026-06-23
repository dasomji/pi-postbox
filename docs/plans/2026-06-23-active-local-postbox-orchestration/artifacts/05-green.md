# Unit 05 GREEN — Live client retargeting with target affinity

## changedFiles

- `packages/extension/src/client/PostboxClient.ts`
- `packages/extension/src/index.ts`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/05-green.md`

## commandsRun

- `npm test -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts` — passed.
- `npm run typecheck -w @pi-postbox/extension` — passed.
- `npm test -- packages/extension/test` — passed.
- `git diff -- packages/extension/src/client/PostboxClient.ts packages/extension/src/index.ts && git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — passed inspection; no staged files.

## validationOutput

```text
> vitest run packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts

Test Files  3 passed (3)
Tests       24 passed (24)
```

```text
> @pi-postbox/extension@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
> vitest run packages/extension/test

Test Files  7 passed (7)
Tests       43 passed (43)
```

Implementation notes:

- `PostboxClient` now accepts an optional active-local `resolveTarget` hook, polling interval, and target-affinity timeout.
- Connected active-local clients retarget by closing the old socket and registering on the newly selected target when no pinned work blocks the switch.
- Reconnect attempts resolve the current active-local target before dialing, while explicit remote clients can disable polling/retargeting with `activeLocalPollingEnabled: false`.
- Sent asks and local fallback resolutions record their origin target and are not replayed/flushed to a different runtime; target switches are deferred while origin-pinned work remains.
- Sent pinned asks get a bounded client-owned deadline that resolves unavailable/undeliverable and then permits a deferred target switch.
- Startup passes the retarget resolver hook only for targets with `activeLocalPollingEnabled`.

## residualRisks

- Target-affinity timeout defaults to 30s for sent pinned asks once their origin disconnects or a target switch is deferred; this is intentionally bounded but may need product tuning.
- Local fallback resolutions remain origin-pinned and are flushed only to origin; this GREEN does not add a separate user-visible undeliverable result for already-local-resolved fallback flushes.

## noStagedFiles

`git diff --cached --name-only` produced no output during validation. No files were staged.
