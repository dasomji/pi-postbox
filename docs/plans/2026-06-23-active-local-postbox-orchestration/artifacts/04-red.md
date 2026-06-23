# Unit 04 RED — Extension target resolver and initial selection

## changedFiles

- `packages/extension/test/activeLocalTargetResolver.test.ts` (new)
- `packages/extension/test/extension.test.ts` (updated)
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/04-red.md` (new artifact)

## testsAddedOrUpdated

- `active-local extension target resolver > keeps an explicit non-loopback PI_POSTBOX_URL authoritative and disables active-local recovery`
  - Asserts explicit remote/Tailscale-style env URL selects `source: "explicit-remote"`, preserves the URL, disables active-local polling, and does not probe local metadata health.
- `active-local extension target resolver > selects fresh healthy dev metadata over fresh healthy production when no URL is configured`
  - Asserts no configured URL resolves to fresh health-verified dev metadata over production.
- `active-local extension target resolver > falls back to fresh healthy production when dev metadata is stale or unhealthy`
  - Asserts stale dev is diagnosed and healthy production is selected.
- `active-local extension target resolver > recovers a dead configured loopback URL by selecting fresh healthy production metadata`
  - Asserts stale/dead loopback config does not stay authoritative when fresh production metadata exists.
- `active-local extension target resolver > uses a configured loopback URL only as a health-verified configured-loopback fallback when metadata is absent`
  - Asserts loopback config fallback is selected only after `/healthz` verification and reported as `configured-loopback`.
- `active-local extension target resolver > rejects symlinked and oversized metadata with sanitized diagnostics`
  - Asserts fixed role files reject symlink/oversize conditions and diagnostics do not leak temp paths or file contents.
- `active-local extension target resolver > requires health localTarget identity to match metadata role, instance id, and normalized URL exactly`
  - Asserts a health identity mismatch rejects dev and falls back to matching production with a mismatch diagnostic.
- `Pi Postbox extension registration > registers against fresh active-local metadata when no serverUrl is configured`
  - Uses a temp config directory and bounded loopback fake `/healthz` server; asserts startup no longer reports `Postbox not configured` and constructs the client with the active-local URL.

## commandsRun

- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts`
  - Result: failed as expected for RED.
- `git status --short`
  - Result: showed this unit's test edits plus pre-existing Unit 01/02/03/doc changes in the working tree.
- `git diff --cached --name-only`
  - Result: no staged files.

## validationOutput

Targeted test command output summary:

```text
Test Files  2 failed | 1 passed (3)
Tests       8 failed | 7 passed (15)

packages/extension/test/activeLocalTargetResolver.test.ts
  7 tests failed with:
  Error: Cannot find module '/packages/extension/src/activeLocalTargetResolver.js'

packages/extension/test/extension.test.ts
  Pi Postbox extension registration > registers against fresh active-local metadata when no serverUrl is configured
  AssertionError: expected [ 'Postbox not configured' ] to not include 'Postbox not configured'

packages/extension/test/askPostbox.test.ts passed unchanged.
```

## failureReasonTiedToMissingBehavior

- Resolver tests fail because `packages/extension/src/activeLocalTargetResolver.ts` does not exist yet. This is the intended RED seam for Unit 04: the extension has no public resolver that can preserve explicit remote intent, load fixed active-local role files, health-verify candidates, reject unsafe metadata, or emit sanitized diagnostics.
- The startup integration test fails for the existing static config behavior: `startRegistration` calls `readExtensionConfig`, sees no `serverUrl`, sets `Postbox not configured`, and returns without inspecting fresh active-local metadata. This directly proves the missing Unit 04 behavior that startup should register against fresh active-local metadata when no URL is configured.

## residualRisks

- The resolver API shape is test-defined as `resolveActiveLocalTarget(options)` returning `{ status, target, diagnostics }`; the GREEN phase may adjust production internals, but should preserve this public extension-module seam or update tests with equivalent public behavior.
- Unavailable `ask_postbox` diagnostic formatting is covered at resolver diagnostics level, not through the registered tool path. A later GREEN/RED slice may add a focused extension tool test once diagnostics are threaded through `index.ts`.
- Existing working tree contains many pre-existing modified/untracked files from earlier units; this RED phase only added/updated the files listed above.

## noStagedFiles

`git diff --cached --name-only` produced no output. No files are staged.
