# Unit 04 — Extension target resolver and initial selection

Status: complete

Parent source plan unit: U4 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: replace extension startup's static `serverUrl` selection with an active-local resolver that preserves explicit remote intent, recovers stale/missing loopback configuration through Unit 01/02 metadata, and exposes sanitized diagnostics when no target is available.

Acceptance criteria:
- Effective env-over-config precedence remains: `PI_POSTBOX_URL` overrides config file `serverUrl`.
- Explicit non-loopback configured URLs (Tailscale/HTTPS/LAN/hosted) are authoritative and must not be replaced by local metadata at startup. Active-local polling/supervision should be disabled for this selection.
- Loopback configured URLs are recoverable: fresh health-verified active-local metadata outranks stale or secondary loopback config.
- Missing configured URL can still resolve to fresh health-verified active-local metadata.
- Resolver reads only fixed `active-local/dev.json` and `active-local/production.json` under the existing config base convention (`PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`). It must not scan arbitrary files or add a new public active-local directory override.
- Resolver applies v1 filesystem safety before trusting metadata: no symlinked role files, bounded read size, schema/role validation via protocol helpers, fixed filenames, and sanitized diagnostics.
- Metadata candidates are accepted only after bounded `/healthz` verification with expected service/protocol and exact matching `localTarget` identity (role, instance id, normalized URL). Do not follow redirects.
- Role precedence is dev over production while fresh/healthy; production is fallback when dev is absent/stale/unhealthy.
- Configured loopback fallback may be selected only after health verification, and should be reported as `configured-loopback`, not active-local recovery.
- Extension startup uses the resolver result: when selected, it creates/registers a `PostboxClient` with the resolved URL; when unavailable, status/unavailable ask rationale includes sanitized active-local diagnostics rather than only `Postbox not configured`.
- If no configured URL and no active metadata exists at session start, an extension-level local supervisor is eligible to keep checking and create/register a client when metadata later appears. This is no-client startup recovery only; live retargeting of an already-connected client belongs to Unit 05.

Non-goals:
- Do not implement live retargeting/reconnect of an already-connected `PostboxClient` when metadata changes; Unit 05 owns that.
- Do not implement target affinity for sent asks/local fallback resolutions; Unit 05 owns that.
- Do not add Tailscale Serve/status, docs updates, or package docs fixes; later units own those.
- Do not broaden filesystem hardening into platform-specific ownership/hardlink enforcement unless straightforward and non-disruptive; v1 diagnostics are best-effort beyond symlink/size/schema.
- Do not silently rewrite or downgrade explicit non-loopback URLs.

Likely files/surfaces:
- Create: `packages/extension/src/activeLocalTargetResolver.ts`
- Modify: `packages/extension/src/config.ts`
- Modify: `packages/extension/src/index.ts`
- Modify: `packages/extension/src/tools/askPostbox.ts` only if needed to surface unavailable diagnostics cleanly
- Test: `packages/extension/test/activeLocalTargetResolver.test.ts`
- Test: `packages/extension/test/extension.test.ts`
- Test: `packages/extension/test/askPostbox.test.ts` only if unavailable formatting changes

Relevant existing code:
- `packages/extension/src/config.ts` currently returns only `{ serverUrl }` after env-over-config precedence.
- `packages/extension/src/index.ts` currently calls `readExtensionConfig`, reports `Postbox not configured` when `serverUrl` is absent, and constructs `PostboxClient` with a fixed URL.
- `packages/extension/src/tools/askPostbox.ts` formats unavailable results from the extension's registered tool path.
- `packages/protocol/src/activeLocal.ts` owns pure metadata schemas, URL normalization, role precedence, staleness checks, and diagnostics.
- `packages/protocol/src/health.ts` now supports optional `localTarget`; metadata-based resolver candidates must require it exactly.
- Unit 02 server publisher writes fixed role metadata under the same config base and sets `/healthz.localTarget` after final bind.

Targeted validation commands for role agents:
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts`
- `npm run typecheck -w @pi-postbox/extension`
- Consider protocol targeted tests if resolver imports new protocol helpers in a way that needs coverage.

Safety constraints:
- Parent coordinator must not run validation directly; role agents run validation.
- Tests should use temporary config directories and fake HTTP health servers/fetch implementations; never read/write real `~/.pi-postbox`.
- Health probes should be tightly bounded and no-redirect. Tests should avoid relying on external network or proxy settings.
- Do not leak full metadata paths, raw metadata, credentials, query strings, env values, command lines, or database paths in model-visible diagnostics.

Suggested RED focus:
- Resolver unit tests for explicit remote no-hijack, missing config selecting fresh dev over production, stale/unhealthy dev falling back to healthy production, dead loopback config recovering to production metadata, healthy configured loopback fallback when no metadata exists, symlink/oversized/malformed/unsafe metadata diagnostics, and health identity mismatch rejection.
- Extension startup integration test proving fresh active-local metadata works when no `serverUrl` is configured (i.e. no more `Postbox not configured` in that case).
- Unavailable `ask_postbox`/status diagnostic test proving no metadata + dead loopback config reports a sanitized active-local rationale.

Phase artifacts:
- RED: `../artifacts/04-red.md`
- GREEN: `../artifacts/04-green.md`
- REVIEW: `../artifacts/04-review.md`
- REPAIR: `../artifacts/04-repair.md` if needed
- VERIFY: `../artifacts/04-verify.md`

Current phase: complete.

Latest validation: VERIFY passed. Targeted extension resolver/startup/ask tests, extension typecheck, protocol targeted tests/typecheck, full extension test sweep, and full workspace typecheck passed. See `../artifacts/04-verify.md`.

Risks:
- Unit 04 is larger than prior units. Keep scope to startup/initial selection and no-client recovery; do not start Unit 05 live retargeting.
- Resolver tests can become brittle if they assert exact prose. Prefer stable diagnostic category codes plus a small sanitized human summary.
- Existing extension construction may need small dependency injection/test seams for fetch, timers, WebSocket, or client construction. Keep seams narrow and production defaults unchanged.
- `npm test` currently has an unrelated package docs failure about `lizardtail postbox`; do not treat it as a Unit 04 blocker unless this unit touches those docs/tests.
