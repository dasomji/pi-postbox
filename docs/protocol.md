# Pi Postbox protocol overview

All process-boundary payloads are defined in `@pi-postbox/protocol` and validated with Zod. Clients should ignore unknown fields and preserve stable ids where provided. Schemas enforce finite Question, option, icon, HTTP body, and WebSocket frame limits so a single ask cannot grow without bound.

## Legacy expiry migration

The owner-contract migration preserves expiry timestamps from databases written before expiry provenance was recorded. Those released rows cannot distinguish an explicit 12-hour expiry from the former automatic 12-hour default, so guessing from timestamp arithmetic would destroy user intent. Postbox clears an expiry only when the legacy writer recorded `manufactured_default`; unknown values are retained. The migration ledger records this conservative rule and makes repeated or partially completed migrations deterministic.

## Legacy Question context removal

Current protocol payloads contain no top-level handoff `context`. Database startup clears legacy `context_json` values from `ask_requests`, `questions`, and `question_revisions` and records `remove-question-context-v1` in the migration ledger. The compatibility columns remain in SQLite so older database layouts can be opened safely, but current code never writes or projects them.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Health/status check and authoritative server profile identity for clients, wrappers, smoke tests, and operators. |
| `GET /` | Built Svelte UI shell served by `pi-postbox-server`. |
| `GET /api/state` | Current live-state snapshot: sessions plus pending ask request snapshots only. Terminal requests remain available through History. |
| `GET /api/state/events` | Authoritative live-state SSE bootstrap. Sends one fresh pending-only `state` event on connection/reconnection, then snapshots after changes. |
| `GET /api/requests` | Request list, optionally filtered with `?status=pending|answered|cancelled|expired|superseded`. |
| `POST /api/requests/:requestId/answer` | Browser/user answer action. First pending answer wins. A stale `expectedRevision` returns HTTP 409 with `error: "stale_revision"`. |
| `POST /api/requests/:requestId/cancel` | Browser/user cancel action. |
| `POST /api/requests/:requestId/chat` | Activate or reattach to the extension-owned fresh session for Question Chat, seeded with the selected question and server defaults. |
| `GET /api/requests/:requestId/chat` | Fetch the current normalized Question Chat snapshot. |
| `POST /api/requests/:requestId/chat/messages` | Start an idle Question Chat turn or steer the active turn, using a stable browser command id. |
| `POST /api/requests/:requestId/chat/stop` | Abort only the active Question Chat turn, using a stable browser command id. |
| `GET /api/requests/:requestId/chat/events` | Stream normalized Question Chat lifecycle/message events plus transient online/offline transport state over SSE. |
| `POST /api/machines/:machineId/rename` | Persist dashboard-side machine alias. |
| `POST /api/projects/:projectId/rename` | Persist dashboard-side project alias. |
| `GET /api/history` | Recent terminal decision history. |
| `POST /admin/shutdown` | Gracefully stop the server. Loopback-only: rejected (403) unless the request comes straight from `127.0.0.1`/`::1` with no proxy-forwarding headers, so it is unreachable through Tailscale/lizardtail. Returns `202` then closes the app and exits. Used by `npm run dev` to stop a production server holding the canonical port. |

Dynamic `/api/*` responses declare `Cache-Control: no-store`. Eligible non-streaming responses negotiate Brotli or gzip above the server compression threshold; hijacked event streams preserve immediate streaming semantics. Dashboard startup and notification routing use the state event stream's initial snapshot rather than also fetching `/api/state`. A reconnect receives a new authoritative snapshot, replacing state that may have gone stale while disconnected.

Every `/healthz` and `/api/*` response carries `X-Postbox-Protocol-Version`. Every Android-facing JSON, state SSE, Question Chat SSE, and FCM envelope also carries required top-level `protocolVersion` evidence. Android sends `X-Postbox-Client-Protocol-Version` on every request. A present client version that is not exactly equal to the server protocol receives a versioned `426 Upgrade Required` response before route logic or any state-changing command executes; the header may be absent only for browser and legacy clients during migration.

Android validates version-neutral evidence before invoking a version-specific decoder. Missing and different evidence are incompatible. A mismatch on the health-verified connection hard-blocks state, Answer, cancel, refresh, push registration, and Question Chat until a successful health recheck. A delayed incompatible FCM message is rejected and reported separately without changing the compatibility state of an independently health-verified live connection.

