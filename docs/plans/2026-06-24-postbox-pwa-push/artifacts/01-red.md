# Unit 01 RED — Server push config + subscription persistence

## changedFiles
- `packages/protocol/src/push.test.ts`
- `packages/server/test/pushRoutes.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/01-red.md`

## testsAddedOrUpdated
- `packages/protocol/src/push.test.ts`
  - `Postbox push protocol > validates the public push config response exposed to browsers`
    - Asserts `PushConfigResponseSchema` is exported and accepts `{ available: true, publicKey, source: "generated" }`.
  - `Postbox push protocol > validates browser push subscription payloads and rejects malformed subscriptions`
    - Asserts `PushSubscriptionPayloadSchema` is exported, accepts a browser `PushSubscription.toJSON()`-style payload, and rejects missing `keys.auth`.
- `packages/server/test/pushRoutes.test.ts`
  - `push configuration and subscription routes > generates and persists a browser push public key across restarts using the same database`
    - Asserts `GET /api/push/config` returns `200` with `{ available: true, source: "generated", publicKey }` and the same public key after closing/recreating the app with the same SQLite database path.
  - `push configuration and subscription routes > upserts and deletes a valid browser push subscription by endpoint`
    - Asserts duplicate `POST /api/push/subscriptions` calls for the same endpoint both return `204`, and `DELETE /api/push/subscriptions` by endpoint returns `204`.
  - `push configuration and subscription routes > rejects malformed browser push subscription payloads`
    - Asserts malformed subscription payloads return `400` with `error: "invalid_push_subscription"`.

## commandsRun
- `npx vitest run packages/protocol/src/push.test.ts` — failed as expected.
- `npx vitest run packages/server/test/pushRoutes.test.ts` — failed as expected.
- `git diff --cached --name-only` — passed; no staged files.
- `git status --short && printf '\\n-- staged --\\n' && git diff --cached --name-only` — passed; confirmed only unstaged/untracked files and no staged files.

## validationOutput
- Protocol RED: both tests fail because `PushConfigResponseSchema` and `PushSubscriptionPayloadSchema` are not exported from `@pi-postbox/protocol` yet.
- Server RED: all three tests fail with `404` for `/api/push/config` and `/api/push/subscriptions`, proving the push routes are not registered/implemented yet.

## residualRisks
- Tests intentionally specify `204` for successful subscription upsert/delete responses; if the GREEN design prefers response bodies, update the tests and implementation together deliberately.
- Subscription persistence is verified through public route idempotence and VAPID persistence through restart; there is no public subscription listing API in the plan, so tests do not assert internal table rows directly.

## noStagedFiles
true
