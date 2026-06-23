# Unit 03 VERIFY RERUN — Dev launcher active-local role marker

## PASS|FAIL|BLOCKED

PASS for Unit 03. Unit 03 is complete against its acceptance criteria after repair.

The prior verifier failure is fixed: the dev launcher test now records both fake child invocations deterministically, the required targeted gate passes, repeated isolated dev-launcher runs pass, and a stale-process check found no leftover fake/dev launcher child processes.

Note: a broader `npm test` run still fails in `packages/server/test/packageDocs.test.ts` because operator docs do not contain the unrelated string `lizardtail postbox`. I do not treat that as blocking Unit 03 because the required Unit 03 gates and source evidence pass, and Unit 03 does not modify operator docs.

## requirementsChecked

- Dev launcher starts backend with Unit 02 marker: PASS. `scripts/dev.mjs:240-247` starts `pi-postbox-server` with `--host 127.0.0.1 --port String(API_PORT) --active-local-role dev`.
- Direct `pi-postbox-server` launches default to production: PASS. `packages/server/src/cli.ts:51` defaults omitted role to `production`; `packages/server/test/cli.test.ts:64-70` asserts `activeLocalRole: "production"`.
- CLI accepts the marker used by the dev launcher: PASS. `packages/server/test/cli.test.ts:91-128` covers equals-form `--active-local-role=dev`, space-form `--active-local-role dev`, env role `PI_POSTBOX_ACTIVE_LOCAL_ROLE=dev`, and invalid values.
- Existing dev launcher behavior remains intact: PASS. `packages/server/test/devLauncher.test.ts:88-101` asserts backend host/port/role args and web `npm run dev -w @pi-postbox/web` with `POSTBOX_DEV_API_PORT=<PI_POSTBOX_PORT>`; targeted tests passed.
- Previous verifier failure fixed: PASS. The repaired fake `pi-postbox-server` stays alive until SIGTERM (`packages/server/test/devLauncher.test.ts:54-56`), allowing fake `npm` to record its invocation before orchestrator shutdown.
- Test seam does not leave stale child processes: PASS. Post-test `pgrep -af '[p]i-postbox-dev-launcher|[D]EV_LAUNCHER_INVOCATIONS|[s]cripts/dev.mjs' || true` produced no output after targeted/repeated runs.
- Unit scope boundaries: PASS. Focused `scripts/dev.mjs` diff is limited to adding the backend role marker; grep found no dev database path change in `scripts/dev.mjs`.

## commandsRun

- `git status --short && printf '\n-- cached --\n' && git diff --cached --name-only` — passed; no staged files.
- `git diff -- scripts/dev.mjs packages/server/test/devLauncher.test.ts packages/server/test/cli.test.ts packages/server/src/cli.ts` — passed; inspected focused source/test changes.
- `grep -RIn "active-local-role\|activeLocalRole\|PI_POSTBOX_ACTIVE_LOCAL_ROLE\|POSTBOX_DEV_API_PORT\|pi-postbox-server" scripts/dev.mjs packages/server/src/cli.ts packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed; source-inspection evidence captured.
- `grep -n "database\|POSTBOX_DEV_API_PORT\|--active-local-role\|PI_POSTBOX_PORT" scripts/dev.mjs` — passed; no database path wiring found.
- `pgrep -af '[p]i-postbox-dev-launcher|[D]EV_LAUNCHER_INVOCATIONS|[s]cripts/dev.mjs' || true` — passed before/after tests; no stale matching processes.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed; 2 files / 10 tests passed.
- `npm test -- packages/server/test/devLauncher.test.ts` — passed; 1 file / 1 test passed.
- `for i in 1 2 3; do echo "--- devLauncher repeat $i ---"; npm test -- packages/server/test/devLauncher.test.ts || exit $?; done` — passed; 3 consecutive isolated dev launcher runs passed.
- `nl -ba scripts/dev.mjs | sed -n '232,252p'; ...` — passed; line-number evidence captured for launcher, repaired seam, and CLI parser/tests.
- `npm run typecheck -w @pi-postbox/server` — passed.
- `npm test` — failed outside Unit 03 scope; `packages/server/test/packageDocs.test.ts` expects docs to contain `lizardtail postbox`.

## validationOutput

Required targeted gate:

```text
$ npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts

