# U2: Health-verified preferred server resolution

## Contract
Change configured non-loopback `PI_POSTBOX_URL` / config `serverUrl` from unconditional selection into a preferred target that must pass health verification before use. If preferred remote is unreachable, active-local fallback remains available.

## Acceptance criteria
- Healthy explicit remote URL is selected with `source: explicit-remote` and active-local polling disabled.
- Unreachable explicit remote URL is not selected as a target.
- Diagnostics identify the explicit remote health failure.
- When explicit remote is unreachable but fresh active-local metadata is healthy, active-local is selected.
- Loopback configured URL behavior remains compatible with existing configured-loopback/local recovery semantics.
- No live migration is introduced for an already-registered client/session.

## Non-goals
- Do not implement package-local autostart in this unit.
- Do not implement `/postbox-status`, `postbox_status`, or `/postbox` browser behavior.
- Do not change server CLI behavior except if tests require harmless support for resolver health semantics.

## Likely files/surfaces
- `packages/extension/src/activeLocalTargetResolver.ts`
- `packages/extension/src/config.ts`
- `packages/extension/test/activeLocalTargetResolver.test.ts`
- `packages/extension/test/extension.test.ts`

## Targeted verification commands
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts`
- If extension registration behavior is touched: `npm test -- packages/extension/test/extension.test.ts`
- Optional focused grep/diff checks for source identity and diagnostics.

## Evidence expectations
- RED artifact shows failing tests for preferred remote fallback behavior before implementation.
- GREEN artifact shows targeted resolver tests passing.

## Current state
Pending RED.

## Phase artifacts
- RED: `../artifacts/02-red.md`
- GREEN: `../artifacts/02-green.md`
- REVIEW: `../artifacts/02-review.md`
- VERIFY: `../artifacts/02-verify.md`
