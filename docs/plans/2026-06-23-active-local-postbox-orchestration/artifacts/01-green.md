# Unit 01 GREEN — Active-local metadata contract and safety helpers

## changedFiles

- `packages/protocol/src/activeLocal.ts` (new): active-local metadata constants/schemas, safe loopback URL normalization, bounded sanitized metadata parsing, and deterministic role selection.
- `packages/protocol/src/index.ts`: exports active-local helpers, schemas, constants, and types.
- `packages/protocol/src/health.ts`: adds optional `localTarget` identity to health schema and `createHealthResponse` while preserving existing payload shape when omitted.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/01-green.md` (new): GREEN evidence.

## commandsRun

- `npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts`
- `npm run typecheck -w @pi-postbox/protocol`
- `git diff --cached --name-only`

## validationOutput

Targeted Unit 01 tests pass:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 Test Files  2 passed (2)
      Tests  13 passed (13)
   Start at  13:24:32
   Duration  306ms (transform 202ms, setup 0ms, import 219ms, tests 102ms, environment 0ms)
```

Protocol package typecheck passes:

```text
> @pi-postbox/protocol@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

No staged files:

```text
$ git diff --cached --name-only
```

## residualRisks

- Active-local helpers are pure protocol utilities only; server metadata publishing, extension resolution, client retargeting, health probing, and Tailscale integration remain intentionally unimplemented for later units.
- Selection assumes at most one parsed metadata record per role, matching the current fixed role-file contract.

## noStagedFiles

true
