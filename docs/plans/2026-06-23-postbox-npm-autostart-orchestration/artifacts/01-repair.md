# U1 REPAIR: packed runtime protocol resolution

## changedFiles
- `package.json`
- `package-lock.json`
- `packages/server/test/packageDocs.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/01-repair.md`

## commandsRun
- `npm test -- packages/server/test/packageDocs.test.ts` — failed before repair with the new regression check proving the packed global install could not resolve `@pi-postbox/protocol` from the installed server CLI path.
- `npm install --package-lock-only` — passed; refreshed the lockfile after adding the root file dependency and bundled dependency metadata for `@pi-postbox/protocol`.
- `npm test -- packages/server/test/packageDocs.test.ts` — passed; 10 tests passed, including the packed global install import/CLI resolution regression.
- `npm pack --dry-run` — passed; prepack built the workspace and the dry-run tarball includes bundled `@pi-postbox/protocol` plus its runtime `zod` dependency.
- `npm test -- packages/server/test/packageDocs.test.ts -t "resolves protocol imports and the CLI from a packed global install"` — passed; focused regression installed the packed tarball into a temporary global prefix, resolved `@pi-postbox/protocol` from the installed CLI directory, verified the global `pi-postbox-server` bin target, and ran `pi-postbox-server status --json` with an isolated config directory.
- `git status --short && git diff --cached --stat` — passed; inspected worktree/staging state and confirmed no staged files.

## validationOutput
```text
> @wienerberliner/pi-postbox@0.1.0 test
> vitest run packages/server/test/packageDocs.test.ts

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

```text
> @wienerberliner/pi-postbox@0.1.0 test
> vitest run packages/server/test/packageDocs.test.ts -t resolves protocol imports and the CLI from a packed global install

 Test Files  1 passed (1)
      Tests  1 passed | 9 skipped (10)
```

```text
npm notice 📦  @wienerberliner/pi-postbox@0.1.0
npm notice Bundled Dependencies
npm notice zod
npm notice @pi-postbox/protocol
npm notice filename: wienerberliner-pi-postbox-0.1.0.tgz
npm notice total files: 706
```

## residualRisks
- Bundling `@pi-postbox/protocol` also bundles its `zod` runtime dependency, increasing the dry-run package from the previous 88 files to 706 files. This is intentional for install-path resolution but may deserve package-size review later.
- Existing unrelated unstaged/untracked work remains in the worktree (`CONTEXT.md`, `README.md`, `.pi/`, ADR/plan files). This repair did not stage files.

## noStagedFiles
true
