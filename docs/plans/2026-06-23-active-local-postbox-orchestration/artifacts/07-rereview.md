# Unit 07 REREVIEW — Tailnet-private Tailscale Serve repair

## Findings

No blocking or actionable findings.

## Claude reviewer

- Result: Not run. The task allowed skipping/recording unavailable due known prior hangs unless bounded to <=8 seconds; nested Claude was skipped to avoid the known hang mode.

## Validation notes

- Scope checked: Unit dossier, prior review, repair and green artifacts, repaired implementation/tests (`scripts/dev.mjs`, `packages/server/src/tailscaleServe.ts`, `packages/server/src/cli.ts`, `packages/server/test/devLauncher.test.ts`, `packages/server/test/tailscaleServe.test.ts`), Tailscale Funnel grep, targeted tests, server typecheck, dev script syntax, and staging state.
- Accepted finding 1 rechecked: `scripts/dev.mjs` launches the backend child with `--active-local-role dev` and `--no-tailscale`, while launcher-managed Tailscale Serve still targets the selected Vite UI port and honors `PI_POSTBOX_TAILSCALE=off` before any Tailscale command.
- Accepted finding 2 rechecked: `packages/server/src/tailscaleServe.ts` now gates bare-port fallback behind `isLoopbackUrlTargetRejection`; non-target-form Serve failures return an unavailable diagnostic without a fallback mutation, with focused regression coverage.
- No `tailscale funnel` or public/Funnel automatic exposure command path was found in source/scripts; docs grep found no automatic public/Funnel command path.
- Staging check produced no staged files.

## commandsRun

- `git status --short && git diff --name-only && git diff --cached --name-only` — passed; working tree has unstaged/untracked work from this unit/earlier units, and no staged files.
- `grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts README.md docs/configuration.md docs/deployment.md || true` — passed; no matches.
- `npm test -- packages/server/test/tailscaleServe.test.ts` — passed; 1 file / 9 tests.
- `npm test -- packages/server/test/devLauncher.test.ts` — passed; 1 file / 4 tests.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/tailscaleServe.test.ts packages/server/test/packageDocs.test.ts` — passed; 3 files / 27 tests.
- `npm run typecheck -w @pi-postbox/server` — passed; no TypeScript errors.
- `node --check scripts/dev.mjs` — passed with no output.
- `grep -RInE 'tailscale[[:space:]]+funnel|\bfunnel\b' packages/server/src scripts || true` — passed; no matches.
- `grep -RInE 'tailscale[[:space:]]+funnel[[:space:]]+--bg|pi-postbox-server[^\n]*(--funnel|--public)|automatic[^\n]*(public|Funnel)' README.md docs/configuration.md docs/deployment.md || true` — passed; no matches.
- `git diff --cached --name-only` — passed; no staged files.

## noFileEdits

- No implementation, test, or product documentation files were edited by this reviewer.
- This rereview artifact was written as requested.
