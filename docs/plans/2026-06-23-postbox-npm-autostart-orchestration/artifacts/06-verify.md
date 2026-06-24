# U6 VERIFY: documentation, ADR alignment, and smoke coverage

## result

PASS for U6 docs/smoke alignment.

## requirementsChecked

- **U6 install guidance / R8:** PASS. `README.md:58-79`, `docs/configuration.md:18-23`, `docs/deployment.md:28-33` and `docs/adr/0003-combined-npm-package-and-package-local-autostart.md:24-34` distinguish `pi install npm:@wienerberliner/pi-postbox` for Pi resources/bundled package-local autostart from `npm install -g @wienerberliner/pi-postbox` for manual shell `pi-postbox-server` usage. Focused package/docs tests also assert this distinction at `packages/server/test/packageDocs.test.ts:172-207`.
- **R1/R2 package shape remains protected:** PASS. `packages/server/test/packageDocs.test.ts:96-118` checks required packed runtime files and forbidden local/cache/secret paths; `packages/server/test/packageDocs.test.ts:121-165` validates a packed global install can resolve the protocol import and `pi-postbox-server` bin. The targeted package docs test passed.
- **Autostart controls and preferred fallback / R5:** PASS. Docs cover preferred-server fallback, fallback/autostart session stickiness, `PI_POSTBOX_AUTOSTART=off`, `PI_POSTBOX_AUTOSTART_TIMEOUT_MS`, and the 10 second / `10000` ms default at `README.md:106-108`, `docs/configuration.md:88-92`, `docs/deployment.md:86-106`, `docs/protocol.md:106-110`, and `docs/adr/0003-combined-npm-package-and-package-local-autostart.md:42-46`. Package/docs tests assert the same at `packages/server/test/packageDocs.test.ts:209-235`.
- **Status surfaces and privacy / R6:** PASS. `/postbox-status` and read-only `postbox_status` are documented with connectivity/local URL/Tailnet/export/open-question/autostart/diagnostics fields and no pending question content/history at `README.md:153-161`, `docs/configuration.md:112-124`, `docs/protocol.md:65-69`, and `docs/deployment.md:157-159`. Package/docs tests assert the status/privacy coverage at `packages/server/test/packageDocs.test.ts:237-259`.
- **User-only browser command / R7:** PASS. `/postbox` is documented as a user-only/manual browser-opening command, with recovery/autostart when needed and no LLM/tool browser-opening side effect, at `README.md:161`, `docs/configuration.md:124`, `docs/protocol.md:69`, and `docs/deployment.md:159`.
- **Smoke/release path:** PASS. `npm run build` refreshed the built CLI/UI path, and `npm run smoke` proved the built server can answer `/healthz`, serve the UI shell, register a fake extension, stream SSE state, answer a question, and return state/history.

## commandsRun

- `npm test -- packages/server/test/packageDocs.test.ts` — passed; 1 test file passed, 13 tests passed. Log: `/tmp/pi-postbox-u6-verify/packageDocs.log`.
- `npm run build` — passed; `tsc -b`, Vite production build, and web asset copy completed. Log: `/tmp/pi-postbox-u6-verify/build.log`.
- `npm run typecheck` — passed; `tsc -b` completed. Log: `/tmp/pi-postbox-u6-verify/typecheck.log`.
- `npm run smoke` — passed; release smoke printed `Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.` Log: `/tmp/pi-postbox-u6-verify/smoke.log`.
- `npm test` — passed; 30 test files passed, 171 tests passed. Log: `/tmp/pi-postbox-u6-verify/full-test.log`.
- `git diff --cached --name-only && git status --short` — passed; cached output was empty, working tree remains dirty with existing U1-U6/planning changes.

## evidenceArtifacts

- Verification artifact: `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/06-verify.md`.
- Package/docs test transcript: `/tmp/pi-postbox-u6-verify/packageDocs.log`.
- Build transcript: `/tmp/pi-postbox-u6-verify/build.log`.
- Typecheck transcript: `/tmp/pi-postbox-u6-verify/typecheck.log`.
- Product smoke transcript: `/tmp/pi-postbox-u6-verify/smoke.log`.
- Full test transcript: `/tmp/pi-postbox-u6-verify/full-test.log`.

## skippedGates

- Lint/format checks: skipped because `package.json` exposes no `lint`, `format`, or `format:check` scripts.
- Remote `pi install`, npm publish, and external Tailscale/Funnel validation: skipped as unsafe/out of scope for U6 and explicitly non-goals.

## issuesFound

None.

## residualRisks

- Smoke validates the built local release path, not an actual remote `pi install npm:@wienerberliner/pi-postbox` or npm-published artifact.
- Browser opening for `/postbox` is documented and covered elsewhere in U5; U6 verification did not launch a real OS browser because this unit is docs/smoke alignment and the safe smoke path is CLI/server based.
- The worktree contains broad pre-existing U1-U6/planning changes and untracked files; this verification only assessed U6 alignment and did not review every unrelated changed implementation line.

## noStagedFiles

true
