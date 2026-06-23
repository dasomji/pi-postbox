# Unit 01 — Active-local metadata contract and safety helpers

Status: complete

Parent source plan unit: U1 in `docs/plans/2026-06-15-001-feat-active-local-postbox-routing-plan.md`.

## Contract

Goal: create the shared active-local metadata schema, path convention, URL validation, and deterministic selection helpers used later by server publishing and extension resolution.

Acceptance criteria:
- Shared protocol module exists for active-local metadata and exports through protocol index.
- Health schema remains backward compatible while allowing optional local target identity.
- Loopback URL validation accepts only safe numeric loopback HTTP(S) candidates and rejects remote/Tailscale/LAN/ambiguous/smuggled inputs.
- Metadata parsing is bounded and produces sanitized diagnostics.
- Role selection prefers fresh dev, then fresh production, then configured loopback fallback when later health checks can validate it.
- Tests cover accepted/rejected URL forms, role precedence/staleness, bounded parsing/malformed records, and sanitized diagnostics.

Non-goals:
- Do not publish metadata from server CLI in this unit.
- Do not change extension runtime selection or `PostboxClient` behavior in this unit.
- Do not implement Tailscale Serve integration in this unit.

Likely files/surfaces:
- Create: `packages/protocol/src/activeLocal.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/health.ts`
- Test: `packages/protocol/src/activeLocal.test.ts`

Targeted validation commands for role agents:
- `npm test -- packages/protocol/src/activeLocal.test.ts` or closest Vitest file-target command that works in this repo.
- If file targeting is unsupported, run the narrowest relevant `vitest run` invocation and record the exact command.
- Typechecking may be deferred to final verifier unless the implementation changes exported protocol types in a way that needs immediate confirmation.

Safety constraints:
- Keep diagnostics sanitized: no absolute metadata paths, raw env values, credentials, queries, fragments, raw metadata, or command lines.
- Avoid broad filesystem-security scope creep; v1 is fixed filenames, bounded parsing, no symlink-following hooks where straightforward, atomic-writer support later, and diagnostics.
- Preserve backward compatibility for existing `/healthz` consumers.

Phase artifacts:
- RED: `../artifacts/01-red.md`
- GREEN: `../artifacts/01-green.md`
- REVIEW: `../artifacts/01-review.md`
- REPAIR: `../artifacts/01-repair.md` if needed
- VERIFY: `../artifacts/01-verify.md`

Current phase: complete.

Latest validation: VERIFY passed. Targeted protocol tests, protocol typecheck, protocol test sweep, and protocol build passed. See `../artifacts/01-verify.md`.

Risks:
- Overly permissive URL normalization could admit non-loopback or misleading hosts.
- Overly strict parsing could break legitimate loopback localhost config fallback; configured `localhost` should only remain a loopback input if resolution/probing later proves it stays loopback.
- Tests should check behavior categories rather than freeze every status string.
