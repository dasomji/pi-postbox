# Unit 03 VERIFY — Dev launcher active-local role marker

## FAIL

Unit 03 is **not complete** for acceptance because the required targeted validation gate failed in the newly added dev launcher test. Source inspection shows the implementation adds `--active-local-role dev` and preserves the web env line, but the verification gate is red: the test did not observe the web `npm run dev -w @pi-postbox/web` invocation.

## requirementsChecked

- Dev launcher passes the Unit 02 marker: **source-inspection pass** — `scripts/dev.mjs:240-246` starts `pi-postbox-server` with `--host 127.0.0.1`, `--port String(API_PORT)`, and `--active-local-role dev`.
- Direct CLI defaults remain production: **test pass/source pass** — `packages/server/src/cli.ts:51-55` defaults omitted active-local role to `production`; `packages/server/test/cli.test.ts:64-70` covers the default.
- CLI accepts marker used by dev launcher: **test pass/source pass** — `packages/server/test/cli.test.ts:91-128` covers `--active-local-role=dev`, `--active-local-role dev`, env override, and invalid values.
- Existing dev launcher web behavior: **not accepted** — source line `scripts/dev.mjs:248` still starts `npm run dev -w @pi-postbox/web` with `POSTBOX_DEV_API_PORT`, but the required dev launcher test failed because the fake `npm` invocation was not recorded.
- Unit scope boundaries: **source-inspection pass** — focused `scripts/dev.mjs` diff only adds the backend role marker; grep found no `database`/dev DB path changes in `scripts/dev.mjs`.

## commandsRun

- `git status --short && printf '\n-- cached --\n' && git diff --cached --name-only` — passed; no staged files before verification artifact write.
- `git diff --stat -- scripts/dev.mjs packages/server/test/devLauncher.test.ts packages/server/test/cli.test.ts packages/server/src/cli.ts` — passed; showed focused tracked diff for `scripts/dev.mjs`, `packages/server/src/cli.ts`, and `packages/server/test/cli.test.ts` (untracked `devLauncher.test.ts` not included by git diff stat).
- `git diff -- scripts/dev.mjs packages/server/test/devLauncher.test.ts packages/server/test/cli.test.ts packages/server/src/cli.ts` — passed; inspected focused tracked diff.
- `grep -RIn "active-local-role\|activeLocalRole\|PI_POSTBOX_ACTIVE_LOCAL_ROLE\|POSTBOX_DEV_API_PORT\|pi-postbox-server" scripts/dev.mjs packages/server/src/cli.ts packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed; confirmed marker and env locations.
- `npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — **failed**; 1 failed dev launcher test, 9 passed CLI tests.
- `npm test -- packages/server/test/cli.test.ts` — passed; 9 tests passed.
- `nl -ba scripts/dev.mjs | sed -n '232,250p' && ...` — passed; captured line-number source evidence.
- `npm test -- packages/server/test/devLauncher.test.ts` — **failed**; isolated same dev launcher test failure.
- `grep -n "database\|POSTBOX_DEV_API_PORT\|--active-local-role\|PI_POSTBOX_PORT" scripts/dev.mjs` — passed; confirmed no database path occurrence and located marker/web env lines.
- `git status --short && printf '\n-- cached --\n' && git diff --cached --name-only` — passed after writing this artifact; no staged files.

## validationOutput

Required targeted gate failed:

```text
$ npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts

> pi-postbox-workspace@0.1.0 test
> vitest run packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts

 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

 ❯ packages/server/test/devLauncher.test.ts (1 test | 1 failed) 100ms
     × starts the backend as the active-local dev target while preserving API port and web proxy env 98ms

 FAIL  packages/server/test/devLauncher.test.ts > scripts/dev.mjs > starts the backend as the active-local dev target while preserving API port and web proxy env
AssertionError: expected undefined to match object { …(2) }

- Expected:
{
  "args": [
    "run",
    "dev",
    "-w",
    "@pi-postbox/web",
  ],
  "postboxDevApiPort": "35817",
}

+ Received:
undefined

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 9 passed (10)
```

CLI parser targeted gate passed independently:

```text
$ npm test -- packages/server/test/cli.test.ts

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

Isolated dev launcher gate failed the same way:

```text
$ npm test -- packages/server/test/devLauncher.test.ts

 FAIL  packages/server/test/devLauncher.test.ts > scripts/dev.mjs > starts the backend as the active-local dev target while preserving API port and web proxy env
AssertionError: expected undefined to match object { …(2) }

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

Source-inspection evidence:

```text
scripts/dev.mjs:240:start("server", "pi-postbox-server", [
scripts/dev.mjs:245:  "--active-local-role",
scripts/dev.mjs:248:start("web", "npm", ["run", "dev", "-w", "@pi-postbox/web"], { POSTBOX_DEV_API_PORT: String(API_PORT) });
packages/server/src/cli.ts:51:  const activeLocalRoleText = getFlagValue("--active-local-role") ?? env.PI_POSTBOX_ACTIVE_LOCAL_ROLE ?? "production";
packages/server/test/cli.test.ts:97:          "--active-local-role=dev",
packages/server/test/cli.test.ts:119:    expect(parseCliOptions([], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "dev" })).toMatchObject({ activeLocalRole: "dev" });
packages/server/test/cli.test.ts:121:      parseCliOptions(["--active-local-role", "dev"], { PI_POSTBOX_ACTIVE_LOCAL_ROLE: "production" })
```

No dev database path change evidence:

```text
$ grep -n "database\|POSTBOX_DEV_API_PORT\|--active-local-role\|PI_POSTBOX_PORT" scripts/dev.mjs
10:// The backend binds the CANONICAL port (PI_POSTBOX_PORT, else 3000) — the same
27:const API_PORT = Number(process.env.PI_POSTBOX_PORT) || 3000;
161:        `Free it, or set PI_POSTBOX_PORT to a free port (and point the extension's serverUrl there).`
245:  "--active-local-role",
248:start("web", "npm", ["run", "dev", "-w", "@pi-postbox/web"], { POSTBOX_DEV_API_PORT: String(API_PORT) });
```

## evidenceArtifacts

- Verification artifact: `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/03-verify.md`.
- CLI/test/source-inspection transcript evidence is embedded above.
- Browser/CDP evidence: not applicable to this CLI/dev-launcher unit and unavailable per orchestration context.

## skippedGates

- Full `npm test` — skipped because the required targeted gate already failed; broader suite would not repair acceptance for Unit 03.
- `npm run typecheck` / build — skipped because Unit 03 implementation change is in `scripts/dev.mjs`, and acceptance requested the targeted CLI/dev-launcher tests; also the required targeted test is currently failing.
- Browser/CDP evidence — not applicable/unavailable for this CLI launcher behavior.

## issuesFound

- Blocking: `packages/server/test/devLauncher.test.ts` fails to observe the web fake `npm` invocation (`web` is `undefined`) in both combined and isolated runs. This violates the required validation gate and means Unit 03 cannot be accepted as complete, even though source inspection shows the implementation line exists.

## residualRisks

- The implementation marker itself appears correct by source inspection, but the dev launcher test seam may be racy because fake child commands exit immediately and can trigger orchestrator shutdown before the fake web command records its invocation.
- No real long-running `npm run dev`/server process was launched, by safety constraint.

## noStagedFiles

true