Test Files  2 passed (2)
Tests       10 passed (10)
Duration    758ms
```

Isolated dev launcher gate:

```text
$ npm test -- packages/server/test/devLauncher.test.ts

Test Files  1 passed (1)
Tests       1 passed (1)
Duration    327ms
```

Repeat stability check:

```text
$ for i in 1 2 3; do echo "--- devLauncher repeat $i ---"; npm test -- packages/server/test/devLauncher.test.ts || exit $?; done

--- devLauncher repeat 1 ---
Test Files  1 passed (1)
Tests       1 passed (1)

--- devLauncher repeat 2 ---
Test Files  1 passed (1)
Tests       1 passed (1)

--- devLauncher repeat 3 ---
Test Files  1 passed (1)
Tests       1 passed (1)
```

Typecheck:

```text
$ npm run typecheck -w @pi-postbox/server

> @pi-postbox/server@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

Source-inspection excerpt:

```text
scripts/dev.mjs:240:start("server", "pi-postbox-server", [
scripts/dev.mjs:245:  "--active-local-role",
scripts/dev.mjs:248:start("web", "npm", ["run", "dev", "-w", "@pi-postbox/web"], { POSTBOX_DEV_API_PORT: String(API_PORT) });
packages/server/src/cli.ts:51:  const activeLocalRoleText = getFlagValue("--active-local-role") ?? env.PI_POSTBOX_ACTIVE_LOCAL_ROLE ?? "production";
packages/server/test/cli.test.ts:97:          "--active-local-role=dev",
packages/server/test/cli.test.ts:119:    expect(parseCliOptions([], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "dev" })).toMatchObject({ activeLocalRole: "dev" });
packages/server/test/cli.test.ts:121:      parseCliOptions(["--active-local-role", "dev"], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "production" })
```

Repaired test seam excerpt:

```text
packages/server/test/devLauncher.test.ts:54 if (command === "pi-postbox-server") {
packages/server/test/devLauncher.test.ts:55   process.on("SIGTERM", () => process.exit(0));
packages/server/test/devLauncher.test.ts:56   setInterval(() => {}, 1000);
```

Stale-process check:

```text
$ pgrep -af '[p]i-postbox-dev-launcher|[D]EV_LAUNCHER_INVOCATIONS|[s]cripts/dev.mjs' || true
# no output
```

Broader suite result, non-blocking for Unit 03:

```text
$ npm test

Test Files  1 failed | 24 passed (25)
Tests       1 failed | 95 passed (96)

FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents configuration, deployment boundary, endpoints, and manual smoke testing
AssertionError: expected docs to contain 'lizardtail postbox'
```

No staged files check before artifact write:

```text
$ git diff --cached --name-only
# no output
```

## evidenceArtifacts

- This verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/03-verify-rerun.md`.
- CLI/test/source-inspection transcript evidence embedded above.
- Browser/CDP evidence: unavailable per orchestration context and not applicable to this CLI/dev-launcher behavior.

## skippedGates

- Browser/CDP screenshot/recording — not applicable to a CLI dev-launcher role wiring unit, and browser/CDP is unavailable per orchestration context.
- Build/smoke — skipped as not targeted to Unit 03 launcher role wiring after the required targeted gates, repeated stability check, typecheck, and broad `npm test` had already been run; `npm test` currently has an unrelated docs expectation failure.

## issuesFound

- No blocking Unit 03 issues.
- Non-blocking broader repo issue observed: `npm test` fails in `packages/server/test/packageDocs.test.ts` because docs lack the unrelated phrase `lizardtail postbox`.

## residualRisks

- The dev launcher behavior is verified through a subprocess/PATH fake-command seam rather than launching real long-running Vite/server processes, by design and per safety constraints.
- Broader repository tests are not fully green because of the unrelated docs expectation noted above.

## noStagedFiles

true
