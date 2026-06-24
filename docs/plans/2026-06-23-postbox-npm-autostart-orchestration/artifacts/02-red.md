# U2 RED: Health-verified preferred server resolution

## changedFiles

- `packages/extension/test/activeLocalTargetResolver.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/02-red.md`

## testsAddedOrUpdated

- Updated `selects a healthy explicit non-loopback PI_POSTBOX_URL after verifying remote health`
  - Asserts a configured non-loopback `PI_POSTBOX_URL` is still selected as `source: "explicit-remote"` with `activeLocalPollingEnabled: false` only after probing `/healthz`.
  - Asserts healthy preferred remote short-circuits active-local health probing.
- Added `falls back to fresh healthy active-local metadata when configured serverUrl remote health fails`
  - Asserts a non-loopback `serverUrl` from config is health-checked, a failed remote health probe is not selected, fresh healthy active-local metadata is selected instead, and diagnostics include `{ code: "health-unreachable", source: "explicit-remote" }`.
- Added `reports an explicit remote health failure instead of selecting an unreachable PI_POSTBOX_URL`
  - Asserts an unreachable `PI_POSTBOX_URL` returns `status: "unavailable"`, does not expose an `explicit-remote` target, and reports the explicit remote health failure diagnostic.
- Updated `does not treat DNS hostnames beginning with 127 as recoverable loopback configuration`
  - Keeps the loopback-safety regression covered while requiring hostname-looking explicit remotes to pass remote health verification before selection.
- Existing configured-loopback tests remain in place:
  - `recovers a dead configured loopback URL by selecting fresh healthy production metadata`
  - `uses a configured loopback URL only as a health-verified configured-loopback fallback when metadata is absent`

## commandsRun

- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts` — failed as expected (RED).
- `git diff --cached --name-only` — no output; no staged files.

## validationOutput

Targeted resolver test run failed with 4 expected RED failures:

- `selects a healthy explicit non-loopback PI_POSTBOX_URL after verifying remote health`
  - Failure: expected health fetch to be called once, but it was called 0 times.
  - This proves current resolver still selects explicit remotes without health verification.
- `falls back to fresh healthy active-local metadata when configured serverUrl remote health fails`
  - Failure: resolver returned `target.source: "explicit-remote"` with polling disabled instead of selecting healthy active-local metadata.
  - This proves current resolver still treats configured non-loopback `serverUrl` as authoritative and skips fallback.
- `reports an explicit remote health failure instead of selecting an unreachable PI_POSTBOX_URL`
  - Failure: resolver returned `status: "selected"` instead of `status: "unavailable"`.
  - This proves unreachable explicit remotes are still selected.
- `does not treat DNS hostnames beginning with 127 as recoverable loopback configuration`
  - Failure: expected remote health fetch to be called once, but it was called 0 times.
  - This proves non-loopback hostname remotes, including 127-prefixed DNS names, are still unverified.

Summary from Vitest: `packages/extension/test/activeLocalTargetResolver.test.ts` had 10 tests, 4 failed and 6 passed.

## residualRisks

- RED only: no production implementation was changed.
- Diagnostic shape `{ source: "explicit-remote" }` is now specified by tests; GREEN should confirm this is the desired public diagnostic identity.

## noStagedFiles

true
