# Pi Postbox architecture live-tool test

Date: 2026-08-15

## Executive summary

The complete agent-facing Pi Postbox tool surface was exercised against a freshly rebuilt and restarted development server. The redesign is substantially healthier than the stale-server behavior first observed: `get_answer` no longer hangs on a cancelled, superseded, missing, pending, or wrong-owner Question; ownership revisions are available; ordered batch mappings are usable; and a real `wait_for_postbox` call woke correctly when an Answer arrived.

Two current behavioral defects were found in `list_question_status`, one misleading first-read result was found in recovery reads, and several contracts remain more verbose or discovery-heavy than necessary. The largest architectural risk is still build compatibility: the development `buildId` identifies only the checkout, while `protocolVersion` remained `0.1.0` across a schema redesign. A connected extension can therefore advertise a newer schema to the model while an older long-running server rejects it, with no compatibility guard catching the mismatch.

## Environment and freshness

Initial process inspection found:

- Server PID `1175038` started at 00:24 UTC.
- The redesign commits and rebuilt backend landed between 02:25 and 04:26 UTC.
- The loaded extension advertised `scope`, while the old in-memory server rejected it as an unknown field.
- `/healthz` still reported `version: 0.1.0`, `protocolVersion: 0.1.0`, and `buildId: dev-79522f2660390417`; none identified that stale process.

The checkout-scoped dev launcher was stopped, the protocol/server were rebuilt, and a fresh server was started on `127.0.0.1:41657`. The extension reconnected and `postbox_status` returned connected before the second test run.

Package versions were inconsistent before this audit (`@pi-postbox/web` was `0.1.1`; the root, server, protocol, and extension were `0.1.0`). They were synchronized to `0.1.2`. Project development instructions were added in `AGENTS.md` to require version updates and freshness verification.

A final full build and restart exposed an additional identity defect: although all package manifests and the lockfile said `0.1.2`, `/healthz` still said `version: 0.1.0`. The CLI never passes an application version to `createPostboxApp`, so health falls back to `PROTOCOL_VERSION`. The process was demonstrably fresh (new launcher/server process after the build), but the required exact version proof cannot currently be obtained from health.

## Tool coverage

| Tool / surface | Result | Evidence |
| --- | --- | --- |
| `postbox_status` | Pass, architecture caveat | Reported connectivity, URLs, profile, owner-scoped count, and diagnostics without question content. It cannot prove exact code freshness because build identity is checkout-static. |
| `ask_postbox` single | Pass | Created `postbox-architecture-answer-wait-v2`. |
| `ask_postbox` multi | Pass | Batch child persisted with `mode: multi`. |
| `ask_postbox` ordered batch | Pass | Returned ordered `localRef` → `questionId`, revision, and disposition mappings for five Questions. Local-reference parenting persisted correctly. |
| `get_answer` | Pass in current build; response caveat | Pending returned `Answer not found`; missing returned `Question not found`; wrong owner returned `Reader does not own this Question`; cancelled and superseded returned immediate structured lifecycle results; answered returned the Answer. No call became stuck. |
| `list_questions` | Pass, ergonomics caveats | Owner, feature, worktree, repository, global, status, page size, and cursor paths worked. Scope identifiers are under-specified and cursors are large. |
| `get_questions` | Pass | Returned complete details, `ownerRevision`, parent ID, Answer metadata, and preserved requested order. |
| `list_question_status` | **Fail for advertised filter combinations** | `status: answered` plus `readState: unread` returned a read Answer. `includeTerminal` is accepted but ignored by the implementation. |
| `get_postbox_owner_status` | Pass | Distinguished live and offline owners and returned active/unread counts. |
| `update_question: revise` | Pass, replacement-semantics caveat | Revision increased. Supplying only `question.prompt` removed the previous question context/relevance/impact while preserving separately stored options and handoff context. |
| `update_question: reparent` | Pass | Parent changed and immutable history recorded `parent_changed`. |
| `update_question: cancel` | Pass | Revision increased; `get_answer` returned lifecycle-only cancellation without Answer metadata. |
| `update_question: supersede` | Pass | Revision increased; replacement ID appeared in details, history, and immediate lifecycle result. |
| `update_question: transfer` | Pass | Ownership changed, `ownerRevision` increased independently, and history recorded the transfer. A nonexistent owner failed clearly. |
| `update_question: takeover` | Pass | Takeover from an existing offline owner succeeded and incremented `ownerRevision`. |
| `get_question_history` | Pass, context-cost caveat | Revisions, parent changes, ownership changes, terminal events, and actors were immutable and complete. Full snapshots repeat substantial content. |
| `recover_question_answer` | Pass, first-read defect | Recovered an offline owner's Answer without ownership transfer, but reported `alreadyRead: true` on the first recovery read. |
| `wait_for_postbox` | Pass | A live wait blocked, an Answer was submitted two seconds later through the documented local HTTP endpoint, and the wait woke with the full Answer and `alreadyRead: false`. |

