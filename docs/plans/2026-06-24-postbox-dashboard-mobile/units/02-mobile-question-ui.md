# Unit 02 — Mobile-first question UI, sticky footer, animated context

Current state: WAITING ON Unit 01.

Contract / acceptance criteria:
- Question view works mobile-first: narrow screens stack cleanly, avoid clipped actions/sidebar, preserve readable spacing, and adapt upward for foldable/tablet widths.
- Project/branch footer in the question view is sticky to the bottom of its scroll container/viewport while content scrolls.
- Context is closed by default.
- Clicking/tapping context opens an animated ease-in-out expansion/panel; Escape/backdrop/close button close it.
- Honor Magic V3/foldable concern: layout should not be a desktop-only sidebar+main; medium/wide foldable widths should remain readable and not waste/clip content.

Likely files/surfaces:
- `apps/web/src/App.svelte` root shell.
- `apps/web/src/components/Sidebar.svelte` responsive width/ordering.
- `apps/web/src/components/MainView.svelte` scroll container.
- `apps/web/src/components/QuestionLayoutSpotlight.svelte` footer/context/actions responsive behavior.
- `apps/web/src/components/RichContext.svelte` details defaults/animation if used inline.
- `apps/web/src/styles.css` for any reusable transitions/media helpers.

Targeted validation:
- Component/helper tests where feasible.
- `npm run typecheck` and/or `npm run build` after UI changes.
- Product evidence: browser screenshot if Chrome/Chromium available; otherwise verifier should provide build output and DOM/CSS rationale/fallback evidence.

Non-goals:
- No authentication or server API changes.
- No new design system package.

Artifacts:
- RED: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-red.md`
- GREEN: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-green.md`
- REVIEW: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-review.md`
- VERIFY: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-verify.md`

## Added requirement after initial GREEN
- On mobile, the sidebar must be hidden behind a hamburger menu instead of appearing as a list at the top of the page.
- Desktop/tablet-wide layout should still show the sidebar persistently at the side.

Additional artifacts:
- Hamburger RED/REPAIR may be recorded in `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/02-hamburger-red.md` and `02-hamburger-green.md` or folded into `02-repair.md`.
