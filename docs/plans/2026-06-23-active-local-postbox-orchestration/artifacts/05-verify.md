# Unit 05 VERIFY — Live client retargeting with target affinity

## PASS

Unit 05 is complete. Independent verification found the implementation satisfies the Unit 05 acceptance criteria, including the repaired local fallback resolution affinity release, without evidence of Unit 06/07/Tailscale/docs/status scope creep in the extension source/tests reviewed.

## requirementsChecked

- **Live active-local retarget hook installed only for eligible local sessions:** `packages/extension/src/index.ts` passes `resolveTarget`/`activeLocalPollingEnabled: true` only when the resolved target is polling eligible; `packages/extension/src/activeLocalTargetResolver.ts` marks `explicit-remote` targets with `activeLocalPollingEnabled: false`.
- **Connected safe retargeting:** `PostboxClient` stores `currentServerUrl`, polls `resolveTarget`, closes the old socket with reconnect suppression, updates the current target, reconnects, and re-registers the same session when no pinned work blocks the switch.
- **Reconnect from stale/dead local target resolves first:** reconnect scheduling calls `reconnectToResolvedTarget()`, which checks the active-local resolver before dialing again.
- **Explicit remote no-retarget:** explicit non-loopback targets do not receive the hook through startup and direct-client `activeLocalPollingEnabled: false` disables polling/reconnect retargeting.
- **Unsent ask follows new target:** unsent pending asks are not considered blocking and are sent only after the current target has moved.
- **Sent ask target affinity/no duplicate ask replay:** sent asks record `originServerUrl`; `sendPendingAsk()` refuses to send them to a different current target, and target changes defer while origin-pinned sent work exists.
- **Local fallback answer/cancel affinity:** local resolutions record `originServerUrl`, flush only when `originServerUrl === currentServerUrl`, and block switches to other targets while pending.
- **Bounded affinity release:** sent asks and local fallback resolutions both have target-affinity timers. The repaired local-resolution path reports `target-affinity-undeliverable`, clears the resolution, and retries deferred retargeting.
- **Deferred switch status/local fallback visibility:** deferred switches emit `target-switch-deferred:<url>` status and append the deferred-switch note to local fallback status while an ask is still pending.
- **Scope boundaries:** source/test grep found no Tailscale/status/docs/packageDocs changes under `packages/extension/src` or Unit 05 extension tests; broader working tree contains prior-unit/server/protocol/docs changes outside Unit 05.

## commandsRun

- `npm test -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts` — passed.
- `npm run typecheck -w @pi-postbox/extension` — passed.
- `npm test -- packages/extension/test` — passed.
- Source-inspection grep for target affinity, resolver hooks, explicit remote no-retarget, tests, and scope creep — passed on clean rerun. An earlier grep transcript had a harmless shell `printf` option error and was rerun with `echo` headings.
- `git diff --name-only && git ls-files --others --exclude-standard && git diff --cached --name-only` — passed; captured changed/untracked files and no staged files.

## validationOutput

Targeted Unit 05 plus resolver gate:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts

 Test Files  4 passed (4)
 Tests       33 passed (33)
 Duration    665ms
```

Extension typecheck:

```text
> @pi-postbox/extension@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

Full extension test sweep:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/extension/test

 Test Files  7 passed (7)
 Tests       44 passed (44)
 Duration    683ms
```

Source-inspection excerpts:

```text
packages/extension/src/client/PostboxClient.ts:364: if (pending.originServerUrl && pending.originServerUrl !== this.currentServerUrl) return false;
packages/extension/src/client/PostboxClient.ts:435-439: localResolutions flush only when originServerUrl matches currentServerUrl, then deleteLocalResolution()
packages/extension/src/client/PostboxClient.ts:469: void this.reconnectToResolvedTarget();
packages/extension/src/client/PostboxClient.ts:521-522: deferredTargetUrl set and target-switch-deferred emitted
packages/extension/src/client/PostboxClient.ts:553-556: sent asks and localResolutions block target switches when origin differs
packages/extension/src/client/PostboxClient.ts:598-608: local fallback resolution affinity timer clears undeliverable origin and retries deferred target
packages/extension/src/index.ts:155-158: resolveTarget hook passed only when target.activeLocalPollingEnabled
packages/extension/src/activeLocalTargetResolver.ts:61-63: explicit-remote target activeLocalPollingEnabled: false
```

Test coverage labels observed:

```text
resilience.test.ts: retargets a connected active-local client when the selected target changes and no work is pinned
resilience.test.ts: resolves the active-local target before reconnecting instead of redialing a stale local URL
resilience.test.ts: does not poll or retarget explicit remote clients toward fresh local targets
localFallback.test.ts: defers active-local switching while a sent ask is unresolved and never duplicates it to the new target
localFallback.test.ts: lets an unsent queued ask follow a target switch and sends it only to the new target
localFallback.test.ts: pins offline local fallback answers to their origin target before switching away
localFallback.test.ts: releases a permanently dead pinned origin after a client-owned deadline and then may retarget
localFallback.test.ts: releases an undeliverable offline local fallback resolution after the affinity deadline so retargeting can proceed
extension.test.ts: passes an active-local retarget resolver hook to eligible local Postbox clients
extension.test.ts: does not pass a retarget resolver hook for explicit remote Postbox clients
```

Changed/untracked file evidence relevant to Unit 05:

```text
packages/extension/src/client/PostboxClient.ts
packages/extension/src/index.ts
packages/extension/test/extension.test.ts
packages/extension/test/localFallback.test.ts
packages/extension/test/resilience.test.ts
packages/extension/src/activeLocalTargetResolver.ts
packages/extension/test/activeLocalTargetResolver.test.ts
```

No staged files evidence before writing this artifact:

```text
-- staged --
```

## evidenceArtifacts

- This verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/05-verify.md`
- CLI transcript evidence is embedded above. Browser/CDP evidence is unavailable and not applicable for this non-UI client state-machine unit.

## skippedGates

- Browser/CDP screenshots/video — not applicable; Unit 05 behavior is extension client/WebSocket/timer state-machine behavior, and project context says browser/CDP is unavailable.
- Full workspace `npm test` — not required for Unit 05 acceptance and previously documented as having unrelated docs/Tailscale expectation risk; full extension sweep was run instead.

## issuesFound

None blocking or actionable for Unit 05.

Non-blocking ledger note: `units/05-live-client-retargeting.md` still has `Status: not started` even though its latest-validation section says REREVIEW complete and VERIFY is running. Parent can update status after accepting this verification.

## residualRisks

- Target-affinity timeout defaults to 30s; product tuning may be needed, but bounded release behavior is implemented and covered.
- Resolver `status: unavailable` while an existing client reconnects is not heavily asserted in this unit; existing ask unavailable behavior remains generic. This did not block the explicit Unit 05 acceptance criteria verified here.
- Verification used fake WebSocket/resolver/timer tests, as intended by the unit safety constraints; no real Postbox server workflow was launched.

## noStagedFiles

true — `git diff --cached --name-only` produced no output before this artifact was written. No files were staged by verification.
