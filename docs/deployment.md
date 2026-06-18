# Pi Postbox deployment with Tailscale and lizardtail

Pi Postbox v1 is designed as a plain local HTTP service. It relies on lizardtail/Tailscale or another external wrapper for network exposure, TLS, and access control.

## Security boundary

V1 intentionally uses a **Tailscale-only** trust boundary with **no app-level authentication**. Anyone who can reach the Postbox HTTP service can see sessions/questions/history and can submit answers, cancel requests, or rename machines/projects. Postbox rejects cross-origin browser state-changing requests and browser-origin extension WebSockets unless the `Origin` host matches the service host; this reduces malicious-page browser pivots but does not authenticate users or devices.

Recommended deployment rule:

- Bind `pi-postbox-server` to `127.0.0.1` or a private Tailnet-only interface.
- Expose it separately with lizardtail/Tailscale.
- Do not bind it to a public internet interface without an external auth/reverse-proxy layer.
- Access the dashboard through one canonical URL; cross-origin POST/WebSocket attempts are rejected by the server.

## Run the server locally

From a checkout:

```bash
npm install
npm run build
node packages/server/dist/cli.js
```

From an installed server package:

```bash
pi-postbox-server
```

The server binds to `127.0.0.1`, prefers port `3000`, stores data in `~/.pi-postbox/postbox.sqlite`, and prints the actual listening URL. If the preferred port is already in use, it chooses another local port; open the printed URL.

## Run in development (live HMR)

For active development of the web UI or server, use the dev orchestrator instead of a built bundle:

```bash
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) runs the full stack: the backend `pi-postbox-server` on the **canonical** port (`PI_POSTBOX_PORT`, else `3000` — the same endpoint the extension targets, so live Pi sessions talk to the dev server) plus the Vite dev server (port `5173`, with HMR). Vite proxies `/api` and `/healthz` to the backend, so the dashboard has live data while you edit source. Both share the same `~/.pi-postbox/postbox.sqlite`, so dev shows the same sessions, pending questions, and history as production.

If a production `pi-postbox-server` already holds the canonical port, the orchestrator offers to stop it: interactively when run from a terminal, or via `--force` / `POSTBOX_DEV_FORCE=1` when run non-interactively (e.g. by an agent). It stops the old server through the loopback-only `POST /admin/shutdown` endpoint, falling back to signalling the listener PID. A non-pi-postbox process on the port is never touched.

To reach the dev server over Tailscale, put lizardtail in front of the **frontend** port:

```bash
lizardtail --port 5173 npm run dev
```

`--port 5173` tells lizardtail to expose Vite (which proxies `/api` to the backend), so the whole app works through one Tailscale URL.

## Expose with lizardtail/Tailscale

Install or link `pi-postbox-server` so it is available on `PATH`, then run it behind lizardtail:

```bash
lizardtail pi-postbox-server
```

lizardtail is a generic Tailscale Serve wrapper (no Postbox-specific logic). It runs the command, detects the actual port `pi-postbox-server` prints (port `3000` by default, or its fallback if busy), and exposes that exact local port privately through Tailscale Serve. Use `lizardtail --public pi-postbox-server` only when you intentionally want Tailscale Funnel public internet exposure.

Then point remote Pi extensions at the lizardtail/Tailscale URL:

```bash
export PI_POSTBOX_URL="https://your-postbox.tailnet.example"
```

or write the extension config:

```json
{
  "serverUrl": "https://your-postbox.tailnet.example"
}
```

## Install the Pi extension

For source-checkout development:

```bash
npm install
npm run build
pi install /absolute/path/to/pi-postbox
```

The workspace root advertises the extension through its `pi.extensions` metadata. The extension package also advertises itself, so published package installs can use:

```bash
pi install npm:@pi-postbox/extension
```

The extension connects in the background and does not block Pi startup if the server is down.

## Install/run the server package

The server package exposes the `pi-postbox-server` binary:

```bash
npm exec --workspace @pi-postbox/server -- pi-postbox-server
```

After package publication, either of these shapes is expected:

```bash
npx @pi-postbox/server
# or, after a global install
pi-postbox-server
```

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

The smoke script starts `node packages/server/dist/cli.js` with a temporary SQLite database, connects a fake extension over WebSocket, verifies `/healthz`, opens `/api/state/events`, registers a session, creates an ask, answers it over HTTP, verifies the extension receives the answer, checks `/api/state`, and verifies `/api/history` contains the answered request.

## Manual test checklist

1. Start `lizardtail pi-postbox-server` and confirm Postbox prints a listening URL and `/healthz` returns `{ "ok": true }`.
2. Open the UI from a laptop/phone over the lizardtail/Tailscale URL.
3. Start Pi with `PI_POSTBOX_URL` set to the same URL.
4. Confirm the session card appears with machine/project/branch metadata.
5. Ask a test question with `ask_postbox` and answer it from the browser.
6. Confirm the Pi tool result includes only the final selected values/note/rationale.
7. Confirm the decision appears in recent history.
8. Test `/postbox-status` and `/postbox-answer` from the terminal as a fallback.
