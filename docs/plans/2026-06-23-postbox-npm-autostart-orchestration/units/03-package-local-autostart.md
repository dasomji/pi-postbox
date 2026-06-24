# U3: Package-local server autostart supervisor

## Contract
Add bounded autostart recovery that starts a reusable local Postbox server when `ask_postbox` or `/postbox` needs one and no preferred or active local server is reachable.

## Acceptance criteria
- `ask_postbox` with no reachable server can invoke autostart, wait for healthy active-local/server metadata, register the current Pi Session, and send the question.
- A healthy preferred server is used without invoking autostart.
- `PI_POSTBOX_AUTOSTART=off` disables spawn and returns unavailable diagnostics.
- `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` bounds waiting; default is 10000ms.
- Spawn prefers package-local CLI (`node <package-root>/packages/server/dist/cli.js`) and falls back to `pi-postbox-server` on PATH with clear diagnostics.
- Autostarted child/server is not stopped on Pi session shutdown.
- Existing active-local server can be reused without spawning another process.
- No status/browser command behavior beyond what is necessary for autostart helper plumbing.

## Non-goals
- Do not implement `/postbox-status` operator status or `postbox_status` tool.
- Do not implement `/postbox` browser opening in this unit, though helper APIs may be shaped for later use.
- Do not add OS service/systemd/launchd behavior.

## Likely files/surfaces
- Create/modify `packages/extension/src/autostart.ts`
- Modify `packages/extension/src/index.ts`
- Modify `packages/extension/src/client/PostboxClient.ts` only if needed
- Tests: `packages/extension/test/autostart.test.ts`, `packages/extension/test/askPostbox.test.ts`, `packages/extension/test/extension.test.ts`

## Targeted verification commands
- `npm test -- packages/extension/test/autostart.test.ts`
- `npm test -- packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts`
- Related resolver/client tests if touched.

## Evidence expectations
- RED artifact shows failing tests for autostart decision/spawn/timeout/opt-out/reuse.
- GREEN artifact shows focused tests passing with deterministic fake timers/spawn mocks or equivalent.

## Current state
Pending RED.

## Phase artifacts
- RED: `../artifacts/03-red.md`
- GREEN: `../artifacts/03-green.md`
- REVIEW: `../artifacts/03-review.md`
- VERIFY: `../artifacts/03-verify.md`
