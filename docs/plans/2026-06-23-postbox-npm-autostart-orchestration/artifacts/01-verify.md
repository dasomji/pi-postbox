# U1 VERIFY: Package metadata and tarball shape

## result
PASS for U1 package metadata/tarball shape.

## requirementsChecked
- **R1 / U1 public package identity:** PASS. Root `package.json` is named `@wienerberliner/pi-postbox`, is not private, includes `keywords: ["pi-package", ...]`, and sets `publishConfig.access: "public"`. `npm pack --dry-run --json` reported `wienerberliner-pi-postbox-0.1.0.tgz` for `@wienerberliner/pi-postbox@0.1.0`.
- **R2 / Pi extension and shell CLI metadata:** PASS. Root `package.json` has `pi.extensions: ["./packages/extension/src/index.ts"]` and `bin.pi-postbox-server: "./packages/server/dist/cli.js"`. Manual packed-global-install evidence resolved the installed bin to `$PREFIX/lib/node_modules/@wienerberliner/pi-postbox/packages/server/dist/cli.js` and ran `pi-postbox-server status --json` successfully.
- **R8 / two install stories documented distinctly:** PASS. `packages/server/test/packageDocs.test.ts` passed the README guard asserting both `pi install npm:@wienerberliner/pi-postbox` and `npm install -g @wienerberliner/pi-postbox`, and rejecting wording that implies `pi install` exposes `pi-postbox-server` on shell `PATH`.
- **U1 tarball runtime shape:** PASS. Dry-run pack summary found required README/package metadata, extension source entrypoint, protocol dist, bundled protocol dependency files, server CLI build, and server web assets; forbidden local/cache/secret paths count was 0.
- **Repair finding regression (`@pi-postbox/protocol` resolution):** PASS. The focused packed-install test passed, and independent manual evidence imported `@pi-postbox/protocol` from the installed server CLI tree with output `pi-postbox`.

## commandsRun
- `npm test -- packages/server/test/packageDocs.test.ts` — passed; Vitest reported 1 file passed, 10 tests passed in 16.48s.
- `npm pack --dry-run --json | node -e '<summarize required/forbidden files>'` — passed; prepack ran `npm run build` (`tsc -b`, web build, asset copy). Summary: `totalFiles: 706`, `missingRequiredFiles: []`, `hasServerWebAssets: true`, `bundledProtocolFiles: 22`, `bundledZodFiles: 596`, `forbiddenCount: 0`.
- `npm test -- packages/server/test/packageDocs.test.ts -t "resolves protocol imports and the CLI from a packed global install"` — passed; Vitest reported 1 passed, 9 skipped in the target file.
- Manual packed install/import/CLI evidence script using `npm pack --json --pack-destination`, `npm install --global --prefix`, Node import from installed `packages/server/dist`, bin realpath check, and `pi-postbox-server status --json` — first attempt failed due the harness parsing prepack build stdout as pure JSON; rerun with robust JSON extraction passed.
- `git status --porcelain=v1 && git diff --cached --name-only` — passed; showed existing unstaged/untracked work and no staged files.

## evidenceArtifacts
- This verification artifact: `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/01-verify.md`.
- Product CLI/package transcript from independent packed global install:

```text
tarball=wienerberliner-pi-postbox-0.1.0.tgz
protocol-import=pi-postbox
bin-target=$PREFIX/lib/node_modules/@wienerberliner/pi-postbox/packages/server/dist/cli.js
status-json={"availability":"unavailable","hasDiagnostics":true,"localUrl":null}
```

- Dry-run tarball evidence:

```json
{
  "name": "@wienerberliner/pi-postbox",
  "version": "0.1.0",
  "filename": "wienerberliner-pi-postbox-0.1.0.tgz",
  "totalFiles": 706,
  "missingRequiredFiles": [],
  "hasServerWebAssets": true,
  "bundledProtocolFiles": 22,
  "bundledZodFiles": 596,
  "forbiddenCount": 0,
  "forbiddenSample": []
}
```

## skippedGates
- Full `npm test` suite: skipped because U1 scope and user-requested gates target package/docs/tarball/install resolution; no broader app behavior changed in this unit.
- Separate `npm run typecheck`: skipped as a standalone gate because `npm pack --dry-run` ran `prepack`, which ran `npm run build` including `tsc -b`.
- Browser/UI screenshot or recording: not applicable to U1 package metadata/CLI install shape; CLI transcript evidence was captured instead.
- Actual registry `npm publish` / remote `pi install npm:`: skipped as unsafe/out of scope; verification used local `npm pack` and packed global install instead.

## issuesFound
None.

## residualRisks
- Verification proves local tarball shape and local packed global install behavior, not actual npm registry publication/discoverability after publish.
- The package currently bundles `@pi-postbox/protocol` and its `zod` dependency, producing a 706-file dry-run tarball; this is intentional for runtime resolution but may warrant future package-size review.
- Existing unrelated unstaged/untracked work remains in the worktree and was not modified except for this verification artifact.

## noStagedFiles
true
