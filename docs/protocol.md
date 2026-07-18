# Pi Postbox protocol overview

All process-boundary payloads are defined in `@pi-postbox/protocol` and validated with Zod. Clients should ignore unknown fields and preserve stable ids where provided. Schemas intentionally allow generous interviewer context, but still enforce finite string, option, icon, HTTP body, and WebSocket frame limits so a single ask cannot grow without bound.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Health/status check for wrappers, smoke tests, and operators. May include optional `localTarget` identity for active-local routing. |
| `GET /` | Built Svelte UI shell served by `pi-postbox-server`. |
| `GET /api/state` | Current state snapshot: sessions plus current/terminal ask request snapshots. |
| `GET /api/state/events` | SSE stream. Sends an initial `state` event, then validated state snapshots after changes. |
| `GET /api/requests` | Request list, optionally filtered with `?status=pending|answered|cancelled|expired`. |
| `POST /api/requests/:requestId/answer` | Browser/user answer action. First pending answer wins. |
| `POST /api/requests/:requestId/cancel` | Browser/user cancel action. |
| `POST /api/requests/:requestId/chat` | Activate or reattach to the extension-owned private Question Chat fork. |
| `GET /api/requests/:requestId/chat` | Fetch the current normalized Question Chat snapshot. |
| `POST /api/requests/:requestId/chat/messages` | Send an idle prompt or steer the active turn, using a stable browser command id. |
| `POST /api/requests/:requestId/chat/stop` | Abort only the active Question Chat turn, using a stable browser command id. |
| `GET /api/requests/:requestId/chat/events` | Stream normalized Question Chat lifecycle/message events over SSE. |
| `POST /api/machines/:machineId/rename` | Persist dashboard-side machine alias. |
| `POST /api/projects/:projectId/rename` | Persist dashboard-side project alias. |
| `GET /api/history` | Recent terminal decision history. |
| `POST /api/history/prune` | Apply configured terminal-history retention. |
| `POST /admin/shutdown` | Gracefully stop the server. Loopback-only: rejected (403) unless the request comes straight from `127.0.0.1`/`::1` with no proxy-forwarding headers, so it is unreachable through Tailscale/lizardtail. Returns `202` then closes the app and exits. Used by `npm run dev` to stop a production server holding the canonical port. |

## Health active-local identity

`/healthz` always reports basic service health and may include optional `localTarget` when the server has published active-local metadata. That identity contains `role`, `instanceId`, and normalized `url`.

Active-local metadata candidates require an exact identity match: the candidate role, instance id, and URL must match `/healthz.localTarget` exactly before the extension trusts the target. Missing or mismatched identity is treated as a health mismatch. This keeps stale or unsafe metadata from redirecting clients to an unrelated loopback server.

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

Server messages:

- `registered` — registration accepted.
- `ack` — heartbeat/session update/shutdown accepted.
- `ask.created` — pending ask card exists.
- `ask.resolved` — ask reached a terminal `answered`, `cancelled`, `expired`, or `unavailable` result.
- `error` — validation or transition error.
- `chat.activate`, `chat.snapshot`, `chat.send`, `chat.stop`, and `chat.cleanup` — owner-scoped commands for the extension-owned private Question Chat runtime.

## Question Chat turn lifecycle

Question Chat snapshots and events use `ready`, `generating`, `stopping`, `stopped`, and `interrupted` states. A message sent while `ready` starts an ordinary SDK prompt. A message accepted while `generating` uses Pi's `streamingBehavior: "steer"` path and returns `mode: "steer"`; it is not queued as a follow-up turn.

Stop aborts the active SDK operation without disposing the private runtime. Visible partial assistant output remains in the transcript with a `stopped` marker, the lifecycle passes through `stopping` and `stopped`, and the runtime returns to `ready`. A retry-exhausted SDK error similarly preserves the last visible partial with an `interrupted` marker before returning to `ready`; retryable attempts are not marked interrupted prematurely. Replayed send and Stop commands are idempotent by their bounded `clientCommandId`.

## Ask lifecycle

