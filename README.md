# Pi Postbox

Pi Postbox is a Pi extension and companion web service for remote human decision handoffs.

Instead of streaming full Pi Session transcripts into a dashboard, Pi Postbox focuses on Postbox Questions: Pi Sessions register their presence, report project/branch/machine metadata, and send structured questions when they need input.

The product requirements document is in [`docs/prd/pi-postbox.md`](docs/prd/pi-postbox.md).

## Current status

Version 0.2.12 coordinates protocol 0.1.10 with Android 0.4.5 (build 9), distinguishes transport failures from protocol mismatches, opens cached saved-server workflows offline, restores stamped Question Chat transport state, makes Answer auto-wake recovery queue-aware, preserves valid config fields, reconciles resolved-push badges offline (including after process restarts), handles stale Question revisions as refreshable conflicts, and derives Android contract inputs from their sources of truth.

Issues #1-#11 provide the v1 implementation: runnable TypeScript workspace, `pi-postbox-server` CLI, Pi extension with `write_question`, WebSocket session registration, SSE browser state, SQLite persistence/history, structured Questions and options, semantic working/blocked/idle state, reconnect/idempotency/expiry, local terminal fallback commands, editable presentation metadata, and packaging/deployment docs plus a release smoke script. Version 0.2.6 updates Android 0.4.1 to include the server-required Question revision when submitting an Answer. Version 0.2.5 keeps the footer and status surfaces from undercounting a locally tracked open Question when the durable owner snapshot is briefly stale, makes published package updates robust on npm 11, and prebuilds the shared protocol before clean-checkout test runs. Version 0.2.3 adds validated npm Trusted Publishing from pushes to the main branch through GitHub Actions OIDC. Version 0.2.2 adds complete npm license and source metadata, fixes the published CLI bin path, and excludes test source from the package tarball. Version 0.2.1 bounds and paginates every model-facing bulk read, uses compact stateless cursors, hides inactive historical owners by default, trims repeated list fields, and preserves checkout development ports across restarts. Version 0.2.0 replaces the separate model-facing create/update tools with one explicit-action `write_question` surface and returns reusable current Question handles from creation. Version 0.1.9 requires a concise ambiguity for new Questions, simplifies parent and expiry inputs, renames option `meaning` to `impact`, removes top-level handoff context and per-option context, removes reconstructed Question Chat, and renders single/multi choice with accessible ballot controls. Version 0.1.8 exposed single-Question create/idempotent receipt disposition and safely required a full Pi restart when `/reload` retained an incompatible shared protocol dependency. Version 0.1.7 reduced model-facing tool schemas, strictly described exact-owner filters, and made recovery reads compact by default with an explicit full view while preserving strict server-side action validation and internal provenance/expiry compatibility.

## Quick start from this checkout

```bash
npm install
npm run build
npm run smoke
```

Start the local server with defaults:

```bash
node packages/server/dist/cli.js
```

The production server binds to `127.0.0.1`, uses the fixed canonical port `32187`, stores data in `~/.pi-postbox/postbox.sqlite`, and prints the listening URL. If configured port `32187` is already in use, startup fails instead of silently changing the local and Tailnet URLs. Use `--port` / `PI_POSTBOX_PORT` only to configure a deliberate stable alternative.

## Workspace commands

```bash
npm run dev       # isolated checkout profile: backend + Vite/HMR (see docs/deployment.md)
npm test          # Vitest integration/behavior tests
npm run typecheck # TypeScript project references
npm run build     # build server/protocol/extension and Vite UI
npm run smoke     # packaged-path release smoke test
```

The credential-free smoke script starts the built CLI with a temporary SQLite database and Postbox config directory, fetches the HTML-discovered JavaScript/CSS/PWA assets, and connects a fake extension/runtime. It verifies registration, exact-fork Question Chat activation without an automatic turn, streaming/tool events, Stop and resume, server-restart recovery, an answer proposal, generated-value selection, cleanup, durable state/history, legacy context removal, and absence of the private transcript/evidence from those durable APIs.

## Packages

This repo uses npm workspaces:

- `@pi-postbox/protocol` — shared Zod schemas and TypeScript types.
- `@pi-postbox/server` — Fastify server package exposing the `pi-postbox-server` binary.
- `@pi-postbox/extension` — Pi extension package advertising `pi.extensions` for `write_question`.
- `@pi-postbox/web` — Vite Svelte Tailwind browser UI.

Source-checkout install for Pi extension development:

```bash
npm install
npm run build
pi install /full/location/to/pi-postbox
```

Install the published Pi package resources:

```bash
pi install npm:@wienerberliner/pi-postbox
```

`pi install npm:@wienerberliner/pi-postbox` installs the Pi resources/extension resources plus bundled package-local autostart support. It does not modify your shell environment or provide global binaries.

