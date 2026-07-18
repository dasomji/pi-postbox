# Pi Postbox deployment with Tailscale and lizardtail

Pi Postbox v1 is a plain local HTTP service with automatic Tailnet-private Tailscale Serve convenience for the common private-dashboard workflow. Tailscale exposure is best-effort and non-clobbering; lizardtail remains a useful external wrapper for custom workflows.

## Security boundary

V1 intentionally uses a **Tailscale-only** trust boundary with **no app-level authentication**. Anyone who can reach the Postbox HTTP service can see sessions/questions/history and can submit answers, cancel requests, or rename machines/projects. Postbox rejects cross-origin browser state-changing requests and browser-origin extension WebSockets unless the `Origin` host matches the service host; this reduces malicious-page browser pivots but does not authenticate users or devices.

Question Chat adds model spend and scoped read-only repository evidence. Its interviewer receives only bounded custom read/grep/find/list tools rooted at the originating Git worktree (or cwd outside Git), with ignored/secret/out-of-scope paths denied and no shell or mutation tools. Treat Tailnet reachability as permission to trigger that bounded capability as well as to view and resolve Postbox Questions.

Recommended deployment rule:

- Bind `pi-postbox-server` to `127.0.0.1` or a private Tailnet-only interface.
- Use the built-in Tailnet-private Tailscale Serve path or expose it separately with lizardtail/Tailscale.
- Do not bind it to a public internet interface without an external auth/reverse-proxy layer.
- Access the dashboard through one canonical URL; cross-origin POST/WebSocket attempts are rejected by the server.

## Run the server locally

From a checkout:

```bash
npm install
npm run build
node packages/server/dist/cli.js
```

For manual shell use from the public package, install the global CLI first:

```bash
npm install -g @wienerberliner/pi-postbox
pi-postbox-server
```

This is separate from `pi install npm:@wienerberliner/pi-postbox`, which installs Pi resources and bundled package-local autostart support but does not add `pi-postbox-server` to `PATH`.

The server binds to `127.0.0.1`, treats port `32187` as the canonical default, stores data in `~/.pi-postbox/postbox.sqlite`, and prints the actual listening URL. If the preferred port is already in use, it chooses another local port and prints an explicit warning that the local/Tailnet bookmark URL is non-canonical; free `32187` or set `--port` / `PI_POSTBOX_PORT` to a stable available port if you need a bookmarkable URL. Ordinary launches publish the `production` active-local role unless `--active-local-role` or `PI_POSTBOX_ACTIVE_LOCAL_ROLE` says otherwise.

After binding, startup tries automatic Tailnet-private Tailscale Serve for the actual bound port. It inspects `tailscale serve status --json` first and only mutates when the matching HTTPS port is free or already points at the same Postbox target. Disable this with `--no-tailscale` or `PI_POSTBOX_TAILSCALE=off`.

## Run in development (live HMR)

For active development of the web UI or server, use the dev orchestrator instead of a built bundle:

```bash
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) runs the full stack: the backend `pi-postbox-server` on the **canonical** port (`PI_POSTBOX_PORT`, else `32187` — the same endpoint the extension targets, so live Pi sessions talk to the dev server) plus the Vite dev server (preferred port `5173`, with HMR; if busy, an available UI port is selected and passed to Vite). Vite proxies `/api` and `/healthz` to the backend, so the dashboard has live data while you edit source. Both share the same `~/.pi-postbox/postbox.sqlite`, so dev shows the same sessions, pending questions, and history as production. The dev launcher marks the backend as `--active-local-role dev`; active-local clients prefer dev over production while fresh/healthy and use production fallback when dev goes stale or unhealthy. Dev Tailscale Serve exposes the actual Vite UI port, not the backend API port; disable with `PI_POSTBOX_TAILSCALE=off`.

If a production `pi-postbox-server` already holds the canonical port, the orchestrator offers to stop it: interactively when run from a terminal, or via `--force` / `POSTBOX_DEV_FORCE=1` when run non-interactively (e.g. by an agent). It stops the old server through the loopback-only `POST /admin/shutdown` endpoint, falling back to signalling the listener PID. A non-pi-postbox process on the port is never touched.

## Tailnet-private Tailscale Serve status

Use the status command to inspect active-local metadata, `/healthz`, and Tailscale Serve state without starting another server:

```bash
pi-postbox-server status
pi-postbox-server status --json
```

Human status includes the local URL, role, Tailnet URL when available, conflict/unavailable diagnostics, remediation, and a copy-paste line for remote Pi machines:

```bash
export PI_POSTBOX_URL="https://your-postbox.tailnet.example:32187"
```

The automatic Serve command shape is `tailscale serve --bg --https <actual-port> http://127.0.0.1:<actual-port>`. If that mapping conflicts with another service, Postbox reports the conflict and leaves the existing Serve config untouched. Permission diagnostics include `sudo tailscale set --operator=$USER` or the printed manual `tailscale serve --bg --https ...` command.