## Question Chat browser and relay protocol

The browser activates a fresh session with `POST /api/requests/:requestId/chat`. Activation and `GET /api/requests/:requestId/chat` return the initial normalized snapshot. The browser then subscribes to `GET /api/requests/:requestId/chat/events` for incremental lifecycle, message, tool, and online/offline transport events. The stream begins with a connection comment; it does not replay a private transcript, so clients resynchronize from a fresh snapshot if a runtime sequence has a gap.

Messages use `POST /api/requests/:requestId/chat/messages` with `{ "clientCommandId": "...", "message": "..." }`; Stop uses `POST /api/requests/:requestId/chat/stop` with the same bounded `clientCommandId` shape. The id makes retries idempotent. An accepted send returns `mode: "turn" | "steer"`; commands are rejected while the extension is offline rather than queued. This is a coordinated pre-release wire rename: server, extension, and browser ship together, and the former mode term is not accepted.

Every correlated server-to-extension request/response command has a relay `requestId`; one-way notifications such as `chat.cleanup` do not require one. The extension response must carry that matching correlation id, and Question Chat payloads also carry the owning Postbox Question id. The principal command/result pairs are:

| Server command | Extension result |
| --- | --- |
| `chat.activate` | `chat.ready` or `chat.error` |
| `chat.snapshot` | `chat.snapshot` or `chat.error` |
| `chat.send` | `chat.send.accepted` or `chat.error` |
| `chat.stop` | `chat.stop.accepted` or `chat.error` |
| `chat.propose-answer.result` | Result for extension-originated `chat.propose-answer` |
| `chat.reconcile` | `chat.reconciled`, followed by `chat.recover.complete` after accepted recovery |

The extension emits sequenced visible `chat.event` frames independently of command acknowledgements. Terminal resolution or authoritative owner reconciliation sends `chat.cleanup`. On reconnect, the extension offers only owner metadata with `chat.recover.offer`; the server answers `chat.reconcile` with a correlated recover/delete disposition. Private snapshots transferred during recovery remain transient.

Public Question Chat failures use the structured error codes `forbidden_origin`, `rate_limited`, `duplicate_command`, `wrong_owner`, `request_not_pending`, `extension_offline`, and `command_timeout` (along with the source/runtime codes defined by `QuestionChatAvailabilityCodeSchema`). HTTP status distinguishes origin, throttling, missing/terminal requests, and unavailable extension/timeout cases; the JSON body remains `{ "status": "unavailable", "error": { "code": "...", "message": "..." } }`, with `retryAfterMs` when applicable.

A successful proposed answer is appended as an option with authoritative `provenance: "chat"`; proposal does not select or resolve the Question.

## Health profile identity

`/healthz` always reports separate application `version`, `protocolVersion`, `profile`, and `buildId` fields. The CLI application version comes from the server package manifest. Its default build id combines that version with a deterministic SHA-256 fingerprint of the loaded runtime directory, so two builds from the same checkout do not share an identity merely because their path is unchanged. A listening server also reports its `instance`, containing the instance id and normalized loopback URL. Production uses the literal `production` profile; trusted source checkouts use `development:<checkout-id>`.

The single profile-local `active-local/server.json` record requires an exact identity match: profile, instance id, URL, protocol version, and build id must match `/healthz` before the extension trusts the target. Missing or mismatched identity is a health mismatch. This keeps stale or unsafe metadata from redirecting clients to another server or profile. Any incompatible schema change increments `protocolVersion`; package version and build fingerprint identify the particular application artifact independently.

Pi `/reload` may retain a native ESM shared-protocol dependency even when it reloads extension source. After changing or upgrading shared protocol code, the operator must fully restart Pi. When version-neutral health-envelope checks prove that profile metadata and `/healthz` identify the exact live profile owner but the loaded protocol versions differ, the extension reports `restart-required` recovery, suppresses package-local autostart, and does not trust newer message schemas from the stale runtime.

## Extension WebSocket

The Pi extension connects outbound to:

```text
/api/extension/ws
```

Client messages:

