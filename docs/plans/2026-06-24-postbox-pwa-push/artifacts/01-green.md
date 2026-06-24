# Unit 01 GREEN — Server push config + subscription persistence

## changedFiles
- `package.json`
- `package-lock.json`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/push.ts`
- `packages/protocol/src/push.test.ts`
- `packages/server/package.json`
- `packages/server/src/app.ts`
- `packages/server/src/db/database.ts`
- `packages/server/src/routes/pushRoutes.ts`
- `packages/server/src/services/pushStore.ts`
- `packages/server/test/pushRoutes.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/01-green.md`

## testsAddedOrUpdated
- `packages/protocol/src/push.test.ts`
- `packages/server/test/pushRoutes.test.ts`

## commandsRun
- `npm install web-push -w @pi-postbox/server && npm install -D @types/web-push` — passed; added `web-push` runtime dependency for the server workspace and TypeScript declarations.
- `npm install web-push` — passed; added `web-push` to the published root package runtime dependencies.
- `npx vitest run packages/protocol/src/push.test.ts packages/server/test/pushRoutes.test.ts` — passed; 2 files / 5 tests.
- `npm run typecheck` — passed; `tsc -b` completed.
- `npm test` — passed; 35 files / 189 tests.
- `git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — passed; no staged files.

## validationOutput
- Focused Vitest: `Test Files  2 passed (2)`, `Tests  5 passed (5)`.
- Typecheck: `> tsc -b` completed without diagnostics.
- Full Vitest: `Test Files  35 passed (35)`, `Tests  189 passed (189)`.
- Git staged check: `git diff --cached --name-only` returned no paths.

## implementationNotes
- Added push protocol schemas/exports for public push config, subscription upsert payloads, and subscription delete payloads.
- Added SQLite migrations for persisted generated VAPID key metadata and browser push subscriptions.
- Added `PushStore` using `web-push.generateVAPIDKeys()` to generate and persist local VAPID keys when configured keys are absent.
- Added `GET /api/push/config`, `POST /api/push/subscriptions`, and `DELETE /api/push/subscriptions` routes.
- Configured VAPID keys can be supplied via `createPostboxApp({ vapidPublicKey, vapidPrivateKey })` or `PI_POSTBOX_VAPID_PUBLIC_KEY` / `PI_POSTBOX_VAPID_PRIVATE_KEY` (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` fallback).
- No notification sending was implemented in this unit.

## residualRisks
- Generated VAPID keys are tied to the SQLite database; deleting the database will invalidate existing browser subscriptions.
- The Unit 01 subscription API has no listing endpoint by design, so persistence is validated via idempotent route behavior rather than public readback.

## noStagedFiles
true
