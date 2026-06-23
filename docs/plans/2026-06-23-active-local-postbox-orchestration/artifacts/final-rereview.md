# Final rereview — active-local Postbox routing + Tailnet-private Tailscale Serve

## Findings

No blocking or actionable findings.

## Claude reviewer

- Result: Not run. The task allowed skipping/recording unavailable due known prior hangs unless bounded to <=8 seconds; nested Claude was skipped to avoid the known hang mode.

## Validation notes

- Scope checked: orchestration index; final review and final repair artifacts; repaired smoke script, server CLI/status path, package docs tests, CLI tests, dev launcher tests; Tailscale Serve integration; extension active-local resolver/no-hijack coverage; config/default-port and Funnel/public command greps.
- Smoke safety: `scripts/smoke-postbox.mjs` now launches the built server with `--no-tailscale` and `PI_POSTBOX_TAILSCALE=off`; `packages/server/test/packageDocs.test.ts` locks both.
- Status safety: `collectPostboxServerStatus()` now selects dev then production only after freshness, `/healthz`, service, and exact `localTarget` role/instance/url checks, and calls `inspectPostboxTailscaleStatus` only for the selected healthy target. No status path calls `exposePostboxWithTailscale` or `tailscale serve --bg`.
- Dev launcher determinism: combined and verbose targeted runs passed; the fake `npm` harness waits for backend invocation while preserving coverage for actual Vite UI port selection, backend `--active-local-role dev --no-tailscale`, and `PI_POSTBOX_TAILSCALE=off` opt-out.
- Cross-unit safety rechecked: explicit non-loopback/Tailscale `PI_POSTBOX_URL` remains authoritative in resolver tests; no automatic Funnel/public command path was found; default/config docs and source use canonical `32187`; tests/smoke do not depend on real Tailscale.

## commandsRun

- `git status --short && printf '\n--- staged ---\n' && git diff --cached --name-only && printf '\n--- stat ---\n' && git diff --stat` — passed inspection; broad expected working tree changes present; no staged files.
- `printf '%s\n' '--- smoke Tailscale opt-out ---'; rg -n -- '--no-tailscale|PI_POSTBOX_TAILSCALE' scripts/smoke-postbox.mjs packages/server/test/packageDocs.test.ts; printf '%s\n' '--- funnel/public command path ---'; rg -n -- 'tailscale\\s+funnel|--funnel|--public' packages/server/src scripts README.md docs/configuration.md docs/deployment.md || true` — passed; smoke opt-out present, no Funnel/public command path matches.
- `npm test -- packages/server/test/packageDocs.test.ts packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed; 3 files / 25 tests.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts` — passed; 3 files / 30 tests.
- `npm test -- packages/server/test/devLauncher.test.ts --reporter=verbose` — passed; 1 file / 4 tests.
- `npm test -- packages/server/test/tailscaleServe.test.ts packages/server/test/devLauncher.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts` — passed; 5 files / 37 tests.
- `node --check scripts/smoke-postbox.mjs && node --check scripts/dev.mjs` — passed with no output.
- `npm run typecheck -w @pi-postbox/server` — passed with no diagnostics.
- `git diff --cached --name-only` — no output before this artifact write.
- `printf '%s\n' '--- status path source references ---'; rg -n -- 'collectPostboxServerStatus|inspectPostboxTailscaleStatus|exposePostboxWithTailscale|serve", "--bg|serve --bg|redirect: "manual"' packages/server/src/cli.ts packages/server/src/tailscaleServe.ts packages/extension/src/activeLocalTargetResolver.ts scripts/smoke-postbox.mjs scripts/dev.mjs` — passed inspection; status uses inspect-only path and Serve mutation is confined to serve/dev exposure paths.

## noFileEdits

- No implementation, test, product documentation, protocol, server, extension, dev launcher, or smoke files were edited by this reviewer.
- This review artifact was written as requested.