- `session.register` — machine/project/session metadata and generated machine id.
- `heartbeat` — keeps the session live and can carry semantic state.
- `session.update` — semantic/title/cwd/branch updates.
- `session.shutdown` — releases a session and marks it offline. It may include `reason: "quit" | "reload" | "new" | "resume" | "fork"`; replacement/quit reasons cancel that session's pending asks, while `reload` is treated as a reconnect path and does not cancel pending asks.
- `ask.create` — creates or replays an idempotent pending request by `requestId`.
- `ask.answer` — reconciles a local terminal fallback answer.
- `ask.cancel` — reconciles a local terminal fallback cancellation.
- `chat.ready`, `chat.snapshot`, `chat.send.accepted`, and `chat.stop.accepted` — correlated Question Chat command results.
- `chat.event` — normalized visible Question Chat lifecycle/message output; private reasoning and tool traffic never cross this boundary.
- `chat.recover.offer`, `chat.reconciled`, and `chat.recover.complete` — a one-recovery-manifest-at-a-time, correlated reconnect protocol. The extension offers private metadata only; a recovered full snapshot is transient and is never stored by the server.

Server messages:

- `registered` — registration accepted.
- `ack` — heartbeat/session update/shutdown accepted.
- `ask.created` — a pending Postbox Question exists. Its payload includes the `questionId`, current `revision`, `status: "pending"`, and `disposition: "created" | "idempotent"`.
- `ask.resolved` — ask reached a terminal `answered`, `cancelled`, `expired`, or `unavailable` result.
- `error` — validation or transition error.
- `chat.activate` — activate or reattach to a fresh session with the selected question and server defaults.
- `chat.snapshot`, `chat.send`, `chat.stop`, and `chat.cleanup` — owner-scoped commands for the exact private Question Chat runtime.
- `chat.reconcile` — the server-authoritative `recover`/`delete` disposition for one offered manifest. Recovery requires the registered socket, pending request owner, request id, and fork kind to agree; missing, terminal, and wrong-owner manifests are deleted.

## Question Chat fresh-session activation

Question Chat snapshots identify their runtime with `forkKind: "fresh"`. A ready response with any other runtime kind is rejected. Repeated activation reattaches idempotently to the same private fresh session.

Activation carries `source: { cwd, question: { revision, question, ambiguity, options, mode }, settings: { model, effort } }`. The server supplies authoritative Question data and its saved defaults; no source transcript path or leaf is read. The runtime creates a new session and seeds the question as a context message. Legacy `source_path_missing` / `source_leaf_missing` codes remain recognized for diagnostics but are not fresh-session prerequisites. The original extension must still be connected to host the runtime.

`GET /api/settings` returns `{ revision, chat: { model, effort } }`. `PUT /api/settings` accepts that same shape with the last-read revision and rejects stale updates with HTTP 409. Model is null for Pi's configured default, or an explicit `provider/model-id`. Effort is `off | minimal | low | medium | high | xhigh | max`. Defaults initially use null/medium. Settings persist in SQLite and apply to new chats across web and Android. Visible settings screens refresh every five seconds and on foregrounding without replacing unsaved edits. No app-level user accounts exist: settings belong to this single-user server installation. Chat snapshots report the effective `model.effort`; model source is `postbox-settings` or `pi-default`. Explicit unavailable models fail instead of falling back.

## Question Chat turn lifecycle

Question Chat snapshots and events use `ready`, `generating`, `stopping`, `stopped`, and `interrupted` states. A message sent while `ready` starts an ordinary Question Chat turn and returns `mode: "turn"`. A message accepted while `generating` uses Pi's `streamingBehavior: "steer"` path and returns `mode: "steer"`; it is not queued as a follow-up turn.

Stop aborts the active SDK operation without disposing the private runtime. Visible partial assistant output remains in the transcript with a `stopped` marker, the lifecycle passes through `stopping` and `stopped`, and the runtime returns to `ready`. A retry-exhausted SDK error similarly preserves the last visible partial with an `interrupted` marker before returning to `ready`; retryable attempts are not marked interrupted prematurely. Replayed send and Stop commands are idempotent by their bounded `clientCommandId`.

The private fresh session remains the only Question Chat transcript. A version-2 `0600` recovery manifest in a hash-keyed `0700` directory records the owning session, fresh session kind, private session path, transcript boundary, model metadata, and durable sequence high-water mark. `/reload` aborts/disposes the old SDK runtime but preserves this fork; replacement, quit, terminal resolution, invalid metadata, and authoritative reconciliation deletion remove it. Runtime sequence is persisted before an event is emitted so a crash cannot reuse a number.

