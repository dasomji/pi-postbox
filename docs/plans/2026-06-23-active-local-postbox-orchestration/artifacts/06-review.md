## Findings

1. **Severity:** High  
   **Location:** `docs/deployment.md:42`  
   **Requirement/pattern violated:** Unit 06 docs must accurately describe `32187`, role flag/env, and dev launcher behavior.  
   **Issue:** The deployment docs say `npm run dev` uses `PI_POSTBOX_PORT`, else `32187`, but `scripts/dev.mjs` still documents and implements `PI_POSTBOX_PORT`, else `3000` (`scripts/dev.mjs:10`, `scripts/dev.mjs:27`). Operators following the updated docs will expect active-local dev to run on `32187`, while the actual dev launcher starts on `3000` unless overridden.  
   **Required fix:** Align the dev launcher with the documented/current default (or, if `3000` remains intentional, update Unit 06 docs/tests to state the real behavior and resolve the `32187` acceptance conflict).

2. **Severity:** Medium  
   **Location:** `packages/server/src/activeLocalTarget.ts:109`  
   **Requirement/pattern violated:** Unit 06 config-base convention: `PI_POSTBOX_CONFIG_DIR`, else dirname of `PI_POSTBOX_CONFIG_PATH`, else `~/.pi-postbox`; docs must be accurate to implementation.  
   **Issue:** The docs now state the required precedence (`docs/configuration.md:68`, `README.md:95`), and the extension resolver implements it (`packages/extension/src/activeLocalTargetResolver.ts:254`). The server metadata publisher does the opposite when both env vars are set: it prefers `PI_POSTBOX_CONFIG_PATH` before `PI_POSTBOX_CONFIG_DIR`. If an operator sets both to different locations, the server writes active-local metadata under one base while the extension reads another, breaking local recovery despite docs saying otherwise.  
   **Required fix:** Change the server active-local config-base helper to prefer `PI_POSTBOX_CONFIG_DIR` before `PI_POSTBOX_CONFIG_PATH`, and add/adjust coverage so server publisher and extension resolver share the documented precedence.

## Claude reviewer

- Result: Claude reviewer unavailable/skipped to avoid known hang from prior runs 906de82d/c5237741, per task allowance. No nested Claude command was run.

## Validation notes

- Commands run, if any:
  - `git status --short && git diff --stat && git diff -- README.md docs/configuration.md docs/deployment.md docs/protocol.md scripts/smoke-postbox.mjs packages/server/test/packageDocs.test.ts`
  - `grep -RIn "automatic\\|auto\\|status\\|tailscale serve\\|Tailscale Serve\\|pi-postbox-server status\\|--no-tailscale\\|PI_POSTBOX_TAILSCALE" README.md docs/configuration.md docs/deployment.md docs/protocol.md | head -100`
  - `grep -RIn "3000" README.md docs/configuration.md docs/deployment.md docs/protocol.md scripts/smoke-postbox.mjs packages/server/test/packageDocs.test.ts || true`
  - `npm test -- packages/server/test/packageDocs.test.ts && node --check scripts/smoke-postbox.mjs && git diff --cached --name-only`
  - `node --check scripts/smoke-postbox.mjs; printf 'node-check-exit=%s\\n' "$?"; staged=$(git diff --cached --name-only); if [ -n "$staged" ]; then printf '%s\\n' "$staged"; exit 1; else echo 'no staged files'; fi`
  - `nl -ba scripts/dev.mjs | sed -n '8,28p'; nl -ba docs/deployment.md | sed -n '35,43p'`
  - `nl -ba packages/extension/src/activeLocalTargetResolver.ts | sed -n '254,265p'; nl -ba packages/server/src/activeLocalTarget.ts | sed -n '105,116p'`
- Scope checked: Unit 06 dossier, RED/GREEN artifacts, parent U6 plan, touched docs, package docs tests, smoke script, and relevant implementation references for port/defaults, active-local path precedence, health identity, and resolver behavior.
- Targeted validation passed: package docs tests passed (6 tests); smoke script syntax check exited 0; no staged files before writing this review artifact.

## commandsRun

```text
npm test -- packages/server/test/packageDocs.test.ts
# passed: Test Files 1 passed; Tests 6 passed

node --check scripts/smoke-postbox.mjs
# passed: exit 0

git diff --cached --name-only
# no output before artifact write
```

## noFileEdits

No implementation, test, or operator-doc files were edited by this reviewer. This review artifact was written as requested.