Synthetic test Questions were answered, superseded, or cancelled. The current owner ended with zero open test Questions.

## Findings

### P1 — Exact server/extension compatibility and package build identity are not enforced

The initial failure was a genuine mixed-version runtime: the extension's registered tool schema accepted `scope`, but the long-running server rejected it. `/healthz` could not distinguish the stale server because:

- package `version` had not changed;
- `protocolVersion` remained `0.1.0` across the redesign; and
- development `buildId` was derived only from the checkout path.

The final verification made the contract problem even clearer. After synchronizing every package to `0.1.2`, running a full build, and restarting, health still returned `version: 0.1.0`. `runCli` does not pass `version` into `createPostboxApp`; `createHealthResponse` therefore defaults both application version and protocol version to `PROTOCOL_VERSION`. The advertised `version` is not the running package version.

**Recommendation:** Wire the server package version into health separately from `protocolVersion`. Include an exact protocol-schema fingerprint and executable build fingerprint in registration and health. Reject or clearly degrade incompatible extension/server pairs before tools are exposed. For development builds, include the Git commit plus dirty-tree/build-content digest and process start/build time. Increment the protocol identity for incompatible schema changes. Version discipline is useful, but should not be the only compatibility mechanism.

### P1 — `list_question_status` does not honor all advertised filters

Two live behaviors were confirmed and match the current implementation in `RequestStore.listQuestionStatus`:

1. If `status` is supplied, `readState` is skipped by an `if / else if` chain. Thus `status: "answered", readState: "unread"` returned an Answer whose `answerRead` was `true`.
2. `includeTerminal` is accepted in the tool and TypeScript input type but is never referenced by the query implementation.

**Recommendation:** Define whether filters compose conjunctively, then implement and test every advertised combination. Either implement `includeTerminal` or remove it from the tool schema. Prefer a smaller explicit query model such as `kind: actionable | pending | unread-answer | terminal` if arbitrary combinations are not intended.

### P1 — Development restart recovery is slow and freshness is opaque

After restarting on an ephemeral new port, the current extension continued reporting the old disconnected target for more than 30 seconds. Restarting the fresh server on the former port allowed eventual reconnection, but the backoff still took roughly tens of seconds and exposed no next-retry timing.

**Recommendation:** Keep a stable checkout port when possible, react promptly to a changed validated `active-local/server.json`, and expose retry/backoff/target-affinity state in diagnostics. A developer should not need to infer whether to wait, reload Pi, or restart on the old port.

### P2 — First recovery read always looks previously read

`getAnswerForRecovery` first writes `first_reader_*`, then calls the normal `getAnswer`. The latter necessarily observes a populated first reader and returns `alreadyRead: true`. The live first recovery call therefore returned both `alreadyRead: true` and a `firstRead` record naming the current recovery caller at the same instant.

**Recommendation:** Preserve whether the recovery call won the first-read update and return `alreadyRead: false` to that winner, or rename the field to unambiguously describe post-call state.

### P2 — Discovery scope identifiers are under-specified

The tool schema names filters `repository`, `worktree`, and `feature` as plain strings. Supplying the intuitive repository/worktree path returned an empty result; supplying the opaque IDs from the previous scope receipt worked. Omitting the filter and setting only `scope` also correctly used the caller's current IDs.

**Recommendation:** Rename explicit filters to `repositoryId`, `worktreeId`, and `featureId`, document that callers normally set only `scope`, or accept canonical paths/remote names as aliases. Avoid silent empty results for a plausible path when an opaque ID is required.

### P2 — Ownership operations lack compact owner discovery

`get_postbox_owner_status` requires exact owner identities, and transfer requires the target owner to already exist. There is no compact agent tool to discover assignable owners. To test transfer safely, the audit had to find another owner through a global Question detail read, check that owner's presence, transfer a synthetic Question, and then take it back.

**Recommendation:** Add a privacy-preserving `list_postbox_owners`/assignable-owner discovery tool, or return stable candidate owner identities from an existing compact discovery surface. Include transfer eligibility and presence without Question content.

### P2 — Batch creation repeats shared context

