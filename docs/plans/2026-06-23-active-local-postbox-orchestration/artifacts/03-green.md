# Unit 03 GREEN — Dev launcher active-local role marker

## changedFiles

- `scripts/dev.mjs`: backend `pi-postbox-server` spawn now includes the Unit 02 CLI marker `--active-local-role dev` while preserving `--host 127.0.0.1`, `--port <API_PORT>`, and the web `POSTBOX_DEV_API_PORT` environment wiring.
- `docs/plans/2026-06-23-active-local-postbox-orchestration/artifacts/03-green.md`: GREEN evidence artifact.

## commandsRun

- `npm test -- packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts` — passed.
- `git diff -- scripts/dev.mjs && git status --short && git diff --cached --name-only` — inspected the focused production diff and confirmed no staged files at that point.

## validationOutput

Targeted GREEN validation:

```text
> pi-postbox-workspace@0.1.0 test
> vitest run packages/server/test/cli.test.ts packages/server/test/devLauncher.test.ts


 RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard


 Test Files  2 passed (2)
      Tests  10 passed (10)
   Start at  14:09:05
   Duration  717ms (transform 299ms, setup 0ms, import 482ms, tests 250ms, environment 0ms)
```

Focused diff evidence:

```diff
-start("server", "pi-postbox-server", ["--host", "127.0.0.1", "--port", String(API_PORT)]);
+start("server", "pi-postbox-server", [
+  "--host",
+  "127.0.0.1",
+  "--port",
+  String(API_PORT),
+  "--active-local-role",
+  "dev"
+]);
```

## residualRisks

- No known Unit 03 implementation risk; change is limited to adding the accepted CLI role marker to the dev backend spawn.
- Existing unrelated working tree changes from prior units remain present and un-staged.

## noStagedFiles

true
