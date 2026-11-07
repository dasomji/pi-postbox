# Compact reads with explicit concurrency

## Status

Accepted; extracted from implemented output reductions and subsequent pagination
limits. Older rich-context defaults were later removed; this ADR preserves only
still-current decisions, not the historical batch-context language.

## Decision and trade-off

Default model-facing reads return bounded control records, compact Answers and
initial-snapshot-plus-section-delta history. Full immutable detail remains explicit
through `view: "full"`. Owner discovery derives feature/worktree/repository scope
from the caller and exposes identity, presence and counts rather than transcripts,
paths or Question contents. Unresolved `get_answer` returns a typed pending result;
waiting is the separate explicit `wait_for_postbox` operation.

Keep `expectedRevision` and `expectedOwnerRevision` explicit on writes rather than
replacing them with an opaque concurrency token. They protect different changes
and make stale ownership/content failures inspectable. Keep compact stateless,
query-bound keyset cursors rather than short server-held handles, so pagination
survives restarts and avoids a new expiring server cache. Copy cursors unchanged
with the same query; clients must follow finite pages rather than request all data.

This reduces repeated model context while preserving full forensic data and
restart behavior. It costs explicit projection/pagination handling in clients;
compact history is derived at read time and never replaces stored revisions.

## Evidence and lineage

Implemented by [RequestStore](../../packages/server/src/services/requestStore.ts),
[pagination cursors](../../packages/server/src/services/paginationCursor.ts) and
[owner discovery](../../packages/server/src/services/sessionStore.ts), with
[output reduction](../../packages/server/test/outputReductionTransport.test.ts),
[discovery](../../packages/server/test/questionDiscovery.test.ts) and
[ownership](../../packages/server/test/ownershipTransfer.test.ts) regressions.
The [historical reduction plan](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/plans/2026-08-15-postbox-output-reductions/index.md)
and [comparison](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/audits/2026-08-15-postbox-verbose-output-reduction.html)
record the alternatives and their restart/specification costs. Current wire limits
and semantics remain in [protocol.md](../protocol.md).
