# Pi Postbox configuration

Pi Postbox has two independently configured processes:

1. `pi-postbox-server`, the standalone local HTTP service.
2. The Pi extension, which connects outbound to the server and exposes `ask_postbox`.

## Server CLI

After building the workspace, run the server CLI with:

```bash
node packages/server/dist/cli.js --host 127.0.0.1 --port 3000
```

When installed from an npm package, the same binary is exposed as:

```bash
pi-postbox-server --host 127.0.0.1 --port 3000
```

Supported flags and environment variables:

| Flag | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `--host` | `PI_POSTBOX_HOST` | `127.0.0.1` | HTTP listen host. Keep local by default and expose separately with Tailscale/lizard-tail. |
| `--port` | `PI_POSTBOX_PORT` | `3000` | HTTP listen port. |
| `--ui-dist-dir` | `PI_POSTBOX_UI_DIST_DIR` | packaged `dist/public` beside the server CLI | Built Vite UI assets served by the server. Override this for source-checkout development if needed. |
| `--database` | `PI_POSTBOX_DATABASE` | `data/pi-postbox.sqlite` from the current working directory | SQLite database path. Parent directories are created automatically. |
| `--ask-timeout-ms` | `PI_POSTBOX_ASK_TIMEOUT_MS` | 12 hours | Default expiry for pending asks. |
| `--history-retention-max-age-ms` | `PI_POSTBOX_HISTORY_RETENTION_MAX_AGE_MS` | unset | Optional terminal-history max age. Pending asks are never pruned. |
| `--history-retention-max-records` | `PI_POSTBOX_HISTORY_RETENTION_MAX_RECORDS` | unset | Optional maximum number of terminal history records to keep. |

## Extension configuration

The extension reads the server URL from `PI_POSTBOX_URL` first, then from the JSON config file.

Default config file path:

```text
~/.pi-postbox/config.json
```

Override the config path with either:

- `PI_POSTBOX_CONFIG_PATH=/absolute/path/to/config.json`
- `PI_POSTBOX_CONFIG_DIR=/absolute/path/to/dir`

Example config:

```json
{
  "serverUrl": "http://127.0.0.1:3000"
}
```

The extension creates and persists a generated machine id in this same config file on first use. That generated machine id is the stable identity used by the dashboard. Hostname is also sent for display, and the dashboard can persist a friendlier machine alias.

Server payload limits are finite even though rich interviewer context is allowed: HTTP bodies and extension WebSocket messages are capped, rich text fields/options have generous schema limits, and project icons are limited to small image data URLs uploaded by the extension.

## Project display override

Repos can include a `.pi-postbox.json` file to improve display metadata:

```json
{
  "name": "Friendly Project",
  "description": "Shown on Postbox cards",
  "icon": "assets/icon.svg"
}
```

The icon path is resolved by the extension on the Pi machine, converted into a small data URL/hash, and uploaded during registration. The server never assumes it can read files from the Pi machine filesystem.

## Local fallback commands

While `ask_postbox` is pending, the extension shows compact command hints. Operators can answer locally without opening an automatic prompt:

```text
/postbox-status
/postbox-answer [requestId] value[,value2] [--note text] [--rationale text]
/postbox-cancel [requestId] [--note text] [--rationale text]
```

## Health and status endpoints

Useful endpoints for wrappers and manual checks:

- `GET /healthz` — server health, service name, version, uptime, and protocol version.
- `GET /api/state` — current sessions and ask request state snapshot.
- `GET /api/state/events` — SSE stream of validated state snapshots.
- `GET /api/requests?status=pending` — request list, optionally filtered by status.
- `GET /api/history` — terminal decision history.
- `POST /api/history/prune` — apply configured terminal-history retention.

## Manual configuration check

```bash
npm run build
PI_POSTBOX_DATABASE=/tmp/pi-postbox.sqlite node packages/server/dist/cli.js --host 127.0.0.1 --port 3000
curl http://127.0.0.1:3000/healthz
```
