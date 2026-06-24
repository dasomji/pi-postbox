# U6: Documentation, ADR alignment, and smoke coverage

## Contract
Update operator docs, README, ADR references, and smoke/package checks so the install/autostart/status/browser-command story is accurate and durable.

## Acceptance criteria
- Docs state `pi install npm:@wienerberliner/pi-postbox` installs Pi resources and bundled autostart support.
- Docs state `npm install -g @wienerberliner/pi-postbox` is needed for manual shell `pi-postbox-server` usage.
- Docs describe autostart behavior, `PI_POSTBOX_AUTOSTART=off`, `PI_POSTBOX_AUTOSTART_TIMEOUT_MS`, preferred-server fallback semantics, and session stickiness.
- Docs describe `/postbox-status`, `postbox_status`, and `/postbox`, including privacy/browser-opening boundaries.
- Package/docs tests catch install guidance and published package shape regressions.
- Smoke/package validation still proves release path sufficiently for this change.

## Non-goals
- Do not add new product behavior unless required by docs/test alignment.
- Do not publish to npm or run remote `pi install`.

## Likely files/surfaces
- `README.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/protocol.md`
- `docs/adr/0003-combined-npm-package-and-package-local-autostart.md`
- `scripts/smoke-postbox.mjs`
- `packages/server/test/packageDocs.test.ts`

## Targeted verification commands
- `npm test -- packages/server/test/packageDocs.test.ts`
- `npm run smoke` if safe
- `npm test`, `npm run typecheck`, `npm run build` as final-ish gates if feasible

## Evidence expectations
- RED artifact shows failing docs/package/smoke assertions before docs alignment.
- GREEN artifact shows docs/package tests and relevant smoke passing.

## Current state
Pending RED.

## Phase artifacts
- RED: `../artifacts/06-red.md`
- GREEN: `../artifacts/06-green.md`
- REVIEW: `../artifacts/06-review.md`
- VERIFY: `../artifacts/06-verify.md`
