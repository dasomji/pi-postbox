# U3 VERIFY: Package-local server autostart supervisor

## result

PASS for U3 package-local server autostart supervisor.

## requirementsChecked

- **U3 ask_postbox autostarts only when needed and completes the ask.** `ask_postbox` invokes the mutating recovery path only when no client/current registration exists (`packages/extension/src/index.ts:93-109`). Product evidence in `/tmp/pi-postbox-u3-autostart-evidence-ZZnngA/evidence.json` shows a real extension session reached `Postbox unavailable`, then a real package-local server published active-local metadata at `http://127.0.0.1:45379/`, the ask appeared pending, was answered through the server API, and `ask_postbox` returned `status: answered`.
- **Healthy preferred server is used without autostart (R3).** Ask-time retry resolves preferred/active targets before spawning (`packages/extension/src/index.ts:300-329`). Regression coverage includes recovered preferred-server no-spawn behavior (`packages/extension/test/autostart.test.ts:201`) and the targeted/full tests passed.
- **Existing active-local server is reused without spawning (R3).** Resolver/retry paths select healthy active-local metadata before autostart (`packages/extension/src/index.ts:300-323`), covered by `packages/extension/test/autostart.test.ts:238` and `packages/extension/test/autostart.test.ts:311`.
- **Opt-out and bounded timeout (R5).** `PI_POSTBOX_AUTOSTART=off` is recognized (`packages/extension/src/autostart.ts:21-29`, `:47-51`), timeout defaults to `10000ms` and honors positive `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` (`packages/extension/src/autostart.ts:21`, `:31-37`), and the wait path reports timeout/failure diagnostics (`packages/extension/src/index.ts:326-348`). Covered by `packages/extension/test/autostart.test.ts:269` and `:286`.
- **Package-local CLI preferred, PATH fallback diagnostic, failure recovery.** Autostart resolves `node <package-root>/packages/server/dist/cli.js` first and falls back to `pi-postbox-server` with diagnostics (`packages/extension/src/autostart.ts:98-115`). Child `error`/`exit` handlers clear cache and remember diagnostics (`packages/extension/src/autostart.ts:71-85`, `:122-130`). Covered by `packages/extension/test/autostart.test.ts:362`.
- **Autostarted child is reusable and not killed on session shutdown.** Autostart children are detached/unref'd and not tracked for shutdown kill (`packages/extension/src/autostart.ts:63-89`); `session_shutdown` stops the Postbox client/supervisor but does not kill the child (`packages/extension/src/index.ts:123-132`). Covered by `packages/extension/test/autostart.test.ts:337`.
- **R4 fallback-local session stickiness.** Active-local clients receive a session-sticky resolver that skips configured remote recovery and rejects different local targets (`packages/extension/src/index.ts:172-179`, `:268-298`). Covered by `packages/extension/test/extension.test.ts:273` and `:319`.
- **R7 scope boundary respected for U3.** U3 provides helper plumbing for later `/postbox` use but does not implement browser opening, matching the U3 non-goal; registered commands in product evidence remained `postbox-answer`, `postbox-cancel`, and `postbox-status` only.

## commandsRun

- `git status --short && echo '---CACHED---' && git diff --cached --name-only && echo '---STAT---' && git diff --stat` — passed; inspected existing worktree and confirmed no staged files before verification.
- `npm test -- packages/extension/test/autostart.test.ts` — passed; 1 test file / 9 tests.
- `npm test -- packages/extension/test/askPostbox.test.ts packages/extension/test/extension.test.ts packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/localFallback.test.ts packages/extension/test/resilience.test.ts` — passed; 5 test files / 40 tests.
- `npm run typecheck` — passed; `tsc -b` completed successfully.
- `npm test` — passed; 28 test files / 156 tests.
- `node /tmp/pi-postbox-u3-autostart-evidence.mjs` — passed; real extension + real package-local server autostart evidence captured at `/tmp/pi-postbox-u3-autostart-evidence-ZZnngA/evidence.json`.
- `npm run build` — passed; `tsc -b`, Vite web build, and web asset copy completed.
- `nl -ba ...` / `grep -n ...` source-evidence inspection commands — passed; line-numbered checks recorded for autostart/index/test coverage.

## evidenceArtifacts

- `/tmp/pi-postbox-u3-autostart-evidence-ZZnngA/evidence.json` — product evidence transcript. Key facts: server URL `http://127.0.0.1:45379/`; `/healthz` returned `{ ok: true, service: "pi-postbox", localTarget.role: "production" }`; pending request `u3-evidence-1782246826888` was observed before answer; answer endpoint returned `200`; `ask_postbox` returned `status: answered`; admin shutdown returned `202`.
- Test/build transcripts are in this verification session output; no screenshots/video applicable because U3 behavior is extension/API/CLI workflow, not browser UI.

## skippedGates

- `npm run smoke` — skipped as redundant for U3 after full `npm test`, `npm run build`, and a more targeted real autostart product-evidence script passed. The smoke script validates the release server path, not the extension autostart supervisor specifically.

## issuesFound

No blocking or actionable U3 issues found.

## residualRisks

- PATH fallback behavior is covered by mocked child-process tests, not a real missing-package-local/real-PATH-fallback product run.
- Full `/postbox` browser-opening behavior is not verified here because U3 explicitly defers it to U5; only U3 helper/scope behavior was checked against R7.
- Documentation consistency is deferred to U6; for example, `README.md:104` still contains wording about explicit non-loopback URLs disabling local recovery, which does not match the R3 preferred-then-fallback behavior verified in code/tests.

## noStagedFiles

true