Question Chat enables exactly four custom repository-evidence tools: literal, bounded equivalents of read, grep, find, and list. Pi builtin tools, shell, mutation tools, and extension-provided tools are excluded. Each activation and recovery rediscovers the containing Git worktree for the recorded cwd, or uses the cwd subtree outside Git. Paths are schema-validated, normalized, containment-checked component by component, screened for ignored and secret-like names, and opened/traversed with finite byte, match, entry, depth, operation-time, and browser-output limits. Directory symlinks are never traversed. Tool activity is normalized into bounded running/success/error/stale rows; completed rows reconstruct from the private fork after reload, while a crash-interrupted running row becomes stale.

Browser snapshots are extension-backed. A fresh browser sees `extension_offline` when the extension cannot supply one. An already-open browser preserves its rendered snapshot during an outage, marks it offline/stale, disables commands, and requires Retry. Runtime events are monotonic; a gap causes a fresh snapshot resynchronization. Transient transport frames have no runtime sequence and are not transcript data. Expandable tool details render as bounded plain text, never raw HTML. The server never queues Question Chat commands while the extension is offline and never stores Question Chat snapshots, messages, or tool activity in SQLite.

## Creation and Answer lifecycle

1. Pi calls `write_question` with `action: "create"`.
2. Extension sends `ask.create` with a stable `requestId`.
3. Server stores a pending request, returns a persistence receipt, and broadcasts state over SSE.
4. `write_question` returns a reusable current Question handle; Pi continues independent work without polling.
5. Browser or local terminal fallback submits an answer/cancel.
6. Server stores a terminal result in History, broadcasts the pending-only live state, and sends the owning extension a lightweight availability notification.
7. After notification—or after an explicit `wait_for_postbox` wakes—Pi calls the bounded `get_answer` read.

Replayed `ask.create` messages with the same `requestId` are idempotent. The server always returns `ask.created` with current control state; its single-Question receipt reports `disposition: "created"` for first persistence and `disposition: "idempotent"` for a replay. If the Question is already terminal, the server then also returns `ask.resolved`. Once persistence is acknowledged, aborting the originating Pi tool call or compacting its turn does not cancel the durable Question.

```json
{
  "action": "create",
  "questionId": "ask_…",
  "revision": 2,
  "ownerRevision": 1,
  "status": "pending",
  "disposition": "idempotent"
}
```

### Ordered batch creation and receipts

Batch input is an ordered list of complete Question drafts. Each item includes its own `question`, non-blank `ambiguity`, options, and optional stable `requestId`; an item may refer to an earlier item with `parentLocalRef`. There is no batch `defaults` object. Replay remains keyed by each item's stable `requestId`. Batch mode rejects single-Question fields at the top level, including `requestId`, `timeoutMs`, and internal `expiresAt`; Postbox exposes no atomic batch-level idempotency key.

The model-facing single and per-item schemas do not expose expiry controls. Absolute `expiresAt` and `forkReference` remain accepted by internal protocol/embedding interfaces for compatibility and provenance, but are not model-authored tool fields.

A `write_question` batch receipt preserves input order. Every accepted item reports `localRef`, persisted `questionId`, current `revision`, current `ownerRevision`, current lifecycle `status`, and `disposition: "created" | "idempotent"`; rejected items report their `localRef` and typed reason. The model-facing top-level `batchStatus` remains `created`, `partial`, or `rejected`.

The tool's text and details results use the same compact JSON projection so generated IDs are immediately reusable without a discovery query:

```json
{"action":"create_batch","batchStatus":"created","items":[{"localRef":"root","questionId":"ask_…","revision":1,"ownerRevision":1,"status":"pending","disposition":"created"}]}
```

### Human Answers and lifecycle-only resolutions

`answerId` and `answerRead` are evidence of a human Answer and appear in full Question details and compact status results only when `status` is `answered`; default control details omit them. Cancelled, expired, and superseded Questions may use internal lifecycle records, but those records are never exposed as Answers.

`get_answer` returns immediately after its bounded read. A human Answer produces exactly the compact fields below:

```json
{
  "questionId": "question-1",
  "answerId": "answer-1",
  "answer": ["sqlite"],
  "note": "Keep it local"
}
```

`answer` is always an array of the selected machine option values, including for a single-choice Question; `note` is optional. Reading keeps the Question lifecycle status `answered` and atomically records the first read internally, but ordinary output omits status and read-receipt evidence.

