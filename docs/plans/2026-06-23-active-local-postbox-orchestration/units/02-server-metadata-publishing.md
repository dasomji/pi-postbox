# Unit 02 — Publish server metadata and health identity

Status: complete

Parent source plan unit: U2 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: make each local `pi-postbox-server` publish its actual backend URL, role, and instance identity after binding to the final port, and expose the same identity via `/healthz`.

Acceptance criteria:
- CLI preferred default port is `32187`, while `--port` and `PI_POSTBOX_PORT` still override and busy-port fallback still uses the actual bound port.
- CLI accepts a validated active-local role option/env, defaulting to `production`; invalid role fails clearly.
- Server publishes role-scoped metadata under the existing Postbox config base, using fixed filenames from the protocol contract and no new public active-local override.
- Metadata includes version, role, safe normalized actual loopback URL, generated instance id, and fresh `updatedAt`.
- `/healthz` returns optional `localTarget` identity matching the published record once the actual listen URL is known.
- Non-loopback final URLs skip metadata publication and omit health local-target identity without failing server startup.
- Metadata writes are best-effort and safe: create active-local directory restrictively where practical, write atomically with restrictive permissions, skip clearly unsafe/symlinked role files, and do not crash startup on publication failure.
- Heartbeat/refresh only continues while this process still owns its same-role record; older same-role instances must not reclaim newer records, and shutdown cleanup must not delete a newer same-role record.

Non-goals:
- Do not implement extension metadata resolution or client retargeting.
- Do not modify `scripts/dev.mjs` in this unit except if needed to keep existing tests compiling; dev launcher role wiring belongs to Unit 03.
- Do not implement Tailscale Serve/status behavior.
- Do not add app-level authentication or change database paths.

Likely files/surfaces:
- Create: `packages/server/src/activeLocalTarget.ts`
- Modify: `packages/server/src/cli.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/activeLocalTarget.test.ts`
- Test: `packages/server/test/cli.test.ts`
- Test: `packages/server/test/app.test.ts`

Relevant existing code:
- `packages/server/src/cli.ts` parses CLI options, owns `listenWithPortFallback`, shutdown hooks, and prints the listening URL.
- `packages/server/src/app.ts` builds `/healthz`; it will need a mutable/provider-based local target identity because the app exists before the final listen URL is known.
- `packages/extension/src/config.ts` shows the existing config base convention: `PI_POSTBOX_CONFIG_PATH` overrides config file path, otherwise `PI_POSTBOX_CONFIG_DIR` or `~/.pi-postbox` plus `config.json`.
- Unit 01 protocol helpers/constants live in `packages/protocol/src/activeLocal.ts`.

Targeted validation commands for role agents:
- `npm test -- packages/server/test/activeLocalTarget.test.ts packages/server/test/cli.test.ts packages/server/test/app.test.ts`
- If that target form is too broad or unsupported, use the narrowest equivalent Vitest command and record exact command/output.
- Server package typecheck if implementation changes exported/server types: `npm run typecheck -w @pi-postbox/server`.

Safety constraints:
- Parent coordinator must not run validation directly; role agents run validation.
- Tests must isolate real operator state via temp `PI_POSTBOX_CONFIG_DIR` / `PI_POSTBOX_CONFIG_PATH` and temp/in-memory databases.
- Never write metadata outside fixed active-local role filenames.
- Do not follow symlinked metadata paths; skip publication with a diagnostic/warning behavior instead of writing through symlinks.
- Publication failures must not prevent the HTTP server from listening.

Phase artifacts:
- RED: `../artifacts/02-red.md`
- GREEN: `../artifacts/02-green.md`
- REVIEW: `../artifacts/02-review.md`
- REPAIR: `../artifacts/02-repair.md` if needed
- VERIFY: `../artifacts/02-verify.md`

Current phase: complete.

Latest validation: VERIFY passed. Targeted server tests, server typecheck, protocol tests/typecheck, server/protocol build, and built CLI/API smoke passed. See `../artifacts/02-verify.md`.

Risks:
- Tests may accidentally depend on heartbeat timers and become flaky; prefer controllable intervals/clock hooks or exported helper lifecycle objects.
- Actual Fastify listen address formatting must be normalized through Unit 01 URL helper so fallback ports are advertised accurately.
- Same-role race/cleanup logic is subtle; tests should prove older instance does not overwrite/delete newer records.
