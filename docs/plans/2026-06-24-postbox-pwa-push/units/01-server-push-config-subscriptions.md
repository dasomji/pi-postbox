# Unit 01 — Server push config + subscription persistence

Current state: READY FOR RED.

Acceptance criteria:
- Database migration creates storage for VAPID key metadata and push subscriptions.
- Server exposes push config with public key and source (`configured` or `generated`) when keys are available.
- If VAPID env/config keys are absent, server generates and persists a local keypair so it is stable across app restarts using the same database.
- Server can upsert and delete browser push subscriptions by endpoint.
- Payload validation rejects malformed subscriptions.
- No actual external push sends in this unit.

Likely files:
- `packages/protocol/src/*`
- `packages/server/src/db/database.ts`
- `packages/server/src/app.ts`
- new `packages/server/src/services/pushStore.ts` / `pushService.ts`
- new `packages/server/src/routes/pushRoutes.ts`
- server tests under `packages/server/test/` and protocol tests.

Targeted validation:
- focused Vitest for routes/persistence.
- typecheck if feasible.

Non-goals:
- No service worker/client UI yet.
- No notification sending yet.
