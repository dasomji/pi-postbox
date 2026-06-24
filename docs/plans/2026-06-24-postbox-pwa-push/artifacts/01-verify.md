# Unit 01 VERIFY — Server push config + subscription persistence

## result

PASS

## requirementsChecked

- **Generated VAPID stable across DB restart:** PASS. Focused route test and API evidence both confirm `GET /api/push/config` returns `source: "generated"` and the same public key after closing/recreating the app with the same SQLite database.
- **Configured key path:** PASS. Repair test covers `createPostboxApp({ vapidPublicKey, vapidPrivateKey })`; API evidence also confirms `PI_POSTBOX_VAPID_PUBLIC_KEY` / `PI_POSTBOX_VAPID_PRIVATE_KEY` returns `source: "configured"` with the configured public key.
- **Config route:** PASS. `GET /api/push/config` is registered and returns schema-validated `200` responses for generated and configured keys.
- **Subscription upsert/delete:** PASS. `POST /api/push/subscriptions` returns `204` for first and duplicate saves, database row count remains `1`, `DELETE /api/push/subscriptions` returns `204`, and database row count becomes `0`.
- **Malformed rejection:** PASS. Protocol schema rejects missing `keys.auth`; route returns `400` with `error: "invalid_push_subscription"`.
- **No notification sending:** PASS. Source grep found no `sendNotification` or `setVapidDetails` calls in Unit 01 server/protocol paths; only `webPush.generateVAPIDKeys()` is used.
- **Scope boundary:** PASS. Changes are limited to protocol schemas/tests, server DB/app/routes/store/tests, package dependency metadata, and planning/verification artifacts. No service worker/client UI or notification sending implementation is present.

## commandsRun

- `npx vitest run packages/protocol/src/push.test.ts packages/server/test/pushRoutes.test.ts` — PASS; 2 files / 6 tests.
- `npm run typecheck` — PASS; `tsc -b` completed without diagnostics.
- `npm test` — PASS; 35 files / 190 tests.
- `npm run build` — PASS; `tsc -b`, web Vite build, and web asset copy completed.
- API evidence script using `node --input-type=module` against `packages/server/dist/app.js` — PASS; captured generated restart stability, configured options, subscription upsert/delete persistence, and malformed rejection transcript.
- `PI_POSTBOX_VAPID_PUBLIC_KEY=... PI_POSTBOX_VAPID_PRIVATE_KEY=... node --input-type=module ...` — PASS; env-configured key path returned `source: "configured"`.
- `grep -R "sendNotification\|setVapidDetails" packages/server/src packages/server/test packages/protocol/src || echo ...` — PASS; no notification-send setup/calls found.
- `git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — PASS; no staged files.
- `{ git diff --name-only; git ls-files --others --exclude-standard; } | sort` — PASS; changed-file inventory captured.

## evidenceArtifacts

- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/01-api-evidence.txt` — CLI/API transcript with real Fastify request/response behavior and DB row-count checks.

## skippedGates

- **Lint:** skipped; no lint script/configured gate found in `package.json`.
- **Format check:** skipped; no format check script/configured gate found in `package.json`.
- **Release smoke (`npm run smoke`):** skipped for this Unit 01 verification because it validates the packaged ask/request workflow, requires the built CLI path, and does not exercise the new push config/subscription API. `npm run build`, focused tests, full tests, and direct API evidence were run instead.
- **Browser/UI evidence:** not applicable to Unit 01 server/API-only scope; product evidence captured as an API transcript.

## issuesFound

None.

## residualRisks

- Generated VAPID keys are intentionally tied to the SQLite database; deleting/replacing the database will invalidate existing browser subscriptions and require re-subscription.
- Unit 01 has no public subscription listing endpoint by design, so persistence evidence uses direct database row-count checks plus idempotent route behavior.

## noStagedFiles

true
