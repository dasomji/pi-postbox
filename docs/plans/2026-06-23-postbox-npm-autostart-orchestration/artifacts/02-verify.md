# U2 VERIFY: Health-verified preferred server resolution

## result

PASS for U2 health-verified preferred server resolution.

## requirementsChecked

- **Healthy explicit remote URL is selected with `source: explicit-remote` and active-local polling disabled.** Verified in `packages/extension/src/activeLocalTargetResolver.ts:58-71`, covered by `packages/extension/test/activeLocalTargetResolver.test.ts:24-49`, and confirmed by `/tmp/pi-postbox-u2-resolver-evidence.json` showing only `https://postbox.tailnet.example:32187/healthz` was probed before selecting `explicit-remote` with `activeLocalPollingEnabled: false`.
- **Unreachable explicit remote URL is not selected as a target.** Covered by `packages/extension/test/activeLocalTargetResolver.test.ts:82-92`; direct evidence shows an unreachable remote is not retained when active-local fallback is available.
- **Diagnostics identify explicit remote health failure.** `packages/extension/src/activeLocalTargetResolver.ts:71` records `{ code: verified.code, source: "explicit-remote" }`; tests assert `health-unreachable` at `packages/extension/test/activeLocalTargetResolver.test.ts:77` and `:92`; evidence JSON includes `{ "code": "health-unreachable", "source": "explicit-remote" }`.
- **When explicit remote is unreachable but fresh active-local metadata is healthy, active-local is selected.** Resolver flow verifies metadata health at `packages/extension/src/activeLocalTargetResolver.ts:74-106`; covered by `packages/extension/test/activeLocalTargetResolver.test.ts:51-79`; evidence JSON shows fallback selected `source: active-local`, `url: http://127.0.0.1:3500/`, and probed both remote and local health endpoints.
- **Loopback configured URL behavior remains compatible with existing configured-loopback/local recovery semantics.** Existing resolver tests still pass in the targeted resolver run: 10/10 tests, including configured-loopback recovery tests.
- **No live migration is introduced for an already-registered fallback client/session (R4).** Repair is present at `packages/extension/src/index.ts:155-158`, where active-local polling resolver calls set `skipConfiguredRemote: true`; covered by `packages/extension/test/extension.test.ts:273-317`; evidence JSON shows the polling-affinity path selected active-local and probed only `http://127.0.0.1:3500/healthz` even after the configured remote became healthy.
- **R3 preferred configured URL then active-local fallback.** Resolver checks preferred non-loopback configured URL first (`packages/extension/src/activeLocalTargetResolver.ts:58-71`) and then active-local metadata (`:74-106`) when preferred health fails.
- **U2 non-goals respected.** No autostart/status/browser behavior was introduced in the U2 diff inspected; changed implementation surfaces are resolver and registration affinity only.

## commandsRun

- `git status --short && echo '---STAT---' && git diff --stat && echo '---CACHED---' && git diff --cached --name-only` — passed; inspected worktree/diff summary and confirmed no staged files before verification.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts` — passed; 3 files, 28 tests.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts` — passed; 1 file, 10 tests.
- `npm run typecheck` — passed; `tsc -b` completed successfully.
- `npm test` — passed; 27 files, 146 tests.
- Standalone `/tmp` esbuild-backed resolver smoke script exercising healthy explicit remote, unreachable remote fallback, and active-local polling affinity — passed; wrote evidence to `/tmp/pi-postbox-u2-resolver-evidence.json`. Two earlier verifier harness attempts failed due command/path construction before the corrected evidence command; these were verifier-script issues, not product failures.
- `nl -ba ... && git diff --cached --name-only` — passed; collected line-numbered source/test evidence and confirmed no staged files at that point.

## evidenceArtifacts

- `/tmp/pi-postbox-u2-resolver-evidence.json` — direct resolver behavior transcript showing:
  - healthy explicit remote selects `explicit-remote` and probes only remote `/healthz`;
  - unreachable explicit remote falls back to healthy active-local and reports `health-unreachable`/`explicit-remote` diagnostic;
  - active-local polling affinity skips the recovered configured remote and probes only the active-local `/healthz`.
- Command output from targeted Vitest, full Vitest, and typecheck runs in verifier session transcript.

## skippedGates

- `npm run build` — skipped to avoid emitting build artifacts in a verification-only task; `npm run typecheck` and full/targeted Vitest passed.
- `npm run smoke` — skipped because U2 is resolver/extension registration behavior and the smoke script is packaged server workflow coverage that requires built artifacts; no server CLI/package-smoke behavior is in U2 scope.
- Browser/UI screenshot/video — not applicable; U2 behavior is extension resolver/client registration selection, not browser UI.

## issuesFound

No blocking or actionable findings.

## residualRisks

- Direct product evidence uses an esbuild-bundled `/tmp` smoke harness against current source rather than a running Pi session, because U2's observable surface is library/extension registration behavior and no live Pi runtime target is available in this verifier context.
- Autostart/status/browser behavior remains intentionally out of scope for U2 and will need verification in later units.

## noStagedFiles

true