An unresolved Question produces the normal compact branch `{ "type": "pending", "status": "pending", "questionId": "…" }`; it does not fail with an Answer-not-found error and it does not expose Question content. Any lifecycle-only terminal Question likewise returns a compact explicit result with no repeated Question content or Answer/read fields:

```json
{
  "type": "lifecycle",
  "status": "superseded",
  "questionId": "question-old",
  "replacementQuestionId": "question-new",
  "resolvedAt": "2026-08-15T12:01:00.000Z"
}
```

Cancelled and expired results may additionally include `note`. Superseded results require `replacementQuestionId`. Every lifecycle result includes `resolvedAt`.

A recovery read authorized for an offline owner records the actual recovery agent as the first reader without transferring ownership. Exactly one first reader receives `alreadyRead: false`; subsequent owner or recovery reads receive `alreadyRead: true` and retain the original `firstRead.reader`. Recovery reads default to the same compact Answer or lifecycle shape described above plus `alreadyRead` and `firstRead`; pending output remains the bounded pending branch. Callers must explicitly request `view: "full"` to receive the complete Question, Answer, and read metadata.

`list_question_status` defaults to actionable facts only: pending Questions plus unread human Answers. `status` and `readState` are conjunctive when both are supplied. With no explicit status/read filter, `includeTerminal: true` broadens the default to every lifecycle state; explicit filters remain authoritative. Compact status results never include Question text, options, notes, or Answer content. One call returns `{ statuses, nextCursor? }` with at most 50 status records.

### Bulk-read limits and pagination

Every model-facing collection read is bounded at both the protocol schema and server implementation:

- `list_questions`: 25 records by default, 100 maximum, returning `{ questions, nextCursor? }`;
- `get_questions`: 20 explicit Question IDs maximum;
- `list_question_status`: 50 records maximum per page;
- `get_question_history`: 50 combined revision/event records maximum per page;
- `list_postbox_owners`: 50 records by default, 100 maximum; and
- `get_postbox_owner_status`: 20 explicit owner identities maximum.

`nextCursor` values are opaque compact base64url tokens. They are stateless: each token carries a short query digest and the keyset or frozen-snapshot boundary needed for continuation, so the server keeps no cursor lookup table and restart does not invalidate them. A cursor is valid only for the same semantic query (scope, filters, owner, view, or Question as applicable); malformed and cross-query tokens are rejected. Callers copy a cursor unchanged into the next request and must not parse or construct it. `list_questions` also accepts the prior verbose stateless cursor format during the compatibility transition but emits only compact cursors.

### Compact and forensic query views

`get_questions` defaults to `view: "control"` and accepts at most 20 IDs per call. A control record contains `questionId`, `revision`, `ownerRevision`, `status`, `owner`, `creator`, optional `parentQuestionId`, and `updatedAt`. It deliberately omits prompt, options, expiry, resolution details, and Answer content. Callers that need the complete current decision picture must explicitly request `view: "full"`; missing IDs are omitted and input order is preserved for records that exist.

A full record contains current Question content plus a non-consuming `resolution`. Human Answer evidence has `kind: "answer"`, `answerId`, `questionRevision`, selected machine values in `answer`, optional `note`, `resolvedAt`, and `firstRead` (a reader/timestamp receipt or `null` when unread). Lifecycle evidence has `kind: "lifecycle"`, terminal `status`, optional `note`, `resolvedAt`, and the replacement Question ID when superseded. It never exposes legacy rationale data. Full records do not duplicate immutable revision/event history; compose this call with `get_question_history` when historical revisions matter.

`get_question_history` defaults to `view: "events"`. Each response is a bounded page with `questionId`, `view`, `revisions`, `events`, optional `initial`, and optional `nextCursor`. In compact view the logical record order is:

- `initial`: the complete revision-1 snapshot, present only on the page containing that first logical record;
- `revisions`: subsequent content revisions containing metadata plus only the complete sections replaced at that revision (`question` and/or `options`); then
- `events`: non-content hierarchy, lifecycle, and ownership events.

These revisions are section replacements, not JSON Patch operations. `view: "full"` pages every stored immutable revision snapshot followed by all events, including revision events. The first call freezes the highest revision and event IDs into the stateless continuation cursor, so records appended later do not shift or enter that traversal. Compact history is derived at read time; the persisted forensic record is unchanged.

