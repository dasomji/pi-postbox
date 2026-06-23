# Final full-change review — active-local Postbox routing + Tailnet-private Tailscale Serve

## Findings

1. **Severity:** High  
   **Location:** `scripts/smoke-postbox.mjs:159`  
   **Requirement/pattern violated:** Smoke/tests must not mutate real operator state or real Tailscale Serve; Tailscale auto-exposure must be opt-out capable and safe in validation.  
   **Issue:** The smoke script launches the built server CLI without `--no-tailscale` and without setting `PI_POSTBOX_TAILSCALE=off` in the child environment. Because the server now enables Tailnet-private Serve by default, `npm run smoke` on a machine with usable Tailscale can run a real `tailscale serve --bg --https <smoke-port> http://127.0.0.1:<smoke-port>` and leave/mutate operator Serve state. The current package docs smoke test only checks temp Postbox config isolation, not Tailscale opt-out.  
   **Required fix:** Force Tailscale off for the smoke child (`--no-tailscale` or `PI_POSTBOX_TAILSCALE=off`) and add a static/regression test that locks smoke out of real Tailscale mutation.

2. **Severity:** Medium  
   **Location:** `packages/server/src/cli.ts:216`  
   **Requirement/pattern violated:** Status must agree with active-local semantics: healthy dev preferred, unhealthy/stale dev falls back to healthy production, and metadata candidates require matching `/healthz.localTarget` identity.  
   **Issue:** `collectPostboxServerStatus()` calls `selectActiveLocalTarget(records)` before any health check. That helper only applies freshness/role precedence, so a fresh but dead/unhealthy `dev.json` prevents status from considering a healthy `production.json`. `probePostboxHealth()` then only checks `body.service === "pi-postbox"` and does not validate the metadata record's role/instance/url against `/healthz.localTarget`, so status can also report `running` for port-reused or mismatched metadata that the extension resolver would reject. This can produce incorrect local/Tailnet URL and `PI_POSTBOX_URL` guidance.  
   **Required fix:** Make status selection use the same per-candidate health/identity verification as the extension resolver: iterate dev then production, reject stale/unreachable/identity-mismatched candidates with diagnostics, fall back to production when dev is unhealthy, and inspect/report Tailscale only for the selected healthy target.

3. **Severity:** Low  
   **Location:** `packages/server/test/devLauncher.test.ts:148`  
   **Requirement/pattern violated:** Tests should not be racy/brittle.  
   **Issue:** A safe targeted combined test run failed once with `backend?.args` undefined in the dev launcher test, then the same file passed when rerun alone. The fake `npm` child exits immediately while the fake backend child is killed during launcher shutdown, so under parallel/load timing the assertion can read the invocation log before the backend invocation is recorded.  
   **Required fix:** Make the dev launcher harness deterministic (for example, keep the fake web child alive until SIGTERM, wait for both expected invocations before allowing shutdown, or have the fake backend synchronously acknowledge startup before the web child exits).

## Claude reviewer

- Result: Not run. The task allowed skipping/recording unavailable due known prior hangs unless bounded to <=8 seconds; nested Claude was skipped to avoid the known hang mode.

## Validation notes

- Scope checked: orchestration index; unit dossiers 01-07; representative unit verify/review artifacts; source plan, PRD, ADRs; active-local protocol/server/extension implementation; client retargeting; Tailscale Serve integration; dev launcher; smoke script; docs/status/safety greps; working tree status/staging.
- Targeted tests: one combined targeted run failed on a racy dev launcher test; the dev launcher test file passed when rerun alone.
- Smoke was not run because the review found it does not disable default Tailscale auto-exposure and may mutate real operator Tailscale Serve state.
- Full workspace `npm test` / `npm run typecheck` were not rerun in this review.

## commandsRun

- `git status --short && printf '\n--- staged ---\n' && git diff --cached --name-only && printf '\n--- stat ---\n' && git diff --stat` — passed inspection; broad intentional working tree changes present; no staged files.
- `npm test -- packages/server/test/tailscaleServe.test.ts packages/server/test/devLauncher.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/resilience.test.ts packages/extension/test/localFallback.test.ts` — failed once; 4 files passed, `packages/server/test/devLauncher.test.ts` failed 1/4 tests with `backend?.args` undefined.
- `npm test -- packages/server/test/devLauncher.test.ts --reporter=verbose` — passed; 1 file / 4 tests.
- `git diff --cached --name-only` — passed; no output / no staged files.
- `rg -n -- "tailscale\\s+funnel|--funnel|--public" packages/server/src scripts README.md docs/configuration.md docs/deployment.md || true` — passed; no automatic Funnel/public command path found.
- `rg -n -- "--no-tailscale|PI_POSTBOX_TAILSCALE" scripts/smoke-postbox.mjs || true` — passed as evidence for finding; no smoke opt-out match found.
- `nl -ba packages/server/src/cli.ts | sed -n '205,305p'` and `nl -ba scripts/smoke-postbox.mjs | sed -n '145,178p'` — source line inspection for findings.

## noFileEdits

- No implementation, test, product documentation, protocol, server, extension, dev launcher, or smoke files were edited by this reviewer.
- This review artifact was written as requested.
