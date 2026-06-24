# Unit 03 GREEN — PWA manifest/service worker installability

## Authoritative test decision

Kept `apps/web/src/pwaShell.static.test.ts` as the authoritative Unit 03 static contract because it is a superset of the duplicate scaffold: it covers index metadata, manifest contents, real bundled icon files, service worker behavior, app registration, production web build emission, and server public copy behavior. Removed the duplicate `apps/web/src/pwa.static.test.ts` scaffold.

## changedFiles

- `apps/web/index.html`
- `apps/web/src/main.ts`
- `apps/web/public/manifest.webmanifest`
- `apps/web/public/sw.js`
- `apps/web/public/icons/postbox-icon-192.png`
- `apps/web/public/icons/postbox-icon-512.png`
- `apps/web/src/pwaShell.static.test.ts`
- `apps/web/src/pwa.static.test.ts` (removed duplicate untracked scaffold)
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/03-green.md`

## commandsRun

- `npx vitest run apps/web/src/pwaShell.static.test.ts` — passed; 1 file, 6 tests.
- `npm run typecheck -w @pi-postbox/web` — passed; svelte-check found 0 errors and 0 warnings.
- `npm run build -w @pi-postbox/web` — passed; Vite production build emitted `index.html`, `manifest.webmanifest`, `sw.js`, assets, and icons.
- `npm run typecheck` — passed; root `tsc -b` completed successfully.
- `npm run build` — passed; root build completed and copied web assets to `packages/server/dist/public`.
- `npx vitest run 'apps/web/src/pwa*.static.test.ts'` — failed due quoted glob being treated as a literal Vitest filter; corrected with the next command.
- `npx vitest run apps/web/src/pwa*.static.test.ts` — passed; shell-expanded to the authoritative PWA static test, 1 file, 6 tests.
- `git diff --cached --quiet; echo $?` — passed/no staged files; exit code `0`.

## validationOutput

- PWA static contract: `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- Web typecheck: `svelte-check found 0 errors and 0 warnings`.
- Web build: `✓ built in 1.93s`.
- Root typecheck: `tsc -b` completed with no diagnostics.
- Root build: `✓ built in 1.86s`; `Copied web assets to /home/dev/Development/pi-daniel/extensions/dashboard/packages/server/dist/public`.
- Build/copy spot check after root build showed both `apps/web/dist` and `packages/server/dist/public` contain `index.html`, `manifest.webmanifest`, `sw.js`, and `icons/postbox-icon-{192,512}.png`.

## residualRisks

- Browser install prompt and real push notification click behavior were not manually smoke-tested in Chrome/Android; validation is static plus production build/copy output.

## reviewFindings

- info: `apps/web/src/pwa.static.test.ts` duplicated the same contract as `apps/web/src/pwaShell.static.test.ts`; removed the duplicate and kept the stricter build/copy-aware test.
- no blockers found in the Unit 03 implementation.

## noStagedFiles

true
