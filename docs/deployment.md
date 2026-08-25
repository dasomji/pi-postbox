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

The installed server uses the `production` profile: it binds to `127.0.0.1`, uses fixed canonical port `32187`, stores data in `~/.pi-postbox/postbox.sqlite`, and publishes `~/.pi-postbox/active-local/server.json`. If the configured port is already in use, startup fails instead of changing the local and Tailnet URLs. Use `--port` / `PI_POSTBOX_PORT` only to configure a deliberate stable alternative.

After binding, startup tries automatic Tailnet-private Tailscale Serve for the configured bound port. It inspects `tailscale serve status --json` first and only mutates when the matching HTTPS port is free or already points at the same Postbox target. Disable this with `--no-tailscale` or `PI_POSTBOX_TAILSCALE=off`.

## Run in development (live HMR)

For active development of the web UI or server, use the dev orchestrator instead of a built bundle:

```bash
npm run dev
```

`npm run dev` derives a stable `development:<checkout-id>` profile from the canonical checkout root, builds the current protocol/backend, and starts that checkout's backend on the fixed development API port `45795` plus Vite/HMR on a separate available port. Set `PI_POSTBOX_PORT` only when a different explicit development API port is required. The launcher prints the profile identity, state directory, API URL, and dashboard URL. Vite proxies `/api` and `/healthz` to that backend.

Development state lives under `$XDG_STATE_HOME/pi-postbox/dev/<checkout-id>` (normally `~/.local/state/pi-postbox/dev/<checkout-id>`), including its SQLite database, `active-local/server.json`, and `dev-ports.json`. The launcher atomically records the selected API and Vite ports, but only the Vite port is reused as a preference on the next restart. If the canonical or explicitly requested API port is occupied, startup exits instead of changing the API URL. If the remembered Vite port is occupied, the launcher selects and records a safe replacement; an occupied explicit `POSTBOX_DEV_WEB_PORT` instead causes startup to exit. API and web ports must differ.

The development profile never reads, migrates, stops, replaces, or retargets production. Its optional non-clobbering Tailscale Serve mapping uses the separate development API port, so it does not replace the production mapping. Separate clones/worktrees receive distinct identities, but the canonical API port is intentionally shared; use distinct explicit `PI_POSTBOX_PORT` values to run multiple development checkouts concurrently.

## Tailnet-private Tailscale Serve status

Use the status command to inspect one profile's metadata, `/healthz`, and Tailscale Serve state without combining unrelated candidates:

```bash
pi-postbox-server status
pi-postbox-server status --json
```

Human status includes the profile identity, local URL, Tailnet URL when available, conflict/unavailable diagnostics, remediation, and a copy-paste line for remote Pi machines. Use `--profile development:<id> --profile-state-dir <path>` to inspect a development profile explicitly.

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

`PI_POSTBOX_URL` is an explicit override. Otherwise, the extension reads only the selected profile's config and `active-local/server.json`, and package-local autostart starts that same profile. Health negotiation validates protocol, profile, instance, URL, and build identity before connecting. A session never treats another profile as failover.

## Install the Pi package

For source-checkout development, keep the installed npm source globally and let this repository's `.pi/settings.json` shadow it after project trust:

```bash
npm install
pi list --approve     # includes project package `..`
pi list --no-approve  # includes only installed npm package
```

Run `/trust` and restart Pi if the checkout is not trusted. Inside the checkout, the local package resolves the matching development profile; outside it, the npm/git package resolves production.

The workspace root advertises the extension through its `pi.extensions` metadata. Published package installs use the single public package:

```bash
pi install npm:@wienerberliner/pi-postbox
```

`pi install npm:@wienerberliner/pi-postbox` installs the Pi resources/extension resources plus bundled package-local autostart support. The extension connects in the background and does not block Pi startup if the preferred server is down; `write_question` and `/postbox` can autostart the bundled server when needed.

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

The credential-free smoke starts `node packages/server/dist/cli.js` with a temporary SQLite database and temporary `PI_POSTBOX_CONFIG_DIR`. It fetches the exact hashed JavaScript/CSS referenced by the served HTML plus the manifest, service worker, and icons; connects a fake extension/runtime over WebSocket; and verifies `/healthz`, state and Chat SSE, registration, exact-fork activation without an automatic model prompt, streaming/tool output, Stop/resume, restart recovery, an authoritative proposal, generated-value selection, legacy handoff-context removal, terminal cleanup, state/history correctness, and non-persistence of private Chat text and repository evidence.

## Manual test checklist

1. Start `pi-postbox-server` and confirm Postbox prints a listening URL, Tailscale Serve status, and `/healthz` returns `{ "ok": true }`.
2. Open the UI from a laptop/phone over the Tailnet URL when Tailscale Serve is available.
3. Start Pi with `PI_POSTBOX_URL` set to the same URL.
4. Confirm the session card appears with machine/project/branch metadata.
5. Create a test Question with `write_question({ action: "create", ... })` and answer it from the browser.
6. Confirm `get_answer` returns only `questionId`, `answerId`, the selected option values in `answer`, and optional `note`.
7. Confirm the decision appears in recent history.
8. Test `/postbox-status` and `/postbox-answer` from the terminal as a fallback.
9. Test the read-only `postbox_status` tool and confirm it reports status/open-question count without pending question contents.
10. Run `/postbox` as a user command and confirm it opens the dashboard/browser. `/postbox` is user-only/manual browser-opening behavior and is not exposed as an LLM tool or agent side effect.
