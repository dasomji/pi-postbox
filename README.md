# Pi Postbox

Pi Postbox is a Pi extension and companion web service for remote human decision handoffs.

Instead of streaming full Pi Session transcripts into a dashboard, Pi Postbox focuses on Postbox Questions: Pi Sessions register their presence, report project/branch/machine metadata, and send structured questions when they need input.

The product requirements document is in [`docs/prd/pi-postbox.md`](docs/prd/pi-postbox.md).

## Current status

Issues #1-#11 provide the v1 implementation: runnable TypeScript workspace, `pi-postbox-server` CLI, Pi extension with `ask_postbox`, WebSocket session registration, SSE browser state, SQLite persistence/history, rich handoff context, semantic working/blocked/idle state, reconnect/idempotency/expiry, local terminal fallback commands, editable presentation metadata, and packaging/deployment docs plus a release smoke script. Version 0.1.6 keeps common agent reads compact, makes batch/single tool modes strict, preserves persisted Questions across turn cancellation, refreshes server identity after a same-endpoint restart, and advances the dashboard directly to the next open Question after a resolution.

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

The server binds to `127.0.0.1`, treats port `32187` as the canonical default, stores data in `~/.pi-postbox/postbox.sqlite`, and prints the actual listening URL. If port `32187` is already in use, it automatically selects another local port and prints an explicit warning that the local/Tailnet bookmark URL is non-canonical; free `32187` or set `--port` / `PI_POSTBOX_PORT` to a stable available port if you need a bookmarkable URL.

## Workspace commands

```bash
npm run dev       # isolated checkout profile: backend + Vite/HMR (see docs/deployment.md)
npm test          # Vitest integration/behavior tests
npm run typecheck # TypeScript project references
npm run build     # build server/protocol/extension and Vite UI
npm run smoke     # packaged-path release smoke test
```

The credential-free smoke script starts the built CLI with a temporary SQLite database and Postbox config directory, fetches the HTML-discovered JavaScript/CSS/PWA assets, and connects a fake extension/runtime. It verifies registration and handoff context, explicit Question Chat activation without an automatic turn, context-only interviewer fallback, streaming/tool events, Stop and resume, server-restart recovery, an answer proposal, generated-value selection, cleanup, durable state/history, and absence of the private transcript/evidence from those durable APIs.

## Packages

This repo uses npm workspaces:

- `@pi-postbox/protocol` — shared Zod schemas and TypeScript types.
- `@pi-postbox/server` — Fastify server package exposing the `pi-postbox-server` binary.
- `@pi-postbox/extension` — Pi extension package advertising `pi.extensions` for `ask_postbox`.
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

`ask_postbox` returns after durable persistence rather than waiting for a human Answer. Continue any independent work and do not poll `get_answer`, `list_question_status`, or `list_questions`: Postbox notifies the owning Pi Session when an Answer is available. If that human decision becomes the only remaining blocker, call `wait_for_postbox` once to enter explicit idle/waiting mode; after it wakes, read the relevant Question with `get_answer`.

In batch mode, put the required shared handoff context in `defaults.context`; an item may supply a complete `context` override. Batch idempotency is per Question: put a stable `requestId` on each item. A top-level batch `requestId` is invalid because Postbox does not claim an atomic batch-level idempotency contract. The server expands and validates every item before persisting independent Question records:

```json
{
  "mode": "batch",
  "defaults": {
    "context": {
      "codebaseContext": "Postbox workspace",
      "problemContext": "Choose the rollout approach"
    }
  },
  "questions": [
    { "localRef": "root", "question": "Roll out now?", "options": [{ "value": "yes", "label": "Yes" }] }
  ]
}
```

Agent query tools use small workflow-oriented results by default:

- `get_questions({ questionIds })` returns IDs, lifecycle state, ownership, hierarchy, the latest timestamp, and concurrency revisions. Pass `view: "full"` for Question text, options, and handoff context.
- `get_question_history({ questionId })` returns the initial complete snapshot, changed content sections, and non-content lifecycle/ownership/hierarchy events. Pass `view: "full"` for every immutable revision snapshot and revision event.
- `list_postbox_owners()` derives the caller's feature scope and returns at most 100 owner identities with coarse presence and scoped active/unread counts. It permits only `feature`, `worktree`, or `repository` scope and never exposes titles, paths, prompts, or context.
- `get_answer({ questionId })` returns `{ "type": "pending", "status": "pending", "questionId": "…" }` while the Question remains unresolved; this is a normal bounded result, not an error.

See [`docs/protocol.md`](docs/protocol.md) for exact view and authorization semantics.

## Question Chat

For a pending Postbox Question, click **Question Chat** to activate Question Chat explicitly. Activation creates a private runtime on the originating Pi machine, but it does not start an automatic model turn or response. Send a freeform message or choose a starter: **Elaborate**, **Pro–Cons**, or **Teach me**.

