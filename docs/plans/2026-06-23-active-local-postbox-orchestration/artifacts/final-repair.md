# Final repair — active-local Postbox routing + Tailnet-private Tailscale Serve

## changedFiles

Final-repair touched files:

- `scripts/smoke-postbox.mjs`
- `packages/server/src/cli.ts`
- `packages/server/test/packageDocs.test.ts`
- `packages/server/test/cli.test.ts`
- `packages/server/test/devLauncher.test.ts`
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/final-repair.md`

## commandsRun

- `npm test -- packages/server/test/packageDocs.test.ts packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts` — passed.
- `npm test -- packages/server/test/devLauncher.test.ts --reporter=verbose` — passed.
- `npm test -- packages/server/test/tailscaleServe.test.ts packages/server/test/devLauncher.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts` — passed.
- `node --check scripts/smoke-postbox.mjs && node --check scripts/dev.mjs` — passed.
- `npm run typecheck -w @pi-postbox/server` — passed.
- `printf '%s\n' '--- smoke Tailscale opt-out ---'; rg -n -- '--no-tailscale|PI_POSTBOX_TAILSCALE' scripts/smoke-postbox.mjs packages/server/test/packageDocs.test.ts; printf '%s\n' '--- funnel/public command path ---'; rg -n -- 'tailscale\\s+funnel|--funnel|--public' packages/server/src scripts README.md docs/configuration.md docs/deployment.md || true` — passed inspection.
- `git diff --cached --name-only` — no output before this artifact write.

## validationOutput

```text
> npm test -- packages/server/test/packageDocs.test.ts packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts
Test Files  3 passed (3)
Tests       25 passed (25)
```

```text
> npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts
Test Files  3 passed (3)
Tests       30 passed (30)
```

```text
> npm test -- packages/server/test/devLauncher.test.ts --reporter=verbose
✓ packages/server/test/devLauncher.test.ts > scripts/dev.mjs > starts the backend as the active-local dev target while preserving API port and web proxy env 193ms
✓ packages/server/test/devLauncher.test.ts > scripts/dev.mjs > selects and exposes the actual Vite UI port when 5173 is busy 173ms
✓ packages/server/test/devLauncher.test.ts > scripts/dev.mjs > skips dev Tailscale Serve mutation when PI_POSTBOX_TAILSCALE=off 77ms
✓ packages/server/test/devLauncher.test.ts > scripts/dev.mjs > uses the documented canonical API port when PI_POSTBOX_PORT is unset 1ms
Test Files  1 passed (1)
Tests       4 passed (4)
```

```text
> npm test -- packages/server/test/tailscaleServe.test.ts packages/server/test/devLauncher.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts
Test Files  5 passed (5)
Tests       37 passed (37)
```

```text
> node --check scripts/smoke-postbox.mjs && node --check scripts/dev.mjs
# passed with no output
```

```text
> npm run typecheck -w @pi-postbox/server
> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
# passed with no diagnostics
```

```text
--- smoke Tailscale opt-out ---
packages/server/test/packageDocs.test.ts:107:      "--no-tailscale",
packages/server/test/packageDocs.test.ts:108:      "PI_POSTBOX_TAILSCALE=off",
packages/server/test/packageDocs.test.ts:156:    expect(smoke, "smoke must not mutate real operator Tailscale Serve state").toContain("--no-tailscale");
packages/server/test/packageDocs.test.ts:157:    expect(smoke, "smoke child environment must force Tailscale off").toMatch(/PI_POSTBOX_TAILSCALE[\s\S]{0,40}["']off["']/);
scripts/smoke-postbox.mjs:166:    "--no-tailscale"
scripts/smoke-postbox.mjs:174:      PI_POSTBOX_TAILSCALE: "off"
--- funnel/public command path ---
# no matches
```

## findingsAddressed

1. Smoke script Tailscale safety: `scripts/smoke-postbox.mjs` now passes `--no-tailscale` and sets `PI_POSTBOX_TAILSCALE=off` for the smoke child. `packages/server/test/packageDocs.test.ts` statically locks this down so release smoke cannot mutate real operator Tailscale Serve state.
2. Status active-local selection correctness: `collectPostboxServerStatus()` now iterates `dev` then `production`, rejects stale metadata, probes each candidate before selection, requires `service === pi-postbox`, validates `/healthz.localTarget` exact role/instance/url identity, records rejection diagnostics, falls back from unhealthy dev to healthy production, and calls Tailscale inspection only for the selected healthy target. Tests cover unreachable dev fallback, identity mismatch/port reuse fallback, non-Postbox health rejection, and no Tailscale inspection without a healthy target.
3. Dev launcher test race: fake `npm` now waits until the backend invocation has been recorded before exiting, making launcher shutdown/assertions deterministic while preserving coverage for actual Vite UI port selection, backend `--active-local-role dev --no-tailscale`, and opt-out.

## residualRisks

- Status/Tailscale validation remains fake/mocked for safety; no real Tailscale daemon or Serve state was touched.
- The working tree already contains broad unstaged/untracked orchestration changes from Units 01–07; this final repair changed only the files listed above.

## noStagedFiles

true — `git diff --cached --name-only` produced no output before this artifact write; no files were staged by this implementer.
