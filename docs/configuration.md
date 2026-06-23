# Pi Postbox configuration

Pi Postbox has two independently configured processes:

1. `pi-postbox-server`, the standalone local HTTP service.
2. The Pi extension, which connects outbound to the server and exposes `ask_postbox`.

## Server CLI

After building the workspace, run the server CLI with:

```bash
node packages/server/dist/cli.js
```

When installed from an npm package, the same binary is exposed as:

```bash
pi-postbox-server
```

The CLI prints the actual listening URL. Port `32187` is the preferred default; if it is already in use, the server chooses another local port and prints that URL instead.

Supported flags and environment variables:

| Flag | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `--host` | `PI_POSTBOX_HOST` | `127.0.0.1` | HTTP listen host. Keep local by default and expose with Tailscale/lizardtail. |
| `--port` | `PI_POSTBOX_PORT` | preferred `32187` | Preferred HTTP listen port. If it is already in use, the CLI falls back to another local port and prints the actual URL. |
| `--active-local-role` | `PI_POSTBOX_ACTIVE_LOCAL_ROLE` | `production` | Role written to active-local metadata. Ordinary server launches are `production`; `npm run dev` starts the backend with the `dev` role. |
| `--no-tailscale` | `PI_POSTBOX_TAILSCALE=off` | automatic Tailnet-private Serve enabled | Disable Tailscale Serve mutation for this run while keeping local startup. |
| `--ui-dist-dir` | `PI_POSTBOX_UI_DIST_DIR` | packaged `dist/public` beside the server CLI | Built Vite UI assets served by the server. Override this for source-checkout development if needed. |
| `--database` | `PI_POSTBOX_DATABASE` | `~/.pi-postbox/postbox.sqlite` | SQLite database path. Parent directories are created automatically. |
| `--ask-timeout-ms` | `PI_POSTBOX_ASK_TIMEOUT_MS` | 12 hours | Default expiry for pending asks. |
| `--history-retention-max-age-ms` | `PI_POSTBOX_HISTORY_RETENTION_MAX_AGE_MS` | unset | Optional terminal-history max age. Pending asks are never pruned. |
| `--history-retention-max-records` | `PI_POSTBOX_HISTORY_RETENTION_MAX_RECORDS` | unset | Optional maximum number of terminal history records to keep. |

## Automatic Tailnet-private Tailscale Serve

By default, production startup tries automatic Tailnet-private Tailscale Serve exposure after binding the final local port. It first inspects `tailscale serve status --json`; if the matching HTTPS port is free, it runs a command shaped like `tailscale serve --bg --https 32187 http://127.0.0.1:32187` using the actual bound port. This is best-effort and non-clobbering: missing Tailscale, logged-out state, permission errors, or an existing conflicting mapping never stop local Postbox startup.

Use `--no-tailscale` or `PI_POSTBOX_TAILSCALE=off` for CI or operators who do not want the CLI to mutate Serve state. For offline diagnostics and copy-paste remote setup, run:

```bash
pi-postbox-server status
pi-postbox-server status --json
export PI_POSTBOX_URL="https://your-postbox.tailnet.example:32187"
```

If status reports a conflict, inspect with `tailscale serve status` and choose the remediation yourself; Postbox will not overwrite another service's mapping. If Tailscale refuses permission, run `sudo tailscale set --operator=$USER` once or run the printed manual `tailscale serve --bg --https ...` command with appropriate privileges.

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
  "serverUrl": "http://127.0.0.1:32187"
}
```

The extension creates and persists a generated machine id in this same config file on first use. That generated machine id is the stable identity used by the dashboard. Hostname is also sent for display, and the dashboard can persist a friendlier machine alias.

Server payload limits are finite even though rich interviewer context is allowed: HTTP bodies and extension WebSocket messages are capped, rich text fields/options have generous schema limits, and project icons are limited to small image data URLs uploaded by the extension.

## Active-local routing

Active-local routing is local-only self-healing for stale or missing loopback config. There is no broad discovery and no port scanning: the extension reads only fixed metadata files under the Postbox config base, then verifies the selected candidate with `/healthz`.

Config base convention: `PI_POSTBOX_CONFIG_DIR`, else the dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`. Active-local role files live at `<base>/active-local/dev.json` and `<base>/active-local/production.json`; these path conventions are commonly referenced as `active-local/dev.json` and `active-local/production.json`.

Selection uses the effective env-over-config URL first. An explicit non-loopback `PI_POSTBOX_URL` or configured `serverUrl` such as a Tailscale or hosted URL is authoritative, disables active-local polling/live retargeting, and is not a local recovery candidate. A missing URL or loopback URL may recover through fresh, healthy active-local metadata. The extension prefers dev over production while the `dev` target is fresh and healthy, uses production fallback when dev is stale or unhealthy, and may use a configured-loopback fallback only after health verification.

Operational diagnostics are sanitized categories such as `missing`/no active local server, `stale`, `unhealthy`, `unsafe` or malformed metadata, symlink/oversized metadata, `health mismatch`, explicit remote selection, configured-loopback fallback, and `deferred switching` while pinned work drains.

Running local sessions support live retargeting when active-local selection changes. Active-local sent asks and local fallback answer/cancel resolutions pin their origin target until they resolve, flush, expire, or hit a bounded target-affinity release deadline; until then a target switch may be deferred.

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
PI_POSTBOX_DATABASE=/tmp/pi-postbox.sqlite node packages/server/dist/cli.js
# Use the listening URL printed by the CLI; the port may differ from 32187 if it was busy.
curl <printed-url>/healthz
```