Question Chat normally starts from an exact fork of the originating Pi Session at the question's leaf. If that leaf is unavailable but the request contains the required `codebaseContext` and `problemContext`, the dashboard may offer a clearly labeled, explicit **context-only interviewer** fallback; it never silently substitutes that fallback. A `/reload` or process restart aborts the active turn but preserves and recovers the temporary fork through its recovery manifest when possible.

The assistant can use only bounded, read-only repository evidence tools: `repository_read`, `repository_grep`, `repository_find`, and `repository_list`. They are limited to the originating Git worktree, or to the originating cwd subtree outside Git, and expose neither a shell nor file mutation. A proposal made with the answer tool appears as **Suggested in Chat**. It is a server-validated option, not a selected answer; the user must still choose or submit it.

If the extension goes offline, an already-open dashboard retains its rendered messages but disables Question Chat commands and offers **Retry**; commands are not queued. A fresh dashboard cannot load the private Question Chat transcript while the extension is offline. **Stop** aborts only the current turn, preserves already-streamed output, and leaves Question Chat ready for another message.

An answered request, a cancelled request, expiry, or Pi Session replacement through `/new`, `/resume`, `/fork`, or quit aborts the runtime and deletes the temporary private transcript and recovery manifest. Resolved History retains the chosen answer and any proposed option, including **Suggested in Chat**, but contains no Question Chat transcript, hidden reasoning, tool arguments, or tool output.

## Server configuration

Supported server flags and environment variables:

- `--host` or `PI_POSTBOX_HOST` (default `127.0.0.1`)
- `--port` or `PI_POSTBOX_PORT` (preferred default `32187`; falls back to another local port if already in use)
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
  "serverUrl": "http://127.0.0.1:32187"
}
```

Override config location with `PI_POSTBOX_CONFIG_PATH` or `PI_POSTBOX_CONFIG_DIR`. The extension creates a generated machine id on first startup and persists it in this config file. That generated machine id is stable across sessions; hostname and dashboard aliases provide human-readable names.

For local self-healing, each profile publishes only `<profile-state-dir>/active-local/server.json`. The extension validates that record against `/healthz` profile, instance, URL, protocol, and build identity. Health reports the package version separately from the protocol version, while the default build id fingerprints the loaded runtime bytes. It never orders or falls back across profiles. A global production loopback `serverUrl` is therefore invisible to a checkout development profile, while `PI_POSTBOX_URL` remains an intentional escape hatch.

`npm run dev` derives the checkout identity, selects independent backend/UI ports, uses its own database and metadata, and never stops production. It relies on the server's content-specific build fingerprint instead of assigning one static build id to the checkout. It exposes the development API through Tailscale Serve when available and non-conflicting, using the API's separate port so the production mapping remains untouched. Set `PI_POSTBOX_TAILSCALE=off` to disable this exposure. Separate clones and worktrees can run concurrently. The dashboard title and persistent accessible `Development server` badge come from authoritative `/healthz` profile state.

Package-local autostart is enabled by default for `ask_postbox` and the user-only `/postbox` dashboard command. Set `PI_POSTBOX_AUTOSTART=off` to disable spawning a bundled server. Set `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` to change the recovery wait; the default is 10 seconds (`10000` ms).

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

While `ask_postbox` is pending, the extension shows compact command hints. Operators can answer locally without starting an automatic model turn:

```text
/postbox-status
/postbox-answer [requestId] value[,value2] [--note text]
/postbox-cancel [requestId] [--note text]
```

`/postbox-status` reports privacy-preserving operator status: connectivity, active local URL when known, Tailnet URL/export guidance when available, exact server version/protocol/instance/build identity, open-question count, autostart state, and diagnostics. Reconnect diagnostics show their delay and target; an origin-pinned Question shows the deferred target and bounded affinity interval. It does not dump pending question contents, options, answers, notes, or history. The read-only `postbox_status` tool exposes the same structured status for agents without leaking question text.

Use the exact user command `/postbox` to open the active Postbox dashboard in your browser. `/postbox` is a user-only/manual browser-opening command; browser opening is not exposed to LLM tools or agent tool side effects.

Terminology note: an explicit non-loopback URL is a configured URL whose host is not localhost/loopback, typically a Tailnet or hosted Postbox URL.

## Explicit agent waiting and capacity

`wait_for_postbox` is an explicit idle/blocked mode, not a required follow-up to every `ask_postbox`. Use it only after all independent work is exhausted and a human Postbox decision is the sole blocker. Call it once; do not emulate waiting by repeatedly calling status/list tools or `get_answer`. It suspends until any Question owned by the calling agent has an Answer or another actionable lifecycle event, after which the agent reads the relevant Answer with `get_answer`.

The tool accepts no Question IDs and is cancellable. In the Pi adapter each measured active wait retains exactly one configured runnable-agent slot: filling all configured slots with waiting children blocks an additional child until one wait wakes or is cancelled. A parent or operator should cancel or abort a waiting child to release capacity; cancellation clears only the ephemeral wait and leaves Questions and Answers durable. Likewise, aborting a completed `ask_postbox` tool turn after its persistence acknowledgement must not cancel the durable Question.
