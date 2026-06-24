# Postbox PWA + push notifications for new questions

Current state: PLAN CREATED; next action RED for Unit 01 after role preflight. User requested a plan first, then full first pass: PWA installability plus push notifications for new questions.

## Goal
Make Pi Postbox installable as a PWA and allow browsers to subscribe to push notifications. When a new pending question is created, subscribed browsers receive a notification.

## User decisions via Postbox
- Scope: full first pass, but create a plan first.
- Notification privacy: include project/session context only, not the full question prompt.
- VAPID keys: generate local keys if missing, persist them, and warn/indicate stable configured keys are preferred for production.

## Product requirements
- Web app has manifest/service worker enough for installability.
- UI exposes notification subscription status and enable/disable actions.
- Browser permission is requested only from user action.
- Push notification fires for newly-created pending questions.
- Notification content avoids prompt text; use generic title/body with project/session context if available.
- App click from notification opens/focuses Postbox.
- Works behind current Tailscale/no-auth trust model; no public auth work in this slice.

## Proposed architecture
- Add protocol schemas/types for push public config and subscription registration payload.
- Add SQLite tables for push subscriptions and generated VAPID keys/config metadata.
- Add server service for push config/subscription persistence and notification sending.
- Add HTTP routes:
  - `GET /api/push/config` -> `{ available, publicKey?, source, message? }`.
  - `POST /api/push/subscriptions` -> upsert current browser subscription.
  - `DELETE /api/push/subscriptions` -> remove by endpoint.
- Use `web-push` package. Context7 docs confirm `generateVAPIDKeys()`, `setVapidDetails(subject, publicKey, privateKey)`, and `sendNotification(subscription, payload, options)`.
- Server initializes VAPID from env/config if provided; otherwise persists generated local keys in SQLite (or a server config table) and marks source as generated.
- Hook notification send after `RequestStore.create()` succeeds and broadcaster broadcasts. Do not notify on idempotent duplicate requestId.
- Client registers `/sw.js` service worker, subscribes using VAPID public key, stores subscription server-side, and lets user disable by unsubscribe + DELETE.
- Service worker handles `push` and `notificationclick`.

## Units
1. [Server push configuration + subscription persistence](units/01-server-push-config-subscriptions.md)
2. [Notify subscribers for new questions](units/02-server-send-new-question-notifications.md)
3. [PWA manifest/service worker installability](units/03-pwa-shell-service-worker.md)
4. [Client notification subscription UI](units/04-client-notification-ui.md)
5. Final review/verification with smoke/build/tests.

## Validation strategy
- Focused Vitest for protocol/server push routes and persistence.
- Unit tests for notification sender using injected/mock sender so tests do not call external push services.
- Web static/unit tests for service worker registration/subscription helpers where feasible.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke`.
- Browser screenshot/e2e may be blocked if Chrome/Chromium remains unavailable; verifier should document fallback.

## Risks / open questions
- Browser push requires HTTPS or localhost. Tailscale HTTPS serve should satisfy remote phone use; local HTTP may be limited to localhost.
- iOS/WebKit PWA push has install/permission constraints; Honor Magic V3 Android/Chrome should be standard Web Push capable.
- Generated VAPID keys must persist. If database is deleted, existing browser subscriptions become invalid and need re-subscribe.
- No app-level auth: anyone on Tailnet reaching the app can subscribe to notifications. This matches current trust boundary.
