# Unit 02 RED — Notify subscribers for new pending questions

## changedFiles
- `packages/server/test/pushNotifications.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/02-red.md`

## testsAddedOrUpdated
- `packages/server/test/pushNotifications.test.ts`
  - `new pending ask push notifications > fans out a new pending ask notification to subscriptions with project/session context and without prompt text`
    - Registers a browser push subscription through the public subscription route.
    - Registers an extension session over the public websocket with project/session metadata.
    - Creates a pending ask over the public websocket.
    - Expects the injected `pushSender.sendNotification` mock to be called once for the subscription.
    - Parses the push payload and asserts it includes generic title/body/data, request/session identity, project name, session title, and does not include the prompt text or its secret marker.
  - `new pending ask push notifications > does not send a second notification for an idempotent duplicate requestId`
    - Creates the same ask `requestId` twice over the websocket.
    - Expects only the first create to notify the injected sender.
  - `new pending ask push notifications > prunes subscriptions that return 404/410 push-service failures before later notification fanout`
    - Registers active and gone subscriptions through the public route.
    - Uses an injected sender mock that rejects the gone endpoint with `statusCode = 410`.
    - Expects the first ask to attempt both endpoints, then a second ask to fan out only to the active endpoint.

## commandsRun
- `npx vitest run packages/server/test/pushNotifications.test.ts` — failed as expected.
- `git status --short && printf '\n-- staged --\n' && git diff --cached --name-only` — passed; confirmed no staged files.

## validationOutput
- Targeted Vitest RED failed all 3 new tests because `pushSender.sendNotification` was never called:
  - `expected "vi.fn()" to be called 1 times, but got 0 times` for new ask fanout.
  - `expected "vi.fn()" to be called 1 times, but got 0 times` before the duplicate-idempotency assertion.
  - `expected "vi.fn()" to be called 2 times, but got 0 times` for first prune fanout.
- This is the expected RED failure: Unit 01 implemented push config/subscription persistence only; no notification sender injection, new-ask fanout hook, duplicate suppression, or 404/410 pruning exists yet.

## residualRisks
- The tests intentionally define the sender injection seam as `createPostboxApp({ pushSender: { sendNotification } })`, matching the `web-push.sendNotification(subscription, payload, options)` shape; GREEN should either implement that seam or deliberately update tests and implementation together.
- Payload assertions are privacy- and behavior-focused rather than a full protocol schema: they require generic title/body/data, project/session context, request/session identity, and no prompt text, but leave exact copy/layout flexible.
- Pruning is verified through public behavior by observing later fanout attempts rather than direct database inspection, because Unit 01 did not add a public subscription listing API.

## noStagedFiles
true
