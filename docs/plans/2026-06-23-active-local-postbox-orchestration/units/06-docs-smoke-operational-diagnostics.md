# Unit 06 — Docs, smoke coverage, and operational diagnostics

Status: complete

Parent source plan unit: U6 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: make the active-local routing model discoverable to operators and add package/smoke coverage so active-local behavior is documented and safe for release packaging.

Acceptance criteria:
- Operator docs explain the active-local routing model: role-scoped metadata files, `dev` precedence over `production`, production fallback, stale/unhealthy rejection, and no broad discovery/port scanning.
- Docs describe the config base/path convention: `PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`; active-local files live under `<base>/active-local/dev.json` and `production.json`.
- Docs describe server role configuration (`--active-local-role`, `PI_POSTBOX_ACTIVE_LOCAL_ROLE`), default `production`, and dev launcher role behavior.
- Docs update the preferred default server port from `3000` to `32187` everywhere touched by operator guidance/examples, while still explaining fallback-to-free-port behavior.
- Docs describe extension selection rules: effective env-over-config precedence; explicit non-loopback `PI_POSTBOX_URL`/`serverUrl` is authoritative and disables local polling/retargeting; loopback/missing config can recover through fresh health-verified active-local metadata; configured loopback fallback is health-verified.
- Docs describe live retargeting and target affinity: running local sessions follow selected active-local target when safe; sent asks and local fallback answer/cancel resolutions pin their origin until resolved/flushed/expired/released by bounded deadline; deferred switching diagnostics may appear.
- Docs describe sanitized operational diagnostics categories enough for operators to understand stale config, no active local server, unsafe/malformed metadata, health mismatch, explicit remote selection, configured-loopback fallback, and deferred switching.
- Protocol docs describe optional `/healthz.localTarget` identity and note active-local metadata candidates require exact role/instance/url identity match.
- Deployment docs preserve the Tailscale/lizardtail trust boundary and clarify Tailscale/hosted URLs are explicit remote targets, not local recovery candidates. Do not implement or document automatic Tailscale Serve as already available in this unit; Unit 07 owns that.
- `README.md` quick-start/configuration examples align with `32187` and active-local local behavior at a concise level.
- `packages/server/test/packageDocs.test.ts` asserts the new active-local docs expectations and is no longer anchored to stale-only `3000`/old lizardtail-specific wording.
- `scripts/smoke-postbox.mjs` uses an isolated temporary Postbox config directory (for metadata/config/machine id) so smoke never touches real `~/.pi-postbox`, and tolerates/verifies active-local health identity when present without becoming brittle.

Non-goals:
- Do not implement `pi-postbox-server status` CLI or Tailscale Serve/status; Unit 07 owns offline status/Tailscale exposure.
- Do not change active-local protocol/server/extension behavior except for smoke-test isolation compatibility if necessary.
- Do not change package publish metadata beyond docs/tests/smoke needs.
- Do not remove lizardtail as a manual deployment alternative unless explicitly required by docs consistency; automatic Tailscale is later scope.

Likely files/surfaces:
- Modify: `docs/configuration.md`
- Modify: `docs/deployment.md`
- Modify: `docs/protocol.md`
- Modify: `README.md`
- Modify: `scripts/smoke-postbox.mjs`
- Modify: `packages/server/test/packageDocs.test.ts`
- Possibly modify docs/PRD only if needed for consistency, but prefer the operator docs above.

Relevant existing code/docs:
- `packages/server/src/cli.ts` currently owns `--active-local-role`, `PI_POSTBOX_ACTIVE_LOCAL_ROLE`, default role, preferred port `32187`, and metadata publishing.
- `packages/server/src/activeLocalTarget.ts` owns metadata file writing/path behavior.
- `packages/protocol/src/activeLocal.ts` owns active-local URL/record diagnostics and selection helpers.
- `packages/protocol/src/health.ts` owns optional `localTarget` health identity.
- `packages/extension/src/activeLocalTargetResolver.ts` owns selection, sanitized diagnostics, and explicit remote/no-hijack behavior.
- `packages/extension/src/client/PostboxClient.ts` owns live retargeting/deferred switch behavior.
- Current docs still mention `3000` as default in several places and frame lizardtail as the only exposure path; keep manual lizardtail guidance but update local defaults/active-local behavior.
- Existing `packages/server/test/packageDocs.test.ts` is a docs expectation test and should be extended/refreshed rather than bypassed.

Targeted validation commands for role agents:
- `npm test -- packages/server/test/packageDocs.test.ts`
- `npm run typecheck -w @pi-postbox/server` if smoke script/package docs changes touch server TS-adjacent package expectations (likely not required for docs-only but safe later)
- `npm run build && npm run smoke` only if the role agent judges it safe/bounded after smoke script changes; use temp directories and note if build/smoke is skipped in RED.
- Consider a source grep for lingering `preferred default 3000` / `serverUrl": "http://127.0.0.1:3000"` examples in docs.

Safety constraints:
- Parent coordinator must not run validation directly; role agents run validation.
- Smoke tests must use temporary config/database directories and must not read/write real `~/.pi-postbox`.
- Avoid real Tailscale invocation in this unit.
- Do not launch long-running servers outside the smoke script; if smoke is run, it must clean up spawned processes and temp dirs.
- Keep docs wording concise and operator-oriented; do not freeze exact prose in tests beyond stable concepts/phrases.

Suggested RED focus:
- Update `packages/server/test/packageDocs.test.ts` with failing assertions for active-local docs concepts:
  - `32187` preferred default;
  - `active-local/dev.json` and `active-local/production.json` path convention;
  - `PI_POSTBOX_ACTIVE_LOCAL_ROLE` / `--active-local-role`;
  - explicit non-loopback URL remains authoritative / Tailscale URLs are not local recovery candidates;
  - optional `/healthz.localTarget` identity and exact match requirement;
  - sent asks/local fallback resolutions pin origin with bounded release/deferred switching;
  - temp config isolation for smoke.
- Add or adjust smoke tests/inspection to fail until `scripts/smoke-postbox.mjs` sets `PI_POSTBOX_CONFIG_DIR` to its temp directory and confirms health either has no `localTarget` or has matching active-local identity for the launched server.
- Run targeted package docs test and, if practical, a static smoke-script assertion or package docs assertion rather than a full build/smoke in RED.

Phase artifacts:
- RED: `../artifacts/06-red.md`
- GREEN: `../artifacts/06-green.md`
- REVIEW: `../artifacts/06-review.md`
- REPAIR: `../artifacts/06-repair.md` if needed
- VERIFY: `../artifacts/06-verify.md`

Current phase: complete.

Latest validation: VERIFY passed. Package docs/active-local/dev-launcher tests, smoke/dev syntax checks, server typecheck, source/grep inspections, synthetic busy-port dev-launcher check, `npm run smoke` against existing packaged assets, and direct temp-config `/healthz` API smoke passed. See `../artifacts/06-verify.md`.

Risks:
- Docs can overpromise Unit 07 automatic Tailscale Serve/status before implementation. Phrase Unit 06 as current active-local behavior and manual lizardtail/Tailscale deployment only.
- Package docs tests can become brittle if they assert long exact prose. Prefer concept substrings.
- Smoke can accidentally touch real operator config unless `PI_POSTBOX_CONFIG_DIR` is explicitly set to the temp directory.
- Broad `npm test` may still include unrelated docs/Tailscale expectations; Unit 06 should make package docs pass for current docs scope without implementing U7.
