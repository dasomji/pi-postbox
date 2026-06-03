# Pi Postbox deployment with Tailscale and lizard-tail

Pi Postbox v1 is designed as a plain local HTTP service. It does **not** manage Tailscale, lizard-tail, TLS certificates, or user accounts itself.

## Security boundary

V1 intentionally uses a **Tailscale-only** trust boundary with **no app-level authentication**. Anyone who can reach the Postbox HTTP service can see sessions/questions/history and can submit answers, cancel requests, or rename machines/projects. Postbox rejects cross-origin browser state-changing requests and browser-origin extension WebSockets unless the `Origin` host matches the service host; this reduces malicious-page browser pivots but does not authenticate users or devices.

Recommended deployment rule:

- Bind `pi-postbox-server` to `127.0.0.1` or a private Tailnet-only interface.
- Expose it separately with lizard-tail/Tailscale.
- Do not bind it to a public internet interface without an external auth/reverse-proxy layer.
- Access the dashboard through one canonical URL; cross-origin POST/WebSocket attempts are rejected by the server.

## Run the server locally

From a checkout:

```bash
npm install
npm run build
node packages/server/dist/cli.js \
  --host 127.0.0.1 \
  --port 3000 \
  --database ~/.pi-postbox/postbox.sqlite \
  --ui-dist-dir apps/web/dist
```

From an installed server package:

```bash
pi-postbox-server \
  --host 127.0.0.1 \
  --port 3000 \
  --database ~/.pi-postbox/postbox.sqlite
```

Open the local UI at <http://127.0.0.1:3000/>.

## Expose with lizard-tail/Tailscale

Keep lizard-tail as a wrapper around the local HTTP service. The exact command depends on your lizard-tail setup, but the shape should be:

```bash
# terminal 1 or system service
pi-postbox-server --host 127.0.0.1 --port 3000 --database ~/.pi-postbox/postbox.sqlite

# terminal 2 or wrapper service
lizard-tail http://127.0.0.1:3000
```

Then point remote Pi extensions at the lizard-tail/Tailscale URL:

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
npm exec --workspace @pi-postbox/server -- pi-postbox-server --host 127.0.0.1 --port 3000
```

After package publication, either of these shapes is expected:

```bash
npx @pi-postbox/server --host 127.0.0.1 --port 3000
# or, after a global install
pi-postbox-server --host 127.0.0.1 --port 3000
```

## Health and monitoring

Use these endpoints for wrappers or manual checks:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/state
curl http://127.0.0.1:3000/api/history
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

1. Start `pi-postbox-server` locally and confirm `/healthz` returns `{ "ok": true }`.
2. Open the UI from a laptop/phone over the lizard-tail/Tailscale URL.
3. Start Pi with `PI_POSTBOX_URL` set to the same URL.
4. Confirm the session card appears with machine/project/branch metadata.
5. Ask a test question with `ask_postbox` and answer it from the browser.
6. Confirm the Pi tool result includes only the final selected values/note/rationale.
7. Confirm the decision appears in recent history.
8. Test `/postbox-status` and `/postbox-answer` from the terminal as a fallback.
