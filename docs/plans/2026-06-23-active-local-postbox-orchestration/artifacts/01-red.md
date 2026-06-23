# Unit 01 RED — Active-local metadata contract and safety helpers

## changedFiles

- `packages/protocol/src/activeLocal.test.ts` (new)
- `packages/protocol/src/health.test.ts` (updated)
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/01-red.md` (new)

## testsAddedOrUpdated

- `active-local loopback URL contract > accepts only safe numeric loopback HTTP(S) metadata URLs`
  - Specifies metadata URL normalization for `http://127.0.0.1`, other `127/8` loopback, and `[::1]` over HTTP(S).
- `active-local loopback URL contract > rejects remote, Tailscale, LAN, hostname, ambiguous, and smuggled metadata URLs`
  - Specifies rejection for `localhost`, `.local`, Tailnet DNS, arbitrary hostnames, `0.0.0.0`, LAN/private/Tailscale IPs, link-local IPv6, IPv4-mapped IPv6, integer/octal/hex IPv4, non-HTTP(S), credentials, non-root paths, query/fragment, and URL-smuggling forms.
- `active-local metadata parsing > parses a bounded, fresh role-scoped metadata record`
  - Specifies versioned role metadata with role, normalized loopback URL, generated instance id, and timestamp.
- `active-local metadata parsing > rejects too-large and malformed records without exposing raw metadata`
  - Specifies bounded parsing and redacted diagnostics for oversized/malformed input.
- `active-local metadata parsing > rejects malformed role, timestamp, instance id, and unsafe URL fields`
  - Specifies schema-level rejection for invalid role, role mismatch, invalid/future timestamp, invalid/missing generated instance id, and unsafe URLs.
- `active-local metadata parsing > returns sanitized diagnostics for rejected metadata`
  - Specifies diagnostics contain safe role context but omit absolute paths, credentials, tokens, fragments, and raw metadata.
- `active-local deterministic role selection > prefers fresh dev over fresh production`
  - Specifies dev precedence when both fresh records are present.
- `active-local deterministic role selection > selects fresh production when dev is stale`
  - Specifies production fallback when dev is stale, with a dev diagnostic.
- `active-local deterministic role selection > returns no selected target and sanitized stale diagnostics when all records are stale`
  - Specifies no target selected when all candidates are stale and diagnostics remain sanitized.
- `Postbox health protocol > keeps local target identity optional for backward-compatible health consumers`
  - Specifies existing `/healthz` payloads without local identity remain accepted.
- `Postbox health protocol > accepts and creates health responses with active-local target identity`
  - Specifies optional health local target identity can be created and parsed.

## commandsRun

- `npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts`
- `git status --short && git diff -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts`
- `git diff --cached --name-only`

## validationOutput

Targeted test command failed as expected for RED:

```text
> vitest run packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts

packages/protocol/src/activeLocal.test.ts: 9 tests failed
- Error: Expected packages/protocol index to export active-local helper normalizeActiveLocalMetadataUrl

packages/protocol/src/health.test.ts: 4 tests run, 1 failed
- accepts and creates health responses with active-local target identity
- AssertionError: expected response to include localTarget, but createHealthResponse/HealthResponseSchema output omitted it

Test Files  2 failed (2)
Tests  10 failed | 3 passed (13)
```

`git diff --cached --name-only` produced no output.

## failureReasonTiedToMissingBehavior

The RED failures are tied to the missing Unit 01 behavior:

- The protocol index does not yet export the shared active-local contract/safety helpers (`normalizeActiveLocalMetadataUrl`, `parseActiveLocalMetadataRecord`, `selectActiveLocalTarget`), so every active-local contract test fails before behavior can be satisfied.
- `createHealthResponse` currently ignores `localTarget`, and the health schema has no modeled active-local identity, so the new backward-compatible local target identity behavior is absent.

## residualRisks

- The active-local helper names and return shapes are now specified by tests because no production interface existed yet. Implementer may need to align the new module to this public contract or propose a reviewed test adjustment before GREEN.
- The tests intentionally focus on pure protocol helpers and health schema only; server metadata publication, extension resolution, health probing, file IO, and Tailscale behavior remain for later units.
- Stale metadata parsing is specified as schema-valid and rejected during selection, not parse time. If implementation prefers parse-time stale classification, the selection tests should be reviewed before changing this behavior.

## noStagedFiles

true
