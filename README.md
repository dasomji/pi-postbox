# Pi Postbox

Pi Postbox is a Pi extension and companion web service for remote human decision handoffs.

Instead of streaming every agent chat into a dashboard, Pi Postbox focuses on attention cards: Pi sessions register their presence, report project/branch/machine metadata, and send structured questions when they need input.

The product requirements document is in [`docs/prd/pi-postbox.md`](docs/prd/pi-postbox.md).

## Current status

Issues #1-#11 provide the v1 implementation: runnable TypeScript workspace, `pi-postbox-server` CLI, Pi extension with `ask_postbox`, WebSocket session registration, SSE browser state, SQLite persistence/history, rich handoff context, semantic working/blocked/idle state, reconnect/idempotency/expiry, local terminal fallback commands, editable presentation metadata, and packaging/deployment docs plus a release smoke script.

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
npm run dev       # full-stack dev with HMR: backend + Vite UI (see docs/deployment.md)
npm test          # Vitest integration/behavior tests
npm run typecheck # TypeScript project references
npm run build     # build server/protocol/extension and Vite UI
npm run smoke     # packaged-path release smoke test
```

The smoke script starts the built CLI with a temporary SQLite database and temporary Postbox config directory, connects a fake extension, verifies `/healthz`, opens `/api/state/events`, registers a session, creates and answers an ask, verifies `/api/state`, and confirms `/api/history` contains the answered request.

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

## Server configuration

Supported server flags and environment variables:

- `--host` or `PI_POSTBOX_HOST` (default `127.0.0.1`)
- `--port` or `PI_POSTBOX_PORT` (preferred default `32187`; falls back to another local port if already in use)
- `--ui-dist-dir` or `PI_POSTBOX_UI_DIST_DIR` (default packaged `dist/public` beside the server CLI)
- `--database` or `PI_POSTBOX_DATABASE` (default `~/.pi-postbox/postbox.sqlite`)
- `--active-local-role` or `PI_POSTBOX_ACTIVE_LOCAL_ROLE` (`production` by default; `npm run dev` launches the backend as `dev`)
- `--ask-timeout-ms` or `PI_POSTBOX_ASK_TIMEOUT_MS` (default 12 hours)
- `--history-retention-max-age-ms` or `PI_POSTBOX_HISTORY_RETENTION_MAX_AGE_MS`
- `--history-retention-max-records` or `PI_POSTBOX_HISTORY_RETENTION_MAX_RECORDS`
- `--session-hide-offline-after-ms` or `PI_POSTBOX_SESSION_HIDE_OFFLINE_AFTER_MS` (default 24 hours; offline sessions older than this leave state snapshots)
- `--session-retention-ms` or `PI_POSTBOX_SESSION_RETENTION_MS` (default 30 days; offline sessions older than this are deleted unless ask requests still reference them)

## Extension configuration

The extension reads `PI_POSTBOX_URL` or `~/.pi-postbox/config.json`:

```json
{
  "serverUrl": "http://127.0.0.1:32187"
}
```

Override config location with `PI_POSTBOX_CONFIG_PATH` or `PI_POSTBOX_CONFIG_DIR`. The extension creates a generated machine id on first startup and persists it in this config file. That generated machine id is stable across sessions; hostname and dashboard aliases provide human-readable names.

For local self-healing, the server publishes active-local metadata under the Postbox config base: `PI_POSTBOX_CONFIG_DIR`, else the dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`. Role files are `<base>/active-local/dev.json` and `<base>/active-local/production.json`. The extension uses effective env-over-config precedence: a configured `PI_POSTBOX_URL` or `serverUrl` is a preferred Postbox server that is tried first. If that preferred server is unreachable or unavailable, the extension may fall back to fresh health-verified active-local metadata or package-local autostart. Once the Pi Session registers with a fallback/autostarted server, the session remains attached to that server until `/reload` or restart rather than switching mid-session.

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
- `GET /api/state` — current sessions and request state snapshot.
- `GET /api/state/events` — SSE stream of state snapshots.
- `GET /api/requests?status=pending` — ask request list.
- `GET /api/history` — recent terminal decision history.
- `POST /api/history/prune` — apply configured retention.

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

While `ask_postbox` is pending, the extension shows compact command hints. Operators can answer locally without opening an automatic prompt:

```text
/postbox-status
/postbox-answer [requestId] value[,value2] [--note text] [--rationale text]
/postbox-cancel [requestId] [--note text] [--rationale text]
```

`/postbox-status` reports privacy-preserving operator status: connectivity, active local URL when known, Tailnet URL/export guidance when available, open-question count, autostart state, and diagnostics. It does not dump pending question contents, options, answers, notes, or history. The read-only `postbox_status` tool exposes the same structured status for agents without leaking question text.

Use the exact user command `/postbox` to open the active Postbox dashboard in your browser. `/postbox` is a user-only/manual browser-opening command; browser opening is not exposed to LLM tools or agent tool side effects.

Terminology note: an explicit non-loopback URL is a configured URL whose host is not localhost/loopback, typically a Tailnet or hosted Postbox URL.
