# Unit 04 VERIFY — Extension target resolver and initial selection

## PASS|FAIL|BLOCKED

PASS — Unit 04 is complete for the reviewed scope.

## requirementsChecked

- Effective env-over-config precedence preserved: `readExtensionConfig()` still returns `serverUrl: env.PI_POSTBOX_URL ?? fileConfig.serverUrl`, and resolver consumes that effective value.
- Explicit non-loopback/no-hijack behavior verified: resolver returns `source: "explicit-remote"` with `activeLocalPollingEnabled: false` before reading/probing active-local metadata; regression coverage preserves `http://127.evil.example:32187/` as explicit remote.
- Loopback/missing config recovery verified: fresh health-verified active-local metadata selects dev over production, falls back to production when dev is stale/unhealthy, recovers dead loopback config, and uses configured loopback only after health verification.
- Fixed-file and filesystem safety checked: resolver reads only `active-local/dev.json` and `active-local/production.json` under the existing config base convention; rejects symlinked, non-file, oversized, malformed/schema-invalid, stale, and unsafe records with filename-only diagnostics.
- Health verification checked: metadata candidates require bounded no-redirect `/healthz`, schema-valid service/protocol response, and exact matching `localTarget` role, instance id, and normalized URL.
- Startup integration checked: extension registers a `PostboxClient` with the resolved active-local URL when no static `serverUrl` is configured.
- Repaired no-client startup supervisor checked: unavailable startup schedules no-client polling, registers when fresh active-local metadata appears, stops after registration, and does not register after deactivation.
- Scope boundaries checked: no changes found in `PostboxClient`, resilience tests, or local fallback tests for Unit 05 live retargeting/target affinity; no Tailscale Serve/status implementation in Unit 04 files.
- Sanitized diagnostics checked: model-visible unavailable rationale is composed from diagnostic codes only; resolver diagnostics use fixed source filenames such as `dev.json`/`production.json`, not full paths or raw metadata.

## commandsRun

- `git status --short && git diff --cached --name-only && git diff --stat` — passed; working tree has expected multi-unit changes and no staged files.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts` — passed; 3 files / 18 tests.
- `npm run typecheck -w @pi-postbox/extension` — passed.
- `npm test -- packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts && npm run typecheck -w @pi-postbox/protocol` — passed; 2 files / 13 tests plus protocol typecheck.
- `grep -R "resolveActiveLocalTarget\|activeLocalPollingEnabled\|new PostboxClient\|setTimeout\|Postbox unavailable\|Postbox not configured\|PI_POSTBOX_URL\|active-local\|healthz\|redirect" -n packages/extension/src packages/extension/test packages/protocol/src` — passed source-inspection sweep.
- `git diff -- packages/extension/src/client/PostboxClient.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts` — passed; no Unit 05 live-retargeting diff.
- `npm test -- packages/extension/test` — passed; 7 files / 34 tests.
- `npm run typecheck` — passed full workspace TypeScript build.

## validationOutput

```text
> vitest run packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/askPostbox.test.ts
Test Files  3 passed (3)
Tests       18 passed (18)
```

```text
> @pi-postbox/extension@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
> vitest run packages/protocol/src/activeLocal.test.ts packages/protocol/src/health.test.ts
Test Files  2 passed (2)
Tests       13 passed (13)

> @pi-postbox/protocol@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
> vitest run packages/extension/test
Test Files  7 passed (7)
Tests       34 passed (34)
```

```text
> tsc -b
```

Source-inspection excerpts:

```text
activeLocalTargetResolver.ts:54-63 returns explicit non-loopback configured URL with activeLocalPollingEnabled: false before metadata reads.
activeLocalTargetResolver.ts:128-130 loops fixed role filenames only: dev.json and production.json.
activeLocalTargetResolver.ts:140-151 rejects symlinked and oversized metadata before read/parse.
activeLocalTargetResolver.ts:244-246 probes /healthz with redirect: "manual" and AbortSignal timeout.
index.ts:166-224 implements no-client supervisor with client/isActive guards and stops before registering.
index.ts:249-252 formats unavailable rationale from diagnostic codes only.
```

## evidenceArtifacts

- Verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/04-verify.md`.
- CLI/test/typecheck/source-inspection transcript evidence captured in this artifact and current session output.
- Browser/CDP evidence: not applicable for this unit; behavior is extension/protocol startup resolution with no browser UI surface.

## skippedGates

- Lint/format: no lint or format scripts discovered in `package.json` or `packages/extension/package.json`.
- Full `npm test`: not run because targeted extension tests, full extension test sweep, targeted protocol tests, and full workspace typecheck covered the Unit 04 surfaces; prior orchestration notes also mention unrelated broad-suite docs expectations outside this unit.
- Build/package artifacts: not run because full workspace `tsc -b` passed and Unit 04 does not change emitted/package assets.

## issuesFound

None blocking or actionable for Unit 04.

## residualRisks

- Reviewer/source inspection confirms no Unit 05 retargeting was introduced; live retargeting and target affinity remain intentionally unimplemented for Unit 05.
- Status UI still primarily reports connection/unavailable state; detailed unavailable rationale is exposed through `ask_postbox` formatting from sanitized diagnostic codes, with broader operator status diagnostics deferred to later status/docs units.

## noStagedFiles

`git diff --cached --name-only` produced no output before writing this artifact. No files were staged by verification.