From this source checkout, run the server binary through npm so the workspace-local `node_modules/.bin` is used:

```bash
npm exec --workspace @pi-postbox/server -- pi-postbox-server
```

Install the optional shell CLI separately for manual shell command usage:

```bash
npm install -g @wienerberliner/pi-postbox
pi-postbox-server
```

`npm install -g @wienerberliner/pi-postbox` is only needed when you want `pi-postbox-server` on your shell `PATH`; it is distinct from `pi install`.

## Agent tool contracts

`write_question` is the single model-facing write surface. Use `action: "create"` or `action: "create_batch"` to persist Questions, and `revise`, `cancel`, `supersede`, `reparent`, `transfer`, or `takeover` to change an existing Question. Creation returns after durable persistence rather than waiting for a human Answer. Continue any independent work and do not poll `get_answer`, `list_question_status`, or `list_questions`: by default, Postbox coalesces Answer notifications and starts a follow-up agent turn for an owning Pi Session that is no longer running. The privacy-preserving wake contains Question identifiers, never Answer content, and tells the agent to read with `get_answer`. If that human decision becomes the only remaining blocker during the current turn, `wait_for_postbox` remains available as an explicit idle/waiting mode.

Batch idempotency is per Question: put a stable `requestId` on each item. A top-level batch `requestId` is invalid because Postbox does not claim an atomic batch-level idempotency contract. Questions may refer to an earlier item with `parentLocalRef`; the server validates the ordered batch before persisting independent Question records:

```json
{
  "action": "create_batch",
  "questions": [
    {
      "localRef": "root",
      "requestId": "rollout-root",
      "question": "Roll out now?",
      "ambiguity": "Whether to begin the rollout now or defer it.",
      "options": [{ "value": "yes", "label": "Yes" }]
    }
  ]
}
```

The model-facing `write_question` contract does not expose expiry controls. Absolute `expiresAt` and `forkReference` remain internal protocol/embedding compatibility fields rather than model-authored inputs. A successful create handle reports `questionId`, current `revision`, current `ownerRevision`, current lifecycle `status`, and `disposition: "created" | "idempotent"`, so it can be passed directly into a later write and a stable-`requestId` replay returns current control state. Accepted batch items return equivalent handles.

Agent query tools use small workflow-oriented results by default:

- `get_questions({ questionIds })` accepts at most 20 IDs and returns lifecycle state, ownership, hierarchy, the latest timestamp, and concurrency revisions. Pass `view: "full"` for Question text and options.
- `get_question_history({ questionId })` returns up to 50 combined revision/event records per page. Compact view starts with the initial complete snapshot, then changed content sections and non-content events; `view: "full"` exposes immutable snapshots. Follow `nextCursor` for later pages.
- `recover_question_answer({ questionId })` returns the compact Answer plus `alreadyRead` and `firstRead` evidence without repeating Question content. Pass `view: "full"` for the complete Question, Answer, and read metadata.
- `write_question` presents one compact model-facing object with an action enum and documented action-specific fields. The server still validates the exact strict action payload and rejects missing, extra, or cross-action fields.
- `list_questions` returns at most 100 records per page; `list_question_status` returns at most 50. Both accept only `scope` and a strict `{ "harness": "…", "ownerId": "…" }` owner filter on the model-facing surface, and return `nextCursor` when another page exists.
- `list_postbox_owners()` derives the caller's feature scope, omits offline zero-count historical owners by default, and returns paged coarse presence and active/unread counts (100 maximum per page). Set `includeInactive: true` only for audit workflows.
- `get_postbox_owner_status({ owners })` accepts at most 20 exact owner identities.
- `get_answer({ questionId })` returns `{ "type": "pending", "status": "pending", "questionId": "…" }` while the Question remains unresolved; this is a normal bounded result, not an error. After it successfully reads an Answer, the extension clears only that Answer's matching answer-ready widget.

Pagination cursors are opaque, compact, stateless, and bound to the original query. Copy them unchanged into the next call with the same filters; malformed or cross-query cursors are rejected.

See [`docs/protocol.md`](docs/protocol.md) for exact view and authorization semantics.

## Question Chat

For a pending Postbox Question, click **Question Chat** to activate Question Chat explicitly. Activation creates a private runtime on the originating Pi machine, but it does not start an automatic model turn or response. Send a freeform message or choose a starter: **Elaborate**, **Pro–Cons**, or **Teach me**.

Question Chat starts only from an exact fork of the originating Pi Session at the question's recorded leaf. If the source session path or leaf is unavailable, activation reports the precise failure and no reconstructed or context-only conversation is created. A `/reload` or process restart aborts the active turn but preserves and recovers the temporary exact fork through its recovery manifest when possible.

