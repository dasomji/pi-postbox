# Pi Postbox configuration

Pi Postbox has two independently configured processes:

1. `pi-postbox-server`, the standalone local HTTP service.
2. The Pi extension, which connects outbound to the server and exposes `write_question`.

## Server CLI

After building the workspace, run the server CLI with:

```bash
node packages/server/dist/cli.js
```

When installed from the public npm package for manual shell use, install the global CLI first and then run the binary:

```bash
npm install -g @wienerberliner/pi-postbox
pi-postbox-server
```

This global install is separate from `pi install npm:@wienerberliner/pi-postbox`, which installs the Pi resources and bundled package-local autostart support but does not put `pi-postbox-server` on your shell `PATH`.

The CLI prints the listening URL. Port `32187` is the fixed canonical production default; if it is already in use, startup fails instead of changing the local/Tailnet URL. Free `32187`, or deliberately configure one stable alternative with `--port` / `PI_POSTBOX_PORT`.

Supported flags and environment variables:

| Flag | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `--host` | `PI_POSTBOX_HOST` | `127.0.0.1` | HTTP listen host. Keep local by default and expose with Tailscale/lizardtail. |
| `--port` | `PI_POSTBOX_PORT` | fixed canonical `32187` | HTTP listen port. If it is already in use, startup fails instead of changing the local/Tailnet URL. |
| `--profile` | `PI_POSTBOX_PROFILE` | `production` | Server profile identity: `production` or `development:<checkout-id>`. `npm run dev` derives the development identity automatically. |
| `--profile-state-dir` | `PI_POSTBOX_PROFILE_STATE_DIR` | profile-specific | State root containing config-adjacent metadata, SQLite, locks, credentials, and the autostart `server.log`. Production uses `~/.pi-postbox`; development uses `$XDG_STATE_HOME/pi-postbox/dev/<checkout-id>`. |
| `--no-tailscale` | `PI_POSTBOX_TAILSCALE=off` | automatic Tailnet-private Serve enabled | Disable Tailscale Serve mutation for this run while keeping local startup. |
| `--ui-dist-dir` | `PI_POSTBOX_UI_DIST_DIR` | packaged `dist/public` beside the server CLI | Built Vite UI assets served by the server. Override this for source-checkout development if needed. |
| `--database` | `PI_POSTBOX_DATABASE` | `<profile-state-dir>/postbox.sqlite` | SQLite database path. Parent directories are created automatically. |
| `--session-hide-offline-after-ms` | `PI_POSTBOX_SESSION_HIDE_OFFLINE_AFTER_MS` | 24 hours | Offline sessions older than this are omitted from state snapshots. A session with a pending question stays visible regardless. |
| `--session-retention-ms` | `PI_POSTBOX_SESSION_RETENTION_MS` | 30 days | Offline sessions older than this are deleted unless durable Questions reference them. Question, revision, Answer, and read records are never pruned by this setting. |
| `--fcm-service-account` | `PI_POSTBOX_FCM_SERVICE_ACCOUNT` | `~/.pi-postbox/fcm-service-account.json` when that file exists, else unset | Path to a Firebase service-account JSON file. When set, new pending questions are also pushed to Android devices registered via `POST /api/push/fcm-tokens`. See [Android push notifications (FCM)](#android-push-notifications-fcm). |

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

The config path follows the package-selected profile. Installed npm/git packages use:

```text
~/.pi-postbox/config.json
```

A trusted local checkout uses `$XDG_STATE_HOME/pi-postbox/dev/<checkout-id>/config.json` (normally `~/.local/state/pi-postbox/dev/<checkout-id>/config.json`).

Override the config path with either:

- `PI_POSTBOX_CONFIG_PATH=/absolute/path/to/config.json`
- `PI_POSTBOX_CONFIG_DIR=/absolute/path/to/dir`

Example config:

```json
{
  "serverUrl": "http://127.0.0.1:32187",
  "autoWake": true
}
```

Answer auto-wake is enabled by default. When an Answer arrives while the owning Pi Session is not explicitly waiting, the extension durably records a wake intent, coalesces notifications arriving in the same short burst, and injects a privacy-preserving follow-up message that starts a turn if the agent is idle. The message includes Question identifiers but no Question text or Answer content. If Pi stops after recording the intent but before persisting the follow-up message, the active session branch recovers the wake after restart without duplicating already-persisted wakes.

Set `"autoWake": false` to retain the answer-ready widget without starting an agent turn. The `PI_POSTBOX_AUTO_WAKE` environment variable overrides the JSON value; accepted enabling values are `1`, `true`, `yes`, `on`, and `enabled`, while `0`, `false`, `no`, `off`, and `disabled` disable it.

The extension creates and persists a generated machine id in this same config file on first use. That generated machine id is the stable identity used by the dashboard. Hostname is also sent for display, and the dashboard can persist a friendlier machine alias.

Server payload limits are finite even though rich interviewer context is allowed: HTTP bodies and extension WebSocket messages are capped, rich text fields/options have generous schema limits, and project icons are limited to small image data URLs uploaded by the extension.

## Package provenance and profile routing

The loaded Pi package is the environment boundary. A trusted Pi Session whose cwd is inside this checkout loads the project-local package from `.pi/settings.json` and resolves `development:<checkout-id>`. An installed npm or git package resolves `production`, including git packages living in Pi's git cache. Arbitrary Git checkout detection is not used.

Each profile reads only `<profile-state-dir>/active-local/server.json`, then verifies the exact profile, instance, URL, protocol, and build identity through `/healthz`. There is no machine-global candidate ordering, cross-profile fallback, or port scanning. Legacy `active-local/dev.json` metadata is ignored.

`PI_POSTBOX_URL` remains an intentional operator override and is health/compatibility checked first. A `serverUrl` in a profile's own config is also preferred. A checkout does not read production's global config, so a global loopback `serverUrl` cannot accidentally attach local development to production. `PI_POSTBOX_CONFIG_PATH` and `PI_POSTBOX_CONFIG_DIR` are explicit overrides and should be used only when intentional.

After a Pi Session registers with a fallback/autostarted server, that session is sticky to the selected profile and endpoint: it does not migrate mid-session if a different preferred server later comes back. If the server process restarts at the same URL, reconnect accepts the replacement process and refreshes the exact instance/build identity shown by status.

Package-local autostart is enabled by default for mutating Postbox actions that need a server (`write_question` and the user-only `/postbox` dashboard command). Set `PI_POSTBOX_AUTOSTART=off` to opt out. Set `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` to control how long the extension waits for the started server; the default wait is 10 seconds (`10000` ms).

Operational diagnostics are sanitized categories such as `missing`, `stale`, `unhealthy`, `unsafe` or malformed metadata, symlink/oversized metadata, health mismatch (`health-identity-mismatch`), `incompatible-protocol`, explicit override selection, and deferred switching while pinned work drains.

Running sessions may reconnect only within their resolved profile. Sent asks and local fallback answer/cancel resolutions pin their origin endpoint until they resolve, flush, expire, or hit a bounded target-affinity release deadline; another profile is never a retarget candidate.

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

## Agent notification and explicit waiting

The `write_question` create actions return after durable persistence and include a reusable current Question handle. Agents should continue independent work and must not poll `get_answer`, `list_question_status`, or `list_questions`. With default auto-wake enabled, an Answer notification starts a privacy-preserving follow-up turn when the owning Pi Session is idle; the agent then calls `get_answer` for the notified Question identifiers. A successful Answer read clears only the matching answer-ready widget; pending and lifecycle-only reads leave Answer widgets unchanged. Multiple notifications in the batching window produce one turn.

When the decision is the sole remaining blocker during an active turn, `wait_for_postbox` can still enter explicit idle/blocked mode. The server does not send proactive Answer notifications while that owner is explicitly waiting, so the wait result resumes the existing turn without also scheduling an auto-wake follow-up. Cancelling that ephemeral wait leaves durable Questions and Answers intact. Disable auto-wake with `autoWake: false` or `PI_POSTBOX_AUTO_WAKE=off` when widget-only notification behavior is preferred.

## Local fallback commands and browser command

While a Question created through `write_question` is pending, the extension shows compact command hints. Operators can answer locally without opening an automatic prompt:

```text
/postbox-status
/postbox-answer [requestId] value[,value2] [--note text]
/postbox-cancel [requestId] [--note text]
```

`/postbox-status` reports connectivity, active/local URL, Tailnet URL/export line when available, open-question count, autostart state, and diagnostics. It is privacy-preserving: status includes counts only and never pending question contents, option labels, answers, notes, or history. The read-only `postbox_status` tool returns equivalent structured fields for agents.

Use `/postbox` to open the active dashboard in the user's browser. `/postbox` may use the same recovery/autostart path as `write_question` when disconnected, but it remains a user-only manual browser-opening command; no LLM tool or agent side effect can open the browser.

## Android push notifications (FCM)

Browser Web Push works out of the box (VAPID keys are generated and persisted automatically). Pushing to the native Android app while it is closed additionally requires Firebase Cloud Messaging:

1. Create a Firebase project and add an Android app with package name `dev.pi.postbox` (see `apps/android/README.md` for the client-side setup).
2. In Firebase project settings → Service accounts, generate a service-account key and save the JSON file as `~/.pi-postbox/fcm-service-account.json` (or your `PI_POSTBOX_CONFIG_DIR` equivalent) — the server picks it up there automatically, including autostarted servers.
3. Alternatively, point at a different location with `--fcm-service-account /path/to/key.json` or `PI_POSTBOX_FCM_SERVICE_ACCOUNT=...`.

The Android app registers its device token via `POST /api/push/fcm-tokens` after verifying the server URL. On each newly created pending ask, the server sends a high-priority, data-only FCM message (no question prompt text — the same privacy rule as browser Web Push) to every registered token. Tokens that FCM reports as unregistered are pruned automatically. Without the flag, FCM fanout is skipped and browser Web Push continues to work unchanged.

## Health and status endpoints

Useful endpoints for wrappers and manual checks:

- `GET /healthz` — server health, authoritative profile/instance identity, build id, uptime, and protocol version.
- `GET /api/state` — current sessions and ask request state snapshot.
- `GET /api/state/events` — SSE stream of validated state snapshots.
- `GET /api/requests?status=pending` — request list, optionally filtered by status.
- `GET /api/history` — terminal decision history.

## Manual configuration check

```bash
npm run build
PI_POSTBOX_DATABASE=/tmp/pi-postbox.sqlite node packages/server/dist/cli.js
# The default URL is fixed; startup fails if 32187 is already busy.
curl <printed-url>/healthz
```