## lizardtail/custom exposure

lizardtail is still supported as a generic Tailscale Serve wrapper (no Postbox-specific logic) when you want a custom wrapper lifecycle. Built-in Postbox startup does not require it for the default Tailnet-private case. Use lizardtail public/Funnel modes only when you intentionally want public internet exposure outside Postbox's automatic path.

Point remote Pi extensions at the printed startup/status Tailnet URL:

```bash
export PI_POSTBOX_URL="https://your-postbox.tailnet.example:32187"
```

or write the extension config:

```json
{
  "serverUrl": "https://your-postbox.tailnet.example"
}
```

Tailscale and hosted URLs are preferred Postbox servers. The extension checks the preferred server first; when it is healthy, it is authoritative for that registration and active-local polling is unnecessary. If the preferred server is unreachable or unavailable, the extension may use local fallback through fresh active-local metadata or package-local autostart. Remote URLs themselves are not local recovery candidates. Once a Pi Session registers with a local fallback/autostarted server, the session stays attached to that server until `/reload` or restart instead of switching mid-session.

## Install the Pi package

For source-checkout development:

```bash
npm install
npm run build
pi install /absolute/path/to/pi-postbox
```

The workspace root advertises the extension through its `pi.extensions` metadata. Published package installs use the single public package:

```bash
pi install npm:@wienerberliner/pi-postbox
```

`pi install npm:@wienerberliner/pi-postbox` installs the Pi resources/extension resources plus bundled package-local autostart support. The extension connects in the background and does not block Pi startup if the preferred server is down; `ask_postbox` and `/postbox` can autostart the bundled server when needed.

Autostart is enabled by default. Set `PI_POSTBOX_AUTOSTART=off` to opt out, or set `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` to change the wait for a started server; the default timeout is 10 seconds (`10000` ms).

## Install/run the manual shell CLI

From this source checkout, the server package exposes the `pi-postbox-server` binary through npm workspaces:

```bash
npm exec --workspace @pi-postbox/server -- pi-postbox-server
```

For manual shell command usage after package publication, install the same public package globally:

```bash
npm install -g @wienerberliner/pi-postbox
pi-postbox-server
```

The global npm install is only for shell `PATH` access; it is not required for Pi-installed bundled autostart.

## Health and monitoring

Use the printed local URL for wrappers or manual checks:

```bash
curl <printed-url>/healthz
curl <printed-url>/api/state
curl <printed-url>/api/history
```

`/api/state/events` is an SSE stream for browser clients and can also be used by simple monitors that understand Server-Sent Events.

## Release/readiness smoke test

Run the packaged-path smoke after a build:

```bash
npm run build
npm run smoke
```

The smoke script starts `node packages/server/dist/cli.js` with a temporary SQLite database and temporary `PI_POSTBOX_CONFIG_DIR`, connects a fake extension over WebSocket, verifies `/healthz` (including active-local identity when `localTarget` is present), opens `/api/state/events`, registers a session, creates an ask, answers it over HTTP, verifies the extension receives the answer, checks `/api/state`, and verifies `/api/history` contains the answered request.

## Manual test checklist

1. Start `pi-postbox-server` and confirm Postbox prints a listening URL, Tailscale Serve status, and `/healthz` returns `{ "ok": true }`.
2. Open the UI from a laptop/phone over the Tailnet URL when Tailscale Serve is available.
3. Start Pi with `PI_POSTBOX_URL` set to the same URL.
4. Confirm the session card appears with machine/project/branch metadata.
5. Ask a test question with `ask_postbox` and answer it from the browser.
6. Confirm the Pi tool result includes only the final selected values/note/rationale.
7. Confirm the decision appears in recent history.
8. Test `/postbox-status` and `/postbox-answer` from the terminal as a fallback.
9. Test the read-only `postbox_status` tool and confirm it reports status/open-question count without pending question contents.
10. Run `/postbox` as a user command and confirm it opens the dashboard/browser. `/postbox` is user-only/manual browser-opening behavior and is not exposed as an LLM tool or agent side effect.
