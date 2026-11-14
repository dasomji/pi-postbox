# Package provenance isolates server profiles

## Status

Accepted; extracted from the implemented checkout-profile work during POSTBOX-1.
Refines [ADR 0003](0003-combined-npm-package-and-package-local-autostart.md)'s
same-profile discovery/autostart boundary. Supersedes historical machine-global
“dev wins over production” routing; ADRs 0001–0004 otherwise remain binding.

## Decision and trade-off

Choose the Server Profile before config, discovery or autostart. Installed npm/git
packages use production; a checkout-local package loaded with cwd inside that
checkout uses a canonical-path-derived development identity. Each profile owns
state, SQLite, metadata, process resources and ports outside the worktree.

The extension never orders or falls back across profiles. An explicit
`PI_POSTBOX_URL` remains an intentional override; a global loopback config does not
silently connect checkout work to production. Health must agree with selected
profile/instance/URL/protocol/build identity. Sent work pins its origin endpoint
until completion or bounded affinity release; it is not duplicated to another
server during recovery.

This sacrifices machine-global automatic dev failover to prevent production data
migrations, mixed static/API builds and unrelated sessions being redirected.
Concurrent worktrees need explicit distinct API ports (default development 45795,
production 32187); an occupied API port fails instead of stopping production.

## Evidence and lineage

Implemented by [profile selection](../../packages/extension/src/serverProfile.ts),
[resolver](../../packages/extension/src/serverTargetResolver.ts),
[dev launcher](../../scripts/dev.mjs) and
[profile isolation tests](../../packages/server/test/profileIsolation.integration.test.ts).
The original requirement is [GitHub #85](https://github.com/dasomji/pi-postbox/issues/85).
The older [routing plan](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md)
and [brainstorm](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/brainstorms/2026-06-15-postbox-self-healing-local-port-requirements.md)
remain history, not the current precedence contract.
