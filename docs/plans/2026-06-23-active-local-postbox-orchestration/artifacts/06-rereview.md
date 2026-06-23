## Findings

1. **Severity:** Medium  
   **Location:** `packages/server/test/devLauncher.test.ts:112`  
   **Requirement/pattern violated:** Unit 06 repair focus requires dev-launcher coverage to be robust when the canonical port `32187` is busy.  
   **Issue:** The new unset-`PI_POSTBOX_PORT` test executes `scripts/dev.mjs` against the real machine-global `127.0.0.1:32187` without owning or isolating that port. If any non-Postbox process is already listening there, the launcher correctly exits before spawning children, so the test fails even though the implementation behavior is expected. I reproduced this by holding `127.0.0.1:32187` open and running `npm test -- packages/server/test/devLauncher.test.ts`; the default-port test failed with `[dev] port :32187 is in use by a non-pi-postbox process...` and exit status `1`.  
   **Required fix:** Make the default-port assertion independent of ambient port availability (for example, test the default value via a refactored/importable launcher helper or source-level/static assertion, or have the test own a controlled fake Postbox listener on `32187` and force the shutdown path with cleanup). Avoid relying on `32187` being free in CI/developer machines.

## Claude reviewer

- Result: Skipped per task guidance due known prior hangs; no nested Claude command was run.

## Validation notes

- Accepted repair finding check: `scripts/dev.mjs` now defaults to `32187` when `PI_POSTBOX_PORT` is unset, preserves env override behavior, and starts the backend with `--active-local-role dev`.
- Accepted repair finding check: `packages/server/src/activeLocalTarget.ts` now matches extension/docs config-base precedence: `PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`.
- Scope checked: Unit 06 dossier, prior review and repair artifacts, repaired launcher/server/tests, package docs test, smoke script syntax, and operator/protocol docs for active-local/Tailscale/status scope.
- No Unit 07 automatic Tailscale Serve or `pi-postbox-server status` implementation was observed in the repaired diff. Existing `/postbox-status` local fallback docs are extension fallback command guidance, not server status CLI scope.
- Targeted validations passed under normal ambient conditions; the synthetic busy-port robustness check intentionally demonstrated the actionable test flake above.

## commandsRun

```text
git status --short && git diff --stat && git diff -- scripts/dev.mjs packages/server/src/activeLocalTarget.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts docs/plans/2026-06-23-active-local-postbox-orchestration/units/06-docs-smoke-operational-diagnostics.md docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-review.md docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/06-repair.md
# passed/read-only: showed broad Unit 01-06 working tree changes and repaired dev launcher diff
```

```text
npm test -- packages/server/test/packageDocs.test.ts packages/server/test/activeLocalTarget.test.ts packages/server/test/devLauncher.test.ts
# passed: Test Files 3 passed; Tests 15 passed
```

```text
node --check scripts/smoke-postbox.mjs
# passed: exit 0
```

```text
node --check scripts/dev.mjs
# passed: exit 0
```

```text
npm run typecheck -w @pi-postbox/server
# passed: tsc -p tsconfig.json --noEmit
```

```text
# Synthetic robustness check with a local dummy listener holding 127.0.0.1:32187:
npm test -- packages/server/test/devLauncher.test.ts
# failed as expected for this review finding: default-port test exited with [dev] port :32187 is in use by a non-pi-postbox process; devLauncher-with-32187-held-exit=1
```

```text
git diff --cached --name-only
# passed: no staged files
```

## noFileEdits

No implementation, test, or operator-doc files were edited by this reviewer. This review artifact was written as requested.