The assistant can use only bounded, read-only repository evidence tools: `repository_read`, `repository_grep`, `repository_find`, and `repository_list`. They are limited to the originating Git worktree, or to the originating cwd subtree outside Git, and expose neither a shell nor file mutation. A proposal made with the answer tool appears as **Suggested in Chat**. It is a server-validated option, not a selected answer; the user must still choose or submit it.

If the extension goes offline, an already-open dashboard retains its rendered messages but disables Question Chat commands and offers **Retry**; commands are not queued. A fresh dashboard cannot load the private Question Chat transcript while the extension is offline. **Stop** aborts only the current turn, preserves already-streamed output, and leaves Question Chat ready for another message.

An answered request, a cancelled request, expiry, or Pi Session replacement through `/new`, `/resume`, `/fork`, or quit aborts the runtime and deletes the temporary private transcript and recovery manifest. Resolved History retains the chosen answer and any proposed option, including **Suggested in Chat**, but contains no Question Chat transcript, hidden reasoning, tool arguments, or tool output.

## Server configuration

Supported server flags and environment variables:

- `--host` or `PI_POSTBOX_HOST` (default `127.0.0.1`)
- `--port` or `PI_POSTBOX_PORT` (fixed canonical default `32187`; startup fails if the configured port is already in use)
- `--ui-dist-dir` or `PI_POSTBOX_UI_DIST_DIR` (default packaged `dist/public` beside the server CLI)
- `--database` or `PI_POSTBOX_DATABASE` (default `~/.pi-postbox/postbox.sqlite`)
- `--profile` or `PI_POSTBOX_PROFILE` (`production` or `development:<checkout-id>`)
- `--profile-state-dir` or `PI_POSTBOX_PROFILE_STATE_DIR` (isolated state root)
- `--session-hide-offline-after-ms` or `PI_POSTBOX_SESSION_HIDE_OFFLINE_AFTER_MS` (default 24 hours; offline sessions older than this leave state snapshots)
- `--session-retention-ms` or `PI_POSTBOX_SESSION_RETENTION_MS` (default 30 days; offline sessions older than this are deleted unless ask requests still reference them)

## Extension configuration

The extension resolves a server profile from the loaded package. Installed npm/git packages use `production` and `~/.pi-postbox/config.json`; a trusted checkout-local package uses `development:<checkout-id>` and `~/.local/state/pi-postbox/dev/<checkout-id>/config.json`. `PI_POSTBOX_URL` remains an explicit override:

```json
{
  "serverUrl": "http://127.0.0.1:32187",
  "autoWake": true
}
```

Answer auto-wake is enabled by default. Set `"autoWake": false` in the profile config, or set `PI_POSTBOX_AUTO_WAKE=off`, to keep widget-only notifications without starting an agent turn. `PI_POSTBOX_AUTO_WAKE=on` overrides a disabled config value.

Override config location with `PI_POSTBOX_CONFIG_PATH` or `PI_POSTBOX_CONFIG_DIR`. The extension creates a generated machine id on first startup and persists it in this config file. That generated machine id is stable across sessions; hostname and dashboard aliases provide human-readable names.

For local self-healing, each profile publishes only `<profile-state-dir>/active-local/server.json`. The extension validates that record against `/healthz` profile, instance, URL, protocol, and build identity. Health reports the package version separately from the protocol version, while the default build id fingerprints the loaded runtime bytes. It never orders or falls back across profiles. A global production loopback `serverUrl` is therefore invisible to a checkout development profile, while `PI_POSTBOX_URL` remains an intentional escape hatch.

`npm run dev` derives the checkout identity, binds its API to the canonical development port `45795` (or an explicit `PI_POSTBOX_PORT`), selects and persists a separate Vite/HMR port in the checkout profile's `dev-ports.json`, uses its own database and metadata, and never stops production. If the API port is occupied, startup fails instead of changing the API URL; the Vite port may be safely reselected and persisted. The launcher relies on the server's content-specific build fingerprint instead of assigning one static build id to the checkout. It exposes the development API through Tailscale Serve when available and non-conflicting, using the API's separate port so the production mapping remains untouched. Set `PI_POSTBOX_TAILSCALE=off` to disable this exposure. The canonical API port is shared intentionally, so separate clones/worktrees need explicit distinct `PI_POSTBOX_PORT` values if run concurrently. The dashboard title and persistent accessible `Development server` badge come from authoritative `/healthz` profile state.

Package-local autostart is enabled by default for `write_question` and the user-only `/postbox` dashboard command. Set `PI_POSTBOX_AUTOSTART=off` to disable spawning a bundled server. Set `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` to change the recovery wait; the default is 10 seconds (`10000` ms).

