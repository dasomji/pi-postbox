# U5 RED: user-only `/postbox` browser command

## changedFiles
- `packages/extension/test/openPostbox.test.ts` (new focused RED tests)
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/05-red.md` (this artifact)

## testsAddedOrUpdated
- `packages/extension/test/openPostbox.test.ts`
  - `/postbox browser command > opens the active dashboard URL when Postbox is already connected`
    - Starts a connected extension session through the public extension registration surface.
    - Expects a `postbox` user command to be registered.
    - Expects invoking it to call the OS opener with the active dashboard URL.
  - `/postbox browser command > uses the same mutating recovery/autostart path as ask_postbox when disconnected, then opens the recovered dashboard URL`
    - Starts disconnected, verifies no autostart spawn during session startup.
    - Expects `/postbox` to trigger package-local autostart, wait for healthy active-local metadata, register, then open the recovered URL.
  - `/postbox browser command > notifies the user with the manual dashboard URL when the OS opener fails`
    - Simulates opener failure and expects a warning/error notification containing the manual URL.
  - `/postbox browser command > reports recovery timeout diagnostics and does not try to open an undefined dashboard URL`
    - Uses a short autostart timeout with no healthy metadata.
    - Expects timeout diagnostics and no browser open with `undefined`/`null` URL.
  - `/postbox browser command > registers /postbox as a user command only, without browser-opening LLM tools or optional URL arguments`
    - Expects `/postbox` command registration.
    - Expects existing tools to remain `ask_postbox`/`postbox_status` and no `open_postbox` or browser/dashboard-opening tool names.
    - Invokes with an extraneous URL argument and asserts that supplied argument is not opened.

## commandsRun
1. `npm test -- packages/extension/test/openPostbox.test.ts`
   - Result: failed as expected (RED).
   - Summary: 5 tests failed because `harness.commands.has("postbox")` is false; no `/postbox` user command is registered yet.
2. `npm test -- packages/extension/test/openPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/autostart.test.ts packages/extension/test/status.test.ts`
   - Result: failed as expected (RED).
   - Summary: `openPostbox.test.ts` failed 5/5; existing targeted `extension`, `autostart`, and `status` tests passed 24/24.
3. `git diff --name-only`
   - Result: passed.
   - Summary: showed pre-existing tracked modifications; the new RED test is untracked and therefore not listed by this command.
4. `git diff --cached --name-only`
   - Result: passed.
   - Summary: no output; no staged files.
5. `git status --short`
   - Result: passed.
   - Summary: confirms `packages/extension/test/openPostbox.test.ts` and this artifact are untracked; no staged files.

## validationOutput

Targeted new test run:

```text
❯ packages/extension/test/openPostbox.test.ts (5 tests | 5 failed)
  × opens the active dashboard URL when Postbox is already connected
  × uses the same mutating recovery/autostart path as ask_postbox when disconnected, then opens the recovered dashboard URL
  × notifies the user with the manual dashboard URL when the OS opener fails
  × reports recovery timeout diagnostics and does not try to open an undefined dashboard URL
  × registers /postbox as a user command only, without browser-opening LLM tools or optional URL arguments

AssertionError: expected false to be true
packages/extension/test/openPostbox.test.ts:157:47
expect(harness.commands.has("postbox")).toBe(true)
```

Full targeted U5 command:

```text
Test Files  1 failed | 3 passed (4)
Tests  5 failed | 24 passed (29)
```

Representative failures from the full targeted run:

```text
FAIL packages/extension/test/openPostbox.test.ts > /postbox browser command > opens the active dashboard URL when Postbox is already connected
AssertionError: expected false to be true
expect(harness.commands.has("postbox")).toBe(true)

FAIL packages/extension/test/openPostbox.test.ts > /postbox browser command > uses the same mutating recovery/autostart path as ask_postbox when disconnected, then opens the recovered dashboard URL
AssertionError: expected false to be true
expect(harness.commands.has("postbox")).toBe(true)
```

## whyThisIsRED
The tests fail before any browser/autostart branch because the public extension registration surface does not currently register a `postbox` command. That is the intended first missing behavior for U5. Existing targeted autostart/status/extension tests still pass, so the failure is isolated to the new `/postbox` command behavior rather than a regression in prior units.

## residualRisks
- The deeper opener failure, timeout, and argument assertions are currently gated behind command registration, so GREEN may expose additional implementation gaps after `/postbox` is registered.
- The tests intentionally mock the Node `child_process.spawn` boundary for both autostart and OS opener behavior; an implementation that uses a different process API would need either adaptation or a deliberate test update.
- Pre-existing uncommitted/untracked files from earlier units remain in the worktree and were not modified by this RED phase.

## noStagedFiles
true
