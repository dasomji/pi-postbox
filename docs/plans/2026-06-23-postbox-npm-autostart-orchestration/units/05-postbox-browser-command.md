# U5: User-only `/postbox` browser command

## Contract
Add `/postbox` as a user command that ensures a Postbox server is available, then opens the active dashboard URL in the user's browser. Do not expose any LLM tool that opens the browser.

## Acceptance criteria
- Connected `/postbox` invokes the OS opener with the active dashboard URL.
- Disconnected `/postbox` invokes the same mutating recovery/autostart path used by `ask_postbox`, then opens the resulting URL if ready within timeout.
- Opener failure notifies the user with the URL to open manually.
- Autostart/recovery timeout notifies the user with diagnostics and does not open an undefined URL.
- No tool named `open_postbox` or equivalent browser-opening tool is registered.
- Command accepts no optional args for this plan.

## Non-goals
- Do not change status command/tool behavior except if shared helper needs a small adjustment.
- Do not add browser-opening LLM tool.
- Do not add OS services.

## Likely files/surfaces
- `packages/extension/src/commands/openPostbox.ts`
- `packages/extension/src/index.ts`
- `packages/extension/src/autostart.ts` / helper plumbing if needed
- Tests: `packages/extension/test/openPostbox.test.ts`, `packages/extension/test/extension.test.ts`

## Targeted verification commands
- `npm test -- packages/extension/test/openPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/autostart.test.ts packages/extension/test/status.test.ts`

## Evidence expectations
- RED artifact shows failing command/open/autostart/no-tool tests.
- GREEN artifact shows targeted tests passing with mocked opener/spawn.

## Current state
Pending RED.

## Phase artifacts
- RED: `../artifacts/05-red.md`
- GREEN: `../artifacts/05-green.md`
- REVIEW: `../artifacts/05-review.md`
- VERIFY: `../artifacts/05-verify.md`