Pi `/reload` can retain native ESM dependencies imported by an extension, including an older shared Postbox protocol package. After changing or upgrading shared protocol code, fully restart Pi rather than relying on `/reload`. If profile metadata and `/healthz` prove that the exact live profile server uses a different protocol from the loaded extension runtime, Postbox suppresses package-local autostart and returns full-Pi-restart guidance instead of spawning a competing profile owner.

Repo-local project display metadata can be set with `.pi-postbox.json`:

```json
{
  "name": "Friendly Project",
  "description": "Shown in Postbox",
  "icon": "assets/icon.svg"
}
```

Icon paths are resolved by the extension and uploaded as small data URLs plus hashes; the server never reads files from the Pi machine filesystem.

## Health and status endpoints

- `GET /healthz` — health/status for wrappers and monitors.
- `GET /api/state` — current sessions and pending-question snapshot.
- `GET /api/state/events` — authoritative SSE bootstrap and live pending-state snapshots.
- `GET /api/requests?status=pending` — ask request list.
- `GET /api/history` — recent terminal decision history.

## Tailscale Serve deployment

Pi Postbox v1 uses a **Tailscale-only** trust boundary with **no app-level authentication**. Anyone who can reach the HTTP service can read cards/history and submit answers. The server still blocks cross-origin browser pivots for state-changing HTTP/WebSocket actions and enforces finite payload/icon limits, but that is CSRF/abuse protection — not user authentication.

Question Chat also spends model tokens and can request tightly scoped, read-only evidence from the originating Git worktree (or cwd subtree outside Git). Its custom read/grep/find/list tools deny ignored, secret-like, out-of-scope, and directory-symlink paths and expose no shell or mutation capability. Tailnet access must therefore be limited to people and devices trusted with both Postbox decisions and this bounded repository-read consequence.

`pi-postbox-server` now performs automatic Tailnet-private Tailscale Serve exposure when the `tailscale` CLI is installed, logged in, and non-conflicting. Startup inspects `tailscale serve status --json` first, then uses a command shaped like `tailscale serve --bg --https 32187 http://127.0.0.1:32187` for the actual bound port. The integration is non-clobbering: if another service already owns that HTTPS port, Postbox reports a conflict and leaves the mapping unchanged.

Disable automatic Serve mutation with `--no-tailscale` or `PI_POSTBOX_TAILSCALE=off`. Check local/Tailnet state without starting a server with:

```bash
pi-postbox-server status
pi-postbox-server status --json
export PI_POSTBOX_URL="https://your-postbox.tailnet.example:32187"
```

Remote Pi machines remain explicit: copy the `export PI_POSTBOX_URL=` line from startup or status output. lizardtail remains useful as a generic wrapper for custom workflows, including intentional public exposure outside Postbox's automatic path.

See [`docs/configuration.md`](docs/configuration.md), [`docs/deployment.md`](docs/deployment.md), and [`docs/protocol.md`](docs/protocol.md) for operator details, endpoint contracts, and manual testing.

## Local fallback commands and status

While `write_question` is pending, the extension shows compact command hints. Operators can answer locally without starting an automatic model turn:

```text
/postbox-status
/postbox-answer [requestId] value[,value2] [--note text]
/postbox-cancel [requestId] [--note text]
```

`/postbox-status` reports privacy-preserving operator status: connectivity, active local URL when known, Tailnet URL/export guidance when available, exact server version/protocol/instance/build identity, open-question count, autostart state, and diagnostics. Reconnect diagnostics show their delay and target; an origin-pinned Question shows the deferred target and bounded affinity interval. It does not dump pending question contents, options, answers, notes, or history. The read-only `postbox_status` tool exposes the same structured status for agents without leaking question text.

Use the exact user command `/postbox` to open the active Postbox dashboard in your browser. `/postbox` is a user-only/manual browser-opening command; browser opening is not exposed to LLM tools or agent tool side effects.

Terminology note: an explicit non-loopback URL is a configured URL whose host is not localhost/loopback, typically a Tailnet or hosted Postbox URL.

## Explicit agent waiting and capacity

`wait_for_postbox` is an explicit idle/blocked mode, not a required follow-up to every `write_question`. Use it only after all independent work is exhausted and a human Postbox decision is the sole blocker. Call it once; do not emulate waiting by repeatedly calling status/list tools or `get_answer`. It suspends until any Question owned by the calling agent has an Answer or another actionable lifecycle event, after which the agent reads the relevant Answer with `get_answer`.

The tool accepts no Question IDs and is cancellable. In the Pi adapter each measured active wait retains exactly one configured runnable-agent slot: filling all configured slots with waiting children blocks an additional child until one wait wakes or is cancelled. A parent or operator should cancel or abort a waiting child to release capacity; cancellation clears only the ephemeral wait and leaves Questions and Answers durable. Likewise, aborting a completed `write_question` tool turn after its persistence acknowledgement must not cancel the durable Question.
