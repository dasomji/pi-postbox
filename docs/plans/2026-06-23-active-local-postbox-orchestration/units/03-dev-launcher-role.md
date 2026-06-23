# Unit 03 — Mark dev server role in `scripts/dev.mjs`

Status: complete

Parent source plan unit: U3 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: ensure source-checkout development launches publish themselves as the preferred `dev` active-local role, while ordinary `pi-postbox-server` launches remain `production`.

Acceptance criteria:
- `scripts/dev.mjs` starts the backend server with the same active-local dev role marker accepted by Unit 02 CLI parsing.
- Direct `pi-postbox-server` launches continue to default to `production` when no role marker is supplied.
- CLI role parsing accepts the marker used by the dev launcher.
- Existing dev launcher behavior remains intact: it still coordinates backend + Vite, preserves force/interactive production-stop behavior, and passes `POSTBOX_DEV_API_PORT` to the web process.
- Unit does not change dev database paths.

Non-goals:
- Do not implement extension active-local resolution or live retargeting.
- Do not implement Tailscale dev UI exposure; Unit 07 will revisit dev UI/Vite port exposure.
- Do not refactor the whole dev launcher unless a tiny test seam is needed.
- Do not change production server metadata behavior from Unit 02.

Likely files/surfaces:
- Modify: `scripts/dev.mjs`
- Test: `packages/server/test/cli.test.ts`
- Optional test: a focused dev script static/behavior test only if the repo has an appropriate convention or a minimal safe seam is introduced.

Relevant existing code:
- `scripts/dev.mjs` currently starts the backend as `pi-postbox-server --host 127.0.0.1 --port <API_PORT>` and the web process with `POSTBOX_DEV_API_PORT`.
- Unit 02 added `--active-local-role` / `PI_POSTBOX_ACTIVE_LOCAL_ROLE` parsing with default `production`.
- `packages/server/test/cli.test.ts` already covers role defaults/env/flag parsing.

Targeted validation commands for role agents:
- `npm test -- packages/server/test/cli.test.ts`
- If adding a dev-script-focused test file, include it in targeted validation.
- `npm run typecheck -w @pi-postbox/server` only if server TypeScript changed; `scripts/dev.mjs` itself is JavaScript and may not be covered by TS.

Safety constraints:
- Parent coordinator must not run validation directly; role agents run validation.
- Tests must not launch real long-running dev servers unless isolated and explicitly bounded.
- Avoid fragile assertions over large script text; prefer a small exported/testable helper only if it does not disrupt direct execution.

Phase artifacts:
- RED: `../artifacts/03-red.md`
- GREEN: `../artifacts/03-green.md`
- REVIEW: `../artifacts/03-review.md`
- REPAIR: `../artifacts/03-repair.md` if needed
- VERIFY: `../artifacts/03-verify.md`

Current phase: complete.

Latest validation: VERIFY rerun passed. Targeted CLI/dev launcher tests, repeated dev launcher stability check, server typecheck, source inspection, and stale-process check passed. See `../artifacts/03-verify-rerun.md`.

Risks:
- A purely static test of `scripts/dev.mjs` could be brittle, but launching real dev processes would be too heavy. Prefer a small deterministic helper or minimal text-level contract if no better seam exists.
- Unit 07 will later change dev Tailscale/UI exposure; this unit should only mark the backend active-local role as `dev`.
