# U1: Package metadata and tarball shape

## Contract
Make the root package publishable as `@wienerberliner/pi-postbox` with Pi package metadata, CLI bin metadata, bundled runtime files, and docs/package tests that lock the install story.

## Acceptance criteria
- Root `package.json` identifies the public package as `@wienerberliner/pi-postbox`.
- Root package is publishable publicly and discoverable as a Pi package (`keywords` includes `pi-package`, `publishConfig.access` is public or equivalent).
- Root `pi.extensions` points at the extension entrypoint.
- Root `bin.pi-postbox-server` points at the built server CLI.
- Package metadata/docs tests fail if docs imply `pi install` exposes shell `pi-postbox-server` on `PATH`.
- `npm pack --dry-run` contains required runtime files for extension, server CLI, protocol build, server web assets, README, and package metadata, and excludes obvious local/cache/secret files.

## Non-goals
- Do not implement autostart behavior in this unit.
- Do not change resolver status semantics in this unit.
- Do not create OS services or browser-open commands.

## Likely files/surfaces
- `package.json`
- `package-lock.json`
- `packages/extension/package.json`
- `packages/server/package.json`
- `packages/protocol/package.json`
- `scripts/copy-web-to-server.mjs`
- `packages/server/test/packageDocs.test.ts`
- `README.md` only if package docs assertions require small wording changes in U1

## Targeted verification commands
- `npm test -- packages/server/test/packageDocs.test.ts`
- `npm pack --dry-run`
- If metadata changes affect install graph: `npm install --package-lock-only` or equivalent safe lockfile update command, as needed.

## Evidence expectations
- RED artifact should show package/docs test additions failing before implementation.
- GREEN artifact should show focused package docs test passing and dry-run pack output summary.

## Current state
Pending RED.

## Phase artifacts
- RED: `../artifacts/01-red.md`
- GREEN: `../artifacts/01-green.md`
- REVIEW: `../artifacts/01-review.md`
- VERIFY: `../artifacts/01-verify.md`
