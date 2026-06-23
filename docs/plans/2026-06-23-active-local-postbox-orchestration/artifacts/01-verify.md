# Unit 01 VERIFY — Active-local metadata contract and safety helpers

## PASS|FAIL|BLOCKED

PASS — Unit 01 is complete for the reviewed active-local protocol contract scope.

## requirementsChecked

- Shared protocol module/export: `packages/protocol/src/activeLocal.ts` exists and `packages/protocol/src/index.ts` exports active-local constants, schemas, helpers, and types.
- Health compatibility: `HealthResponseSchema` still accepts legacy health payloads without `localTarget`, and `createHealthResponse`/schema accept optional active-local identity.
- Safe loopback URL validation: targeted tests cover accepted numeric loopback HTTP(S) URLs and rejected hostname, LAN/private, Tailscale, ambiguous numeric, credential, path/query/fragment, and smuggled forms.
- Bounded/sanitized metadata parsing: targeted tests cover max-byte rejection, malformed JSON/fields, unsafe URLs, future timestamps, invalid instance ids, role mismatch, and diagnostics that avoid raw metadata, absolute paths, credentials, query tokens, and fragments.
- Deterministic role selection: targeted tests cover fresh dev precedence over production, production fallback when dev is stale, and no selected target when all records are stale.
- Scope boundaries: implementation changes are confined to protocol source/tests for Unit 01 surfaces; server metadata publishing, extension runtime selection, client retargeting, and Tailscale Serve behavior remain unimplemented for later units.
- Review gate: `01-review.md` reports no blocking/actionable findings; verifier re-ran targeted tests/typecheck independently.

## commandsRun

- `git status --short && git diff --stat && git diff --cached --name-only` — passed; captured changed files/diff summary and confirmed no staged files.
- `npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts` — passed; required targeted Unit 01 tests.
- `npm run typecheck -w @pi-postbox/protocol` — passed; required protocol package typecheck.
- `npm test -- packages/protocol/src` — passed; additional narrow protocol test sweep.
- `npm run build -w @pi-postbox/protocol` — passed; additional narrow protocol build check.
- `git status --short && git diff --cached --name-only` — passed after validation; no staged files.

## validationOutput

Initial status/no-staged check:

```text
 M docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md
 M docs/prd/pi-postbox.md
 M packages/protocol/src/health.test.ts
 M packages/protocol/src/health.ts
 M packages/protocol/src/index.ts
?? docs/adr/0002-tailnet-private-tailscale-auto-exposure.md
?? docs/plans/2026-06-23-active-local-postbox-orchestration/
?? packages/protocol/src/activeLocal.test.ts
?? packages/protocol/src/activeLocal.ts
 ...5-001-feat-active-local-postbox-routing-plan.md | 125 +++++++++++++++++++--
 docs/prd/pi-postbox.md                             |  21 ++--
 packages/protocol/src/health.test.ts               |  33 ++++++
 packages/protocol/src/health.ts                    |  17 ++-
 packages/protocol/src/index.ts                     |  23 ++++
 5 files changed, 198 insertions(+), 21 deletions(-)
```

Required targeted tests:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 Test Files  2 passed (2)
      Tests  13 passed (13)
   Start at  13:33:54
   Duration  322ms (transform 220ms, setup 0ms, import 221ms, tests 107ms, environment 0ms)
```

Required protocol typecheck:

```text
> @pi-postbox/protocol@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

Additional narrow protocol tests:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/protocol/src

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 Test Files  4 passed (4)
      Tests  20 passed (20)
   Start at  13:34:02
   Duration  339ms (transform 455ms, setup 0ms, import 566ms, tests 124ms, environment 0ms)
```

Additional protocol build:

```text
> @pi-postbox/protocol@0.1.0 build
> tsc -p tsconfig.json
```

Final no-staged check:

```text
 M docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md
 M docs/prd/pi-postbox.md
 M packages/protocol/src/health.test.ts
 M packages/protocol/src/health.ts
 M packages/protocol/src/index.ts
?? docs/adr/0002-tailnet-private-tailscale-auto-exposure.md
?? docs/plans/2026-06-23-active-local-postbox-orchestration/
?? packages/protocol/src/activeLocal.test.ts
?? packages/protocol/src/activeLocal.ts
```

`git diff --cached --name-only` produced no output.

## evidenceArtifacts

- This verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/01-verify.md`
- CLI transcript evidence is embedded above. Browser/CDP evidence was not used because this is a pure protocol unit and the task explicitly allowed CLI/test/typecheck transcript evidence.

## skippedGates

- Full workspace `npm test` — skipped as broader than Unit 01; additional narrow protocol test sweep passed.
- Full workspace `npm run typecheck` / `npm run build` — skipped as broader than Unit 01; protocol package typecheck and build passed.
- Browser/UI evidence — not applicable to this pure protocol unit and browser/CDP unavailable per task context.

## issuesFound

None blocking/actionable.

## residualRisks

- Later units still need to implement and verify server metadata publication, extension resolver health checks/configured loopback fallback, live client retargeting, diagnostics/status, and Tailscale Serve behavior.
- Configured loopback fallback is not selected by the pure Unit 01 helper itself; this matches the later U4 resolver scope where health verification is required.
- Path safety beyond fixed active-local directory/role filename constants is intentionally deferred to filesystem-owning later units.

## noStagedFiles

true
