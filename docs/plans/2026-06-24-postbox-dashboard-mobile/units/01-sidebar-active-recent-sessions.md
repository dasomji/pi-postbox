# Unit 01 — Sidebar active/recent session filtering

Current state: READY FOR RED.

Contract / acceptance criteria:
- Sidebar project groups include all non-offline sessions regardless of semantic state (`working`, `blocked`, `idle`, `unknown`).
- Offline sessions are included only when `snapshot.timestamp - disconnectedAt < 5 minutes`.
- Offline sessions at/after 5 minutes old, or without a usable `disconnectedAt`, are hidden.
- Empty projects after filtering are not shown.
- Sorting/grouping behavior remains stable for visible sessions.

Likely files/surfaces:
- `apps/web/src/lib/store.svelte.ts` currently derives `sessions`, `projects`, `selectedSession` directly from all snapshot sessions.
- Potential helper in `apps/web/src/lib/status.ts` or store-local function for testability.
- New/updated Vitest tests under `apps/web/src/lib/*.test.ts` or nearby existing convention.

Targeted validation:
- Focused Vitest for filtering helper/store behavior.
- Broader `npm test -- --runInBand` only if targeted command is unclear/cheap.

Non-goals:
- Do not change server retention/persistence.
- Do not delete history or offline session records from API responses.

Artifacts:
- RED: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-red.md`
- GREEN: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-green.md`
- REVIEW: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-review.md`
- VERIFY: `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-verify.md`
