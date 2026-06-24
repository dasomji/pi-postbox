# U1 RED: Package metadata and tarball shape

## changedFiles
- `packages/server/test/packageDocs.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/01-red.md`

## testsAddedOrUpdated
- Updated `release packaging and operator docs > exposes the combined public Pi package and shell CLI metadata`
  - Asserts root `package.json` is the public package `@wienerberliner/pi-postbox`.
  - Asserts the package is publishable/discoverable (`private !== true`, `keywords` includes `pi-package`, `publishConfig.access: public`).
  - Asserts root `pi.extensions` points at `packages/extension/src/index.ts`.
  - Asserts root `bin.pi-postbox-server` points at `packages/server/dist/cli.js`.
- Added `release packaging and operator docs > packs the combined runtime without local Pi/cache/secret files`
  - Runs `npm pack --dry-run --json` through the public npm package interface.
  - Asserts the tarball includes README/package metadata, extension source entrypoint, protocol build, server CLI build, and server web assets.
  - Asserts the tarball excludes obvious local/cache/secret paths such as `.pi/`, `node_modules/`, `tmp/`, `.env`, and `.DS_Store`.
- Added `release packaging and operator docs > documents Pi package install separately from global shell CLI install`
  - Asserts README documents `pi install npm:@wienerberliner/pi-postbox` for Pi package install.
  - Asserts README documents `npm install -g @wienerberliner/pi-postbox` for shell CLI install.
  - Asserts README mentions `pi-postbox-server` without implying `pi install` puts that command on shell `PATH`.

## commandsRun
- `npm test -- packages/server/test/packageDocs.test.ts` — failed as expected (RED).
- `git diff -- packages/server/test/packageDocs.test.ts && git status --short && git diff --cached --stat` — inspected test diff/status; no staged files reported by the cached diff command.

## validationOutput
Targeted test command failed with the intended missing U1 behavior:

```text
FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > exposes the combined public Pi package and shell CLI metadata
AssertionError: expected 'pi-postbox-workspace' to be '@wienerberliner/pi-postbox'

FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > packs the combined runtime without local Pi/cache/secret files
AssertionError: expected [
  "packages/protocol/dist/index.js",
  "packages/server/dist/cli.js",
] to deeply equal []

FAIL packages/server/test/packageDocs.test.ts > release packaging and operator docs > documents Pi package install separately from global shell CLI install
AssertionError: expected README.md to contain 'pi install npm:@wienerberliner/pi-postbox'

Test Files 1 failed (1)
Tests 3 failed | 6 passed (9)
```

The failures prove the current package is still the old private workspace shape, the dry-run tarball is missing required built protocol/server runtime files, and the README still documents the old install story instead of the combined public package.

## residualRisks
- The tarball test observes `npm pack --dry-run --json`; a future GREEN implementation may need a prepack/build path or checked-in generated assets so a clean checkout dry-run contains `packages/protocol/dist`, `packages/server/dist/cli.js`, and `packages/server/dist/public/*`.
- The repo already had unrelated unstaged/untracked files before this RED pass (`CONTEXT.md`, `README.md`, `.pi/`, and plan/ADR files). I only edited the package docs test and this artifact.

## noStagedFiles
true
