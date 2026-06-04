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

The server binds to `127.0.0.1`, prefers port `3000`, stores data in `~/.pi-postbox/postbox.sqlite`, and prints the actual listening URL. If port `3000` is already in use, it automatically selects another local port; open the printed URL.

## Workspace commands

```bash
npm test          # Vitest integration/behavior tests
npm run typecheck # TypeScript project references
npm run build     # build server/protocol/extension and Vite UI
npm run smoke     # packaged-path release smoke test
```

The smoke script starts the built CLI with a temporary SQLite database, connects a fake extension, verifies `/healthz`, opens `/api/state/events`, registers a session, creates and answers an ask, verifies `/api/state`, and confirms `/api/history` contains the answered request.

## Packages

This repo uses npm workspaces:

- `@pi-postbox/protocol` — shared Zod schemas and TypeScript types.
- `@pi-postbox/server` — Fastify server package exposing the `pi-postbox-server` binary.
- `@pi-postbox/extension` — Pi extension package advertising `pi.extensions` for `ask_postbox`.
- `@pi-postbox/web` — Vite React Tailwind browser UI.

Source-checkout install for Pi extension development:

```bash
npm install
npm run build
pi install /absolute/path/to/pi-postbox
```

Published extension package install shape:

```bash
pi install npm:@pi-postbox/extension
```

Installed server package run shape:

```bash
pi-postbox-server
```

## Server configuration

Supported server flags and environment variables:

- `--host` or `PI_POSTBOX_HOST` (default `127.0.0.1`)
- `--port` or `PI_POSTBOX_PORT` (preferred default `3000`; falls back to another local port if already in use)
- `--ui-dist-dir` or `PI_POSTBOX_UI_DIST_DIR` (default packaged `dist/public` beside the server CLI)
- `--database` or `PI_POSTBOX_DATABASE` (default `~/.pi-postbox/postbox.sqlite`)
- `--ask-timeout-ms` or `PI_POSTBOX_ASK_TIMEOUT_MS` (default 12 hours)
- `--history-retention-max-age-ms` or `PI_POSTBOX_HISTORY_RETENTION_MAX_AGE_MS`
- `--history-retention-max-records` or `PI_POSTBOX_HISTORY_RETENTION_MAX_RECORDS`

## Extension configuration

The extension reads `PI_POSTBOX_URL` or `~/.pi-postbox/config.json`:

```json
{
  "serverUrl": "http://127.0.0.1:3000"
}
```

Override config location with `PI_POSTBOX_CONFIG_PATH` or `PI_POSTBOX_CONFIG_DIR`. The extension creates a generated machine id on first startup and persists it in this config file. That generated machine id is stable across sessions; hostname and dashboard aliases provide human-readable names.

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

## Tailscale/lizardtail deployment

Pi Postbox v1 uses a **Tailscale-only** trust boundary with **no app-level authentication**. Anyone who can reach the HTTP service can read cards/history and submit answers. The server still blocks cross-origin browser pivots for state-changing HTTP/WebSocket actions and enforces finite payload/icon limits, but that is CSRF/abuse protection — not user authentication.

Use `lizardtail postbox` to launch `pi-postbox-server`, detect the actual local port it prints, and expose that port privately through Tailscale Serve by default:

```bash
lizardtail postbox
```

Pass `--public` only when you intentionally want Tailscale Funnel public internet exposure. Then configure Pi sessions with the lizardtail/Tailscale URL:

```bash
export PI_POSTBOX_URL="https://your-postbox.tailnet.example"
```

See [`docs/configuration.md`](docs/configuration.md), [`docs/deployment.md`](docs/deployment.md), and [`docs/protocol.md`](docs/protocol.md) for operator details, endpoint contracts, and manual testing.

## Local fallback commands

While `ask_postbox` is pending, the extension shows compact command hints. Operators can answer locally without opening an automatic prompt:

```text
/postbox-status
/postbox-answer [requestId] value[,value2] [--note text] [--rationale text]
/postbox-cancel [requestId] [--note text] [--rationale text]
```
