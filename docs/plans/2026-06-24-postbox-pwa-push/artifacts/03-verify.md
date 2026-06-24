# Unit 03 Verification — PWA manifest/service worker installability

Verification result: PASS for Unit 03 PWA shell/service worker scope.

## requirementsChecked

- Manifest/theme metadata: PASS — `apps/web/index.html` declares `<meta name="theme-color" content="#0f172a" />` and links `/manifest.webmanifest`.
- Public manifest identity/icons/display: PASS — `apps/web/public/manifest.webmanifest` declares Pi Postbox identity, `/` start/scope, `standalone` display, theme/background colors, and 192x192 + 512x512 PNG icons. PNG header check confirmed real bundled icon dimensions.
- Service worker lifecycle/fetch/push/click: PASS — `apps/web/public/sw.js` has `install`, `activate`, `fetch`, `push`, and `notificationclick` handlers; uses `skipWaiting()`, `clients.claim()`, passthrough `fetch(event.request)`, `showNotification(...)`, notification close, and focus/open app behavior.
- Main registers service worker without requesting permission: PASS — `apps/web/src/main.ts` guards on `"serviceWorker" in navigator` and registers `/sw.js` on window load; grep/static test found no `Notification.requestPermission()` call in web source/public assets.
- Build/copy includes assets: PASS — web build emitted `index.html`, `manifest.webmanifest`, `sw.js`, and icons; root build copied them to `packages/server/dist/public`.
- Scope boundary: PASS — Unit 03 changes are confined to PWA shell metadata/assets/service-worker registration plus the static contract. Existing worktree also contains Unit 01/02 push-server changes from prior units.

## commandsRun

- `npx vitest run apps/web/src/pwaShell.static.test.ts` — PASSED; 1 file, 6 tests.
- `npm run typecheck -w @pi-postbox/web` — PASSED; `svelte-check found 0 errors and 0 warnings`.
- `npm run build -w @pi-postbox/web` — PASSED; Vite production build completed and emitted PWA assets.
- `npm run build` — PASSED; root `tsc -b`, web build, and `scripts/copy-web-to-server.mjs` completed; copied web assets to server public dist.
- `find apps/web/dist ...; find packages/server/dist/public ...; git diff --cached --quiet` — PASSED; confirmed built/copied PWA asset presence and no staged files.
- `node packages/server/dist/cli.js --host 127.0.0.1 --port 33287 --database <tmp> --ui-dist-dir packages/server/dist/public --no-tailscale` plus `curl` requests — PASSED; built server served `/`, `/manifest.webmanifest`, `/sw.js`, and icon PNGs. Transcript saved to `docs/plans/2026-06-24-postbox-pwa-push/artifacts/03-http-evidence.txt`.
- `python3` PNG header/dimension check — PASSED; icons are PNGs at 192x192 and 512x512.
- `node .../web-browser/scripts/start.js` — BLOCKED; failed because `/usr/bin/google-chrome` is not installed (`ENOENT`).
- `npm test` — FAILED first run; 36/37 files passed and 201/202 tests passed, but `packages/server/test/cli.test.ts > falls back to another local port when the preferred port is already in use` timed out in `afterEach`.
- `npx vitest run packages/server/test/cli.test.ts -t "falls back to another local port when the preferred port is already in use"` — PASSED on targeted rerun; 1 passed, 13 skipped.
- `npm test` — PASSED on full rerun; 37 files passed, 202 tests passed.
- `grep -R "Notification\.requestPermission" -n apps/web/src apps/web/public || true` — PASSED/no matches.

## evidenceArtifacts

- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/03-http-evidence.txt` — HTTP product evidence from the built server serving PWA metadata, manifest, service worker handler excerpts, and icon headers.
- Browser screenshot/install prompt evidence: BLOCKED because the available web-browser skill requires `/usr/bin/google-chrome`, which is not installed in this environment.

## skippedGates

- Browser CDP screenshot / installability prompt verification — skipped/blocked by missing Chrome/Chromium executable.
- Real push delivery from a browser push service — out of Unit 03 scope and requires browser permission/subscription UI from Unit 04 plus external push-service behavior.

## issuesFound

- No Unit 03 blocking issues found.
- Non-blocking observation: first full `npm test` run hit a transient-looking CLI test `afterEach` timeout; the targeted failing test passed immediately afterward, and a second full `npm test` passed completely.

## residualRisks

- Browser-level PWA install prompt, service-worker registration in DevTools, and actual notification click behavior were not visually verified due missing Chrome/Chromium.
- Static/HTTP evidence verifies assets and handlers, but not browser-specific install heuristics across Android/iOS.
- The transient first `npm test` timeout suggests possible pre-existing/flaky CLI shutdown behavior, though it was not reproducible on targeted or full rerun.

## noStagedFiles

true — `git diff --cached --quiet` returned exit code 0 during verification.