### Scoped owner discovery

`list_postbox_owners` derives authorization and grouping from the registered caller session. Its default `feature` scope may be broadened only to the caller's `worktree` or `repository`; arbitrary scope IDs and global discovery are not accepted. It returns `{ owners, nextCursor? }` with 50 entries by default and at most 100, each exactly `owner`, coarse `presence`, `activeQuestionCount`, and `unreadAnswerCount`. Offline historical owners with both counts zero are omitted by default; `includeInactive: true` includes them for audit workflows. Membership/presence come from sessions in the derived scope, while counts include Questions in that same scope. The caller may appear when present or actionable.

The `list_questions` and `list_question_status` model-facing exact-owner filter is a strict object requiring non-empty `harness` and `ownerId` strings and rejecting additional properties. Callers normally omit this filter and use the scope contract; the server independently applies the same strict identity validation at the protocol boundary.

The result intentionally excludes semantic state, heartbeat timestamps, titles, paths, prompts, context, and a transfer-eligibility claim. A caller must still perform the normal revision/owner compare-and-swap when transferring a Question. `get_postbox_owner_status` remains the exact-owner lookup when the owner identities are already known.

## Question update concurrency

Question details expose two independent optimistic-concurrency tokens:

- `revision` changes when Question content or hierarchy changes, and for lifecycle transitions made through `write_question`.
- `ownerRevision` changes only when ownership is transferred or taken over.

Every existing-Question `write_question` action supplies both `expectedRevision` and `expectedOwnerRevision` from a fresh complete detail read. The server rejects a mismatch before applying the update. Transfer and takeover leave `revision` unchanged, increment `ownerRevision`, and record both versions on the immutable `owner_changed` history event. This invalidates snapshots captured before an ownership change without treating ownership as content.

The model-facing tool schema uses one compact flat object with an explicit action enum and documents which fields each action requires. Creation and update operations share only this model-facing seam: the extension dispatches to the existing strict create or update WebSocket command. Missing action-specific fields, fields from another action, and unknown fields are rejected before execution.

## Status and browser command boundaries

The `/postbox-status` user command and read-only `postbox_status` tool expose privacy-preserving operational status: connection state, active/local URL when known, Tailnet/export guidance when available, exact server package/protocol/instance/build identity, open-question count, autostart state, and diagnostics. Reconnect diagnostics include the scheduled delay and target. When unresolved sent work pins its origin server, status records the deferred target and bounded affinity interval instead of silently appearing stuck. These surfaces do not expose pending question contents, options, answers, notes, or history.

The `/postbox` user command opens the active dashboard in the user's browser, using recovery/autostart if needed. Browser-opening is user-only/manual behavior and is not exposed through an LLM tool or agent side effect.

## Structured Question and result hygiene

Every new Question contains a prompt, a required non-blank ambiguity that states what uncertainty it aims to resolve, and one or more options. Options may include bounded description and impact text. At startup, persisted legacy option `meaning` fields migrate to `impact`; an already present `impact` remains authoritative, and legacy per-option context is removed. Internal provenance may also record the originating agent session path/id, leaf id, cwd, and model for exact-fork Question Chat.

There is no top-level handoff context or per-option context in creation, current snapshots, or immutable history. `write_question` returns a compact current handle or update receipt. A later ordinary `get_answer` returns exactly the Question ID, Answer ID, selected machine option values, and optional user note.

## Semantic and presence state

Semantic state is reported by the extension:

- `working`
- `blocked`
- `waiting_for_postbox` (displayed by Android as “Needs you”)
- `idle`
- `unknown`

A Pi session replacement (`/new`, `/resume`, `/fork`) is a semantic boundary: the old Postbox session is explicitly shut down and unresolved asks for that session are cancelled with a lifecycle note. A Pi `/reload` is not a semantic boundary; pending asks remain attached to the same session and the replacement extension runtime can reconnect/re-register.

Presence is derived by the server from WebSocket connection and heartbeat timing:

- `live`
- `stale`
- `offline`

