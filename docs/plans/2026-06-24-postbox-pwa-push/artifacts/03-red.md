# Unit 03 RED — PWA shell/service worker static contract

## Scope
Added a narrow static Vitest contract at `apps/web/src/pwa.static.test.ts` for Unit 03 only. The test reads:

- `apps/web/index.html`
- `apps/web/public/manifest.webmanifest`
- `apps/web/public/sw.js`
- `apps/web/src/main.ts`

No production files were implemented or changed.

## Tests added
`apps/web/src/pwa.static.test.ts`

- `advertises the installable manifest and theme color from index.html`
  - Expects `index.html` to link `/manifest.webmanifest` and declare `<meta name="theme-color" content="#......">`.
- `publishes a web manifest suitable for PWA installation`
  - Expects a valid manifest with Pi Postbox identity, app-root start/scope, installable display mode, theme/background colors, and 192/512 image icons declared from public assets.
- `publishes a safe service worker for installability, push, and notification clicks`
  - Expects install/activate/fetch handlers, safe passthrough fetch behavior, push notification display, and notification click close/open-or-focus behavior.
- `registers the service worker from the app entry without requesting notification permission`
  - Expects guarded registration of `/sw.js` from `main.ts` and no direct `Notification.requestPermission()` call.

## Command run
```sh
npx vitest run apps/web/src/pwa.static.test.ts
```

## RED result
The targeted test command failed as expected:

- Test file: `apps/web/src/pwa.static.test.ts`
- Tests: 4 failed / 4 total

Failure summary:

- `index.html` does not yet link the manifest or declare theme color metadata.
- `apps/web/public/manifest.webmanifest` is not present yet, so all manifest installability assertions are false.
- `apps/web/public/sw.js` is not present yet, so service worker lifecycle, fetch, push, and notification click assertions are false. The safe fetch passthrough assertion is true only because no unsafe cache/respondWith behavior exists in the missing source.
- `main.ts` does not yet guard for service worker support or register `/sw.js`; it also correctly does not request notification permission during app startup.

This proves the expected missing Unit 03 behavior without requiring a build or production implementation.
