# Unit 05 VERIFY — PWA install button in sidebar

Verification result: PASS for PWA install button addition.

## Requirements checked

- Button at bottom of sidebar: PASS. `Sidebar.svelte` imports `PwaInstallButton` and renders it inside the existing sidebar `<footer>` before notification controls and Decision history. Targeted static test also asserts the footer remains bottom chrome.
- Only when `beforeinstallprompt` is available and not standalone/PWA: PASS. `PwaInstallButton.svelte` listens for `beforeinstallprompt`, calls `preventDefault()`, stores the prompt event, checks `matchMedia("(display-mode: standalone)")`, checks iOS `navigator.standalone`, clears prompt state in standalone mode, and renders only for `canInstall && !isStandalone`.
- Click calls prompt and tracks accepted/dismissed: PASS. Source calls the saved event's `prompt()`, awaits `userChoice`, records `accepted`/`dismissed`, clears the one-shot prompt, and falls back to dismissed on prompt failure. Static test covers these source contracts.
- Mobile layout preserved at source level: PASS. Sidebar remains `flex ... flex-col`; the scrollable session list remains `flex-1 overflow-y-auto`; footer remains outside the scroll region at the bottom. The install control adds content inside the existing footer and `space-y-2`, without changing the responsive aside/header/content structure.
- Scope not widened by Unit 05: PASS for the install-button slice. Observed relevant Unit 05 changes are `PwaInstallButton.svelte`, `Sidebar.svelte`, and `pwaInstallButton.static.test.ts`; the working tree also contains broader PWA/push work from earlier units.

## Commands run

- `npx vitest run apps/web/src/pwaInstallButton.static.test.ts` — PASS, 1 file / 3 tests.
- `npx vitest run apps/web/src/pwaShell.static.test.ts apps/web/src/clientNotificationUi.static.test.ts apps/web/src/lib/pushNotifications.test.ts apps/web/src/api/postboxApi.push.test.ts` — PASS, 4 files / 25 tests.
- `npm run typecheck -w @pi-postbox/web` — PASS, `svelte-check found 0 errors and 0 warnings`.
- `npm run build -w @pi-postbox/web` — PASS, Vite production build completed; 157 modules transformed.
- `npm run dev -w @pi-postbox/web` — BLOCKED for evidence only because port 5173 was already in use.
- `npm exec -w @pi-postbox/web -- vite --host 127.0.0.1 --port 5174` — PASS for local browser evidence server.
- Web-browser navigation/eval/screenshot against `http://127.0.0.1:5174/` — PASS for observable UI evidence; browser loaded sidebar with install button after Chromium emitted `beforeinstallprompt`.
- `git diff --cached --quiet; echo "cached_diff_exit=$?"; git status --short` — PASS for no staged files, `cached_diff_exit=0`.

## Evidence artifacts

- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/05-install-button-sidebar.png` — browser screenshot showing the install card/button in the sidebar footer.
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/05-install-button-dismissed.png` — browser screenshot after an attempted programmatic click; app records `Install prompt dismissed.`
- Browser log evidence included Chromium's installability event message: `Banner not shown: beforeinstallpromptevent.preventDefault() called. The page must call beforeinstallpromptevent.prompt() to show the banner.`

## Skipped or limited gates

- Full `npm test` — skipped as outside the requested targeted Unit 05 verification; quick relevant web/PWA/client tests were run instead.
- Real human browser install prompt acceptance — not exercised. Headless CDP `element.click()` is not treated as a trusted user gesture, so Chromium rejected `prompt()` with `NotAllowedError`; this still exercised the component's dismissal/failure path but is not evidence of accepted install flow.
- Backend/server PWA-push tests — skipped for Unit 05 because this change is client install-button UI; relevant web/PWA/client tests were run.

## Issues found

- No blocking issues found for the Unit 05 install-button scope.

## Residual risks

- Browser install prompts are vendor-controlled and can only appear when Chromium considers the app installable; automated headless evidence verifies button visibility and dismissed/error handling, not a real accepted install flow.
- Source-level/mobile-layout verification did not include a physical mobile viewport screenshot.
- Working tree contains broad unstaged/untracked PWA/push changes from other units; this verification only assessed the install-button addition and quick adjacent client/PWA tests.

## noStagedFiles

true
