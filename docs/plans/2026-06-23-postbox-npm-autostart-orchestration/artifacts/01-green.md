# U1 GREEN: Package metadata and tarball shape

## changedFiles
- `package.json`
- `package-lock.json`
- `README.md`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/01-green.md`

## commandsRun
- `npm install --package-lock-only` — passed; refreshed the root lockfile metadata/dependency graph for the public package name, root CLI bin, and runtime dependencies.
- `npm test -- packages/server/test/packageDocs.test.ts` — failed once while README wording still matched the new guardrail regex; fixed the wording.
- `npm test -- packages/server/test/packageDocs.test.ts` — passed after README wording fix; 9 tests passed.
- `npm pack --dry-run` — passed; prepack ran `npm run build`, built the web UI, copied assets into `packages/server/dist/public`, and produced dry-run tarball `wienerberliner-pi-postbox-0.1.0.tgz` with 88 files.
- `git status --short && git diff -- package.json package-lock.json README.md packages/server/test/packageDocs.test.ts | sed -n '1,220p' && git diff --cached --stat` — passed; inspected diff/status and confirmed no staged files.

## validationOutput
```text
> @wienerberliner/pi-postbox@0.1.0 test
> vitest run packages/server/test/packageDocs.test.ts

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

```text
npm notice 📦  @wienerberliner/pi-postbox@0.1.0
npm notice filename: wienerberliner-pi-postbox-0.1.0.tgz
npm notice package size: 109.8 kB
npm notice unpacked size: 563.7 kB
npm notice total files: 88
npm notice Tarball Contents included README.md, package.json, packages/extension/src/*, packages/protocol/dist/index.js, packages/server/dist/cli.js, and packages/server/dist/public/*.
```

## residualRisks
- The package-shape tests do not execute the packed global CLI after install. Root runtime dependencies now include `fastify` and `zod`, but the built server/extension still import the workspace protocol package by its internal `@pi-postbox/protocol` specifier; runtime install validation may need a follow-up dependency/import resolution check if not covered by a later unit.
- Running `npm pack --dry-run` generated ignored build outputs under workspace `dist` directories via the new `prepack` build path.
- Pre-existing unrelated unstaged/untracked files remain in the worktree (`CONTEXT.md`, `.pi/`, planning/ADR files, and the RED test artifact area). They were not staged.

## noStagedFiles
true