Persisting through a `write_question` create action does not block the agent turn. Postbox pushes a lightweight Answer-available notification, so agents must not poll `get_answer`, `list_question_status`, or `list_questions`. After independent work is exhausted, an agent whose sole blocker is a human Postbox decision may call `wait_for_postbox` once. Only that explicit wait publishes `waiting_for_postbox`, remains idle until an actionable event, and retains adapter capacity. Observed local `ask_user` calls also mark blocked. Herdr-compatible blocked events are best-effort; Postbox does not depend on Herdr.

## Profile-scoped client routing compatibility

Profile routing has no broad discovery and performs no port scanning. A client reads only its resolved profile's config and `active-local/server.json`; it never orders or falls back across profiles.

Effective env-over-config precedence is preserved. `PI_POSTBOX_URL` is an intentional explicit override and may identify a Tailscale or hosted server. Without it, health-verified profile metadata and package-local autostart are the local recovery paths. A global production loopback configuration is not visible to a checkout development profile.

Running sessions may reconnect only within their resolved profile. Unresolved sent asks and local fallback resolutions pin their origin endpoint until resolved, flushed, expired, or released by a bounded target-affinity deadline; while pinned, clients may report deferred switching. A replacement server process at that same profile and URL is a restart, not a retarget: reconnect refreshes its exact instance/build identity. Another profile is never a retarget candidate.

Package-local autostart is a client recovery behavior for `write_question` and the user-only `/postbox` command. It can be disabled with `PI_POSTBOX_AUTOSTART=off`; `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` sets the wait time and defaults to 10 seconds (`10000` ms).

## Compatibility notes

- Treat `requestId`, `sessionId`, `machineId`, and `projectId` as stable protocol identifiers.
- Handle unknown fields gracefully.
- Use `/healthz` to confirm service and protocol version before relying on newer fields.
- Package 0.5.7 uses protocol 0.1.12 and Android 0.5.4 (versionCode 16). Ordered Question image galleries and sticky workspace controls are preserved alongside fresh Question Chat and shared model/effort Settings. See [Question image galleries](question-images.md). Restart existing Pi sessions for the combined protocol and tool schema.
- Question Chat uses `forkKind: "fresh"`. Legacy exact-fork manifests are discarded on recovery; update the server, extension and clients together.
- Package version 0.2.6 retains protocol compatibility version 0.1.8 and updates Android 0.4.1 to submit the current Question revision required by the Answer endpoint. Package version 0.2.5 retains protocol compatibility version 0.1.8, prevents stale durable owner counts from hiding locally tracked open Questions in status surfaces, makes published package updates robust on npm 11, and prebuilds the shared protocol before clean-checkout test runs. Package version 0.2.3 retains protocol compatibility version 0.1.8 and adds validated npm Trusted Publishing from pushes to the main branch through GitHub Actions OIDC. Package version 0.2.2 retained protocol compatibility version 0.1.8 and changed release packaging metadata only. Package version 0.2.1 introduced protocol compatibility version 0.1.8, adds server-enforced bulk-read limits and paged status/history/owner envelopes, emits compact stateless cursors, and omits inactive owners by default. Matching extension/server/protocol builds are required. Package version 0.2.0 used protocol 0.1.7, merged Question creation and updates into the model-facing `write_question` tool, and extended create receipts with current content/ownership revisions and lifecycle status. Package version 0.1.9 used protocol 0.1.6 and required ambiguity on new Questions, simplified model-facing parent/expiry fields, renamed legacy option `meaning` to `impact`, removed top-level handoff context and per-option context, removed reconstructed Question Chat, and used exact-fork Chat only. Package version 0.1.8 added single-Question receipt disposition and suppressed autostart when exact live-profile identity proved that `/reload` retained an incompatible protocol dependency; a full Pi restart was then required. Package version 0.1.7 added compact recovery views, explicit exact-owner schemas, and a compact model-facing update schema.
- V1 has no app-level authentication; restrict network reachability with Tailscale/lizardtail or an external auth proxy.
- State-changing HTTP actions and extension WebSockets reject cross-origin browser requests unless the `Origin` host matches the Postbox service host. Node/Pi extension clients normally omit `Origin` and are accepted if they can reach the service.

`GET /api/settings/models` returns `{ models: [{ id: "provider/model-id", name: "Model name" }] }` with the normal protocol-version envelope/header and `Cache-Control: no-store`. It freshly reads the server Pi configuration on every request and returns only authenticated available models; a catalog load failure returns HTTP 503 (`models_unavailable`), distinct from an empty catalog. This is an additive endpoint under protocol 0.1.12.