Every batch child requires its own nonblank `context.codebaseContext` and `context.problemContext`, even when all Questions share the same handoff. The five-item test repeated identical context five times. The per-question `questionContext`, `relevance`, and `decisionImpact` fields can further overlap semantically.

**Recommendation:** Add batch-level `defaults` or `sharedContext`, with per-item overrides. Keep the persisted Questions self-contained after expansion on the server.

### P2 — History and detail reads can consume excessive model context

`get_question_history` returns full question/options/context snapshots for every revision. A one-line prompt edit repeated unchanged options and handoff context. `get_questions` similarly returns full details for every requested ID without a projection option.

**Recommendation:** Default history to the initial snapshot plus revision deltas/events, with `includeSnapshots: true` for forensic reads. Add detail projections such as `fields`, `summary`, or `includeContext` for targeted agent workflows.

### P3 — Pending `get_answer` is no longer stuck but is not structured

The latest build correctly distinguishes pending (`Answer not found`), missing (`Question not found`), wrong owner, lifecycle-only terminal states, and actual Answers. This resolves the original stuck/misleading mixed-version incident. However, pending is still returned as an error-like text rather than a normal typed state.

**Recommendation:** Return `{ "type": "pending", "questionId": ..., "status": "pending" }` after the bounded wait. Reserve errors for missing, unauthorized, or invalid requests.

### P3 — `revise` has sharp replacement semantics

A revise call containing only `{ question: { prompt } }` removed the prior question-level context, relevance, and decision impact. This is internally consistent with replacing the nested question object, but easy for an agent to mistake for a patch because omitted options and handoff context are preserved.

**Recommendation:** Rename the action to `replace`, require the complete question object, or make revise an explicit field-level patch. Do not mix replacement semantics for one nested object with preservation semantics for adjacent omitted fields without documenting it in the tool description.

### P3 — Optimistic concurrency is safe but verbose

Every update repeats `expectedRevision` and `expectedOwnerRevision`; transfer additionally repeats the expected owner identity. The dual-token model correctly prevented stale content and ownership mutations and is worth preserving, but it increases schema/context cost.

**Recommendation:** Consider a compact opaque `ifMatch` token returned by `get_questions`, while retaining the two revisions in diagnostic responses and history. For owner-initiated transfer, evaluate whether repeating `expectedOwner` adds protection beyond the ownership revision and authenticated caller identity.

### P3 — Pagination cursors are large for agent transcripts

The opaque cursor is robust but roughly a few hundred characters and must be copied back exactly.

**Recommendation:** Consider shorter server-side cursor handles with bounded expiry, while retaining stateless cursors where deployment simplicity matters more than token cost.

## Original `get_answer` incident: resolved status

The first run used the stale server and a newer extension. The Question definitely existed: creation, detail read, and history all succeeded. Later calls stalled or returned no result, and after interruption the Question was cancelled with `The agent stopped waiting for this question.` The old `get_answer` then timed out with a combined missing/wrong-session message.

Against the fresh build:

- the old cancelled Question returned immediately as `{ type: "lifecycle", status: "cancelled" }`;
- a new pending Question returned bounded `Answer not found` and remained pending;
- a nonexistent ID returned `Question not found`;
- a transferred Question returned `Reader does not own this Question` immediately;
- cancelled and superseded Questions returned structured lifecycle results; and
- a real waiting call woke with its Answer.

**Conclusion:** the blocking and conflated-error behavior is resolved in the newest code. The remaining improvement is to make the bounded pending result structured rather than error-like.

## Final validation

- `npm run build`: passed, including TypeScript build, Vite production build, and web-asset copy.
- `npm run typecheck`: passed.
- `npm test`: passed — 93 files and 560 tests.
- Final checkout-scoped launcher/server restart: passed on API port `41657`; the extension reconnected.
- Post-restart `postbox_status`: connected, zero current-owner open Questions.
- Post-restart `get_answer` on the resolved wait fixture: returned its persisted Answer immediately.
- Package version synchronization: all root/workspace manifests are `0.1.2` and internal workspace pins are synchronized.
- Exact health version proof: **failed by design defect** — fresh process health still reports `version: 0.1.0`, `protocolVersion: 0.1.0`, and checkout-static `buildId: dev-79522f2660390417`.

## Changes made during this audit

- Added project instructions: `AGENTS.md`.
- Added this report: `docs/audits/2026-08-15-postbox-tool-architecture-live-test.md`.
- Synchronized root and workspace versions to `0.1.2`, including lockfile metadata.
- Rebuilt and restarted the checkout-scoped development server for live verification.

No behavioral source fixes were made; the current defects above remain available for focused remediation.
