# Unit 05 RED — Live client retargeting with target affinity

## changedFiles

- `packages/extension/test/resilience.test.ts`
- `packages/extension/test/localFallback.test.ts`
- `packages/extension/test/extension.test.ts`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/05-red.md`

Note: the working tree already contained prior Unit 01-04/doc changes before this RED pass. No production files were edited for Unit 05 RED.

## testsAddedOrUpdated

- `packages/extension/test/resilience.test.ts`
  - Added `retargets a connected active-local client when the selected target changes and no work is pinned`.
    - Asserts an active-local client connected to production closes the old socket, opens the newly resolved dev socket, and sends exactly one `session.register` preserving the semantic session identity.
  - Added `resolves the active-local target before reconnecting instead of redialing a stale local URL`.
    - Asserts reconnect resolves the current active-local target and dials the restarted URL instead of the stale original URL.
  - Added `does not poll or retarget explicit remote clients toward fresh local targets`.
    - Asserts remote clients with active-local polling disabled do not call the resolver and remain on the explicit remote URL.
- `packages/extension/test/localFallback.test.ts`
  - Added `defers active-local switching while a sent ask is unresolved and never duplicates it to the new target`.
    - Asserts sent asks pin their origin target, expose deferred status/local fallback status, avoid duplicate `ask.create` on the new target, then allow retargeting after origin resolution.
  - Added `lets an unsent queued ask follow a target switch and sends it only to the new target`.
    - Asserts an unsent ask may move to the new active target and is created only there.
  - Added `pins offline local fallback answers to their origin target before switching away`.
    - Asserts local fallback resolutions flush to their origin target, switching is deferred while pending, and retargeting can proceed after the flush.
  - Added `releases a permanently dead pinned origin after a client-owned deadline and then may retarget`.
    - Asserts a dead origin does not pin forever: the ask resolves unavailable/undeliverable after a bounded deadline and the client can retarget.
- `packages/extension/test/extension.test.ts`
  - Added `passes an active-local retarget resolver hook to eligible local Postbox clients`.
    - Asserts `startRegistration` passes a callable `resolveTarget` hook to `PostboxClient` for active-local eligible selections and that the hook resolves through active-local metadata.
  - Added `does not pass a retarget resolver hook for explicit remote Postbox clients`.
    - Asserts explicit remote clients receive no live retarget hook.

## commandsRun

- `npm test -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts` — failed as expected for RED.
- `git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — passed; showed no staged files.

## validationOutput

```text
> vitest run packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts

Test Files  3 failed (3)
Tests       7 failed | 17 passed (24)
```

Failure excerpts:

```text
packages/extension/test/resilience.test.ts > retargets a connected active-local client when the selected target changes and no work is pinned
AssertionError: expected 1 to be 3
Expected old production socket to be CLOSED after target switch; received OPEN.
```

```text
packages/extension/test/resilience.test.ts > resolves the active-local target before reconnecting instead of redialing a stale local URL
Expected: "ws://127.0.0.1:32188/api/extension/ws"
Received: "ws://127.0.0.1:32187/api/extension/ws"
```

```text
packages/extension/test/localFallback.test.ts > defers active-local switching while a sent ask is unresolved and never duplicates it to the new target
AssertionError: expected deferred-switch status containing "3500"; received no deferred status.
```

```text
packages/extension/test/localFallback.test.ts > lets an unsent queued ask follow a target switch and sends it only to the new target
Expected: "ws://127.0.0.1:3500/api/extension/ws"
Received: "ws://127.0.0.1:32187/api/extension/ws"
```

```text
packages/extension/test/localFallback.test.ts > pins offline local fallback answers to their origin target before switching away
AssertionError: expected deferred-switch status containing "3500"; received no deferred status.
```

```text
packages/extension/test/localFallback.test.ts > releases a permanently dead pinned origin after a client-owned deadline and then may retarget
AssertionError: expected unavailable result for ask-dead-origin; received undefined because sent asks currently remain pending indefinitely when the origin is dead.
```

```text
packages/extension/test/extension.test.ts > passes an active-local retarget resolver hook to eligible local Postbox clients
AssertionError: expected undefined to deeply equal Any<Function>
```

No staged files check:

```text
-- staged --
```

## failureReasonTiedToMissingBehavior

The failures tie directly to Unit 05 missing behavior:

- `PostboxClient` still treats `serverUrl` as immutable and does not consume a live active-local resolver/poll hook, so connected clients do not close/re-register on newly selected targets.
- Reconnect still dials the original URL instead of resolving the current active-local target first.
- Sent asks and local fallback resolutions have no origin-target affinity/deferred-switch status, so tests cannot observe deferred switching while pinned work exists.
- Sent asks with no explicit expiry have no client-owned pin deadline, so a permanently dead origin can leave the ask unresolved forever.
- `startRegistration` constructs `PostboxClient` with only `serverUrl` and callbacks; it does not pass the active-local resolver hook for eligible local selections.

## residualRisks

- The tests intentionally introduce a candidate public client seam named `resolveTarget` plus timing options (`activeLocalPollMs`, `targetAffinityTimeoutMs`). GREEN may choose equivalent names only if the tests are updated to preserve the same public behavior.
- One explicit-remote no-retarget test passes under the current immutable-URL implementation; it is a regression guard for the GREEN implementation rather than a RED failure.
- Full workspace tests/typecheck were not run in RED; targeted Unit 05 tests are sufficient to demonstrate missing behavior.

## noStagedFiles

`git diff --cached --name-only` produced no output. No files were staged.
