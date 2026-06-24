# Unit 03 — PWA manifest/service worker installability

Current state: WAITING ON Unit 01/02.

Acceptance criteria:
- Web build emits a manifest and service worker.
- `index.html` includes manifest/theme metadata.
- Service worker handles install/activate/fetch safely and handles `push` + `notificationclick`.
- Build/package copy still includes PWA assets in server public dist.

Likely files:
- `apps/web/index.html`
- `apps/web/public/manifest.webmanifest`
- `apps/web/public/sw.js`
- maybe icons or generated simple SVG/PNG assets.
- `scripts/copy-web-to-server.mjs` if needed.
