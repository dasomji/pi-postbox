# Unit 01 repair — configured VAPID push config coverage

## changedFiles

- `packages/server/test/pushRoutes.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/01-repair.md`

## testsAdded

- Added focused route coverage for `createPostboxApp({ vapidPublicKey, vapidPrivateKey })` asserting `GET /api/push/config` returns `available: true`, the configured public key, and `source: "configured"`.

## commandsRun

- `npx vitest run packages/server/test/pushRoutes.test.ts` — passed.
- `npm run typecheck` — passed.
- `test -z "$(git diff --cached --name-only)" && echo "no staged files"` — passed.

## validationOutput

- Vitest: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- TypeScript: `tsc -b` completed successfully.
- Git index check: `no staged files`.

## residualRisks

- None known.

## noStagedFiles

- true