1. Pi calls `ask_postbox`.
2. Extension sends `ask.create` with a stable `requestId`.
3. Server stores a pending request and broadcasts state over SSE.
4. Browser or local terminal fallback submits an answer/cancel.
5. Server stores a terminal result and broadcasts state.
6. Extension receives `ask.resolved` and returns a concise result to the coding agent.

Replayed `ask.create` messages with the same `requestId` are idempotent. If the request is still pending, the server returns `ask.created`; if it is already terminal, the server returns `ask.resolved`.

## Status and browser command boundaries

The `/postbox-status` user command and read-only `postbox_status` tool expose privacy-preserving operational status: connection state, active/local URL when known, Tailnet/export guidance when available, open-question count, autostart state, and diagnostics. They do not expose pending question contents, options, answers, notes, or history.

The `/postbox` user command opens the active dashboard in the user's browser, using recovery/autostart if needed. Browser-opening is user-only/manual behavior and is not exposed through an LLM tool or agent side effect.

## Rich context and result hygiene

Every new ask request must include a `context` object with non-blank `codebaseContext` and `problemContext`. It may also include:

- question context, relevance, and decision impact
- per-option meaning/context
- additional text/code/diagram/link items
- fork references such as agent session id/path and leaf id

The dashboard APIs expose this context for display/history/interviewer use. The `ask_postbox` tool result intentionally returns only final selected values, user note, concise rationale/status metadata, request id, and resolved timestamp.

## Semantic and presence state

Semantic state is reported by the extension:

- `working`
- `blocked`
- `idle`
- `unknown`

A Pi session replacement (`/new`, `/resume`, `/fork`) is a semantic boundary: the old Postbox session is explicitly shut down and unresolved asks for that session are cancelled with a lifecycle rationale. A Pi `/reload` is not a semantic boundary; pending asks remain attached to the same session and the replacement extension runtime can reconnect/re-register.

Presence is derived by the server from WebSocket connection and heartbeat timing:

- `live`
- `stale`
- `offline`

`ask_postbox` waits explicitly mark semantic state as blocked/waiting. Observed local `ask_user` calls also mark blocked. Herdr-compatible blocked events are best-effort; Postbox does not depend on Herdr.

## Active-local client routing compatibility

Active-local routing has no broad discovery and performs no port scanning. Clients read only `active-local/dev.json` and `active-local/production.json` from the configured Postbox base, prefer dev over production while fresh and healthy, and use production fallback when dev is stale or unhealthy.

Effective env-over-config precedence is preserved. A configured `PI_POSTBOX_URL` or configured Tailscale/hosted URL is a preferred Postbox server. The client verifies preferred-server health first; when healthy, the preferred target is authoritative for that registration. If the preferred server is unreachable or unavailable, clients may use local fallback through health-verified active-local metadata or package-local autostart. Remote URLs themselves are not local recovery candidates; metadata and autostart are the recovery paths. Missing or loopback config can use health-verified metadata; a configured loopback fallback is also health-verified.

For active-local sessions, live retargeting may move a running client to a newly selected local target when safe. Sent asks and local fallback resolutions pin their origin until resolved, flushed, expired, or released by a bounded target-affinity deadline; while pinned, clients may report deferred switching. A session that has registered with a fallback/autostarted server is sticky and remains attached until `/reload` or restart rather than polling back to a recovered preferred server mid-session.

Package-local autostart is a client recovery behavior for `ask_postbox` and the user-only `/postbox` command. It can be disabled with `PI_POSTBOX_AUTOSTART=off`; `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` sets the wait time and defaults to 10 seconds (`10000` ms).

## Compatibility notes

- Treat `requestId`, `sessionId`, `machineId`, and `projectId` as stable protocol identifiers.
- Handle unknown fields gracefully.
- Use `/healthz` to confirm service and protocol version before relying on newer fields.
- V1 has no app-level authentication; restrict network reachability with Tailscale/lizardtail or an external auth proxy.
- State-changing HTTP actions and extension WebSockets reject cross-origin browser requests unless the `Origin` host matches the Postbox service host. Node/Pi extension clients normally omit `Origin` and are accepted if they can reach the service.
