# Unit 05 — Live client retargeting with target affinity

Status: complete

Parent source plan unit: U5 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: make already-running local Pi sessions follow active-local target changes when safe, while preserving correctness for sent asks and local fallback resolutions through target affinity.

Acceptance criteria:
- `PostboxClient` can receive a target resolver/poll hook for active-local eligible sessions and can update its current target when the selected instance changes.
- Explicit non-loopback selections from Unit 04 remain strict: no active-local polling/retargeting is installed for those sessions, including during reconnect or remote outage.
- While connected to one active-local target and no work is pinned, a newly selected target causes the client to close the old socket, connect to the new target, and send `session.register` to the new target with the same semantic session identity.
- During reconnect from a stale/dead local target, the next connection attempt resolves the current active-local target and uses the new URL instead of repeatedly dialing the stale URL.
- Unsent asks may follow the newly selected target because no remote card exists yet.
- Sent asks are pinned to the target where `ask.create` was sent. If the active target changes while a sent ask is unresolved, switching is deferred and the ask is not duplicated on the new target.
- Local fallback answer/cancel resolutions are pinned to their origin target and are flushed only to that origin target; switching is deferred while such a resolution is pending.
- Pinned work has a bounded client-owned deadline/timeout so a permanently dead origin cannot block convergence forever; when released, the client reports an unavailable/undeliverable diagnostic and can retarget.
- Deferred-switch status is surfaced in client status/local fallback status enough for users/tests to distinguish that an active target changed but switching is waiting on pinned work.
- Local fallback commands/status remain visible while switching is deferred.
- This unit does not change server metadata publication, resolver startup selection, docs/status command, Tailscale Serve, or dev launcher behavior.

Non-goals:
- Do not implement Tailscale Serve/status or docs/packageDocs updates.
- Do not change active-local metadata schema or server publication semantics unless required by compile/test compatibility.
- Do not introduce semantic session replacement behavior; retargeting is transport reconnect/re-registration per ADR 0001.
- Do not duplicate sent asks or local fallback resolutions across independent server runtimes in v1.
- Do not broaden no-client startup supervisor beyond Unit 04 behavior except to pass resolver/poll hooks into new clients.

Likely files/surfaces:
- Modify: `packages/extension/src/client/PostboxClient.ts`
- Modify: `packages/extension/src/index.ts`
- Possibly modify: `packages/extension/src/activeLocalTargetResolver.ts` for a small type/export used by the client hook
- Test: `packages/extension/test/resilience.test.ts`
- Test: `packages/extension/test/localFallback.test.ts`
- Possibly test: `packages/extension/test/extension.test.ts` if startup must pass resolver hooks to the client

Relevant existing code:
- `packages/extension/src/client/PostboxClient.ts` owns WebSocket lifecycle, reconnect timers/backoff, pending ask replay, local fallback status, local answer/cancel resolution flushing, and unavailable timers.
- `packages/extension/src/index.ts` constructs `PostboxClient` after Unit 04 resolution. It should pass a resolver/poll hook only when the selected target is active-local eligible (`activeLocalPollingEnabled`), not for explicit remote targets.
- `packages/extension/src/activeLocalTargetResolver.ts` returns Unit 04 resolution status/source/target/diagnostics and marks polling eligibility.
- `docs/adr/0001-pi-session-replacement-lifecycle.md` establishes that transport reconnect/re-registration is not a semantic session replacement.

Targeted validation commands for role agents:
- `npm test -- packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts`
- `npm run typecheck -w @pi-postbox/extension`
- Consider full extension test sweep `npm test -- packages/extension/test` if safe after GREEN/VERIFY.

Safety constraints:
- Parent coordinator must not run validation directly; role agents run validation.
- Use fake WebSocket implementations and fake resolvers/timers; do not launch real Postbox servers.
- Avoid real long sleeps; use fake timers where possible.
- Keep assertions focused on message routing, socket URLs, duplicate prevention, and status diagnostics rather than exact prose.

Suggested RED focus:
- Connected production/local target -> resolver later returns dev -> with no pinned work, client closes old socket, connects to dev, and registers once on dev.
- Disconnected/stale local target -> reconnect attempt resolves new production/dev URL and registers there.
- Explicit remote client created without polling hook -> fresh local target from resolver is ignored/no retarget occurs.
- Sent ask on production -> dev becomes active -> client stays pinned to production, does not send `ask.create` to dev, and status indicates deferred switching. After production resolves the ask, client can retarget on next check.
- Queued/unsent ask before target switch -> ask sends only to the new target after retarget, not the old target.
- Local fallback answer/cancel for origin target -> resolution flushes to origin before switch or defers switch until released.
- Permanently dead origin with sent ask/no explicit `expiresAt` -> bounded pin deadline releases with unavailable/undeliverable diagnostic and permits retargeting.
- Existing local fallback status remains visible while switch is deferred.

Phase artifacts:
- RED: `../artifacts/05-red.md`
- GREEN: `../artifacts/05-green.md`
- REVIEW: `../artifacts/05-review.md`
- REPAIR: `../artifacts/05-repair.md` if needed
- VERIFY: `../artifacts/05-verify.md`

Current phase: complete.

Latest validation: VERIFY passed. Targeted Unit 05/resolver tests, extension typecheck, full extension test sweep, and source/grep inspection passed. See `../artifacts/05-verify.md`.

Risks:
- This is the highest-risk client state-machine unit. Keep tests behavioral and small; prefer multiple focused cases over one enormous scenario.
- Pending ask replay currently assumes a single immutable `serverUrl`; retargeting must not accidentally replay sent asks to a different server.
- Timer/backoff interactions can become flaky. Use fake timers and explicit hooks/test seams.
- No-client supervisor from Unit 04 should not race with live retargeting; live retargeting belongs inside/through `PostboxClient` once a client exists.
- Broad `npm test` may still have unrelated docs/Tailscale expectation failures; use targeted extension gates for unit acceptance unless changed surfaces require more.
