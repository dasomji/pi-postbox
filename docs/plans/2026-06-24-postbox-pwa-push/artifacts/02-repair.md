# Unit 02 repair — tighten push subscription endpoint validation

## changedFiles

- `packages/protocol/src/push.ts`
- `packages/protocol/src/push.test.ts`
- `packages/server/test/pushRoutes.test.ts`
- `docs/plans/2026-06-24-postbox-pwa-push/artifacts/02-repair.md`

## testsAddedOrUpdated

- `packages/protocol/src/push.test.ts`
  - Extended the non-Web-Push endpoint regression to reject an IPv4-mapped IPv6 private literal host.
- `packages/server/test/pushRoutes.test.ts`
  - Extended subscription route coverage to reject plaintext HTTP, localhost, private IPv4, IPv4 link-local, IPv4-mapped IPv6 private, and IPv6 link-local endpoints before persistence.

## commandsRun

- `npx vitest run packages/protocol/src/push.test.ts packages/server/test/pushRoutes.test.ts` — failed as expected before the repair on `https://[::ffff:192.168.1.5]/push`.
- `npx vitest run packages/protocol/src/push.test.ts packages/server/test/pushRoutes.test.ts packages/server/test/pushNotifications.test.ts` — passed; 3 files / 12 tests.
- `npm run typecheck` — passed; `tsc -b` completed without diagnostics.

## validationOutput

- Initial focused RED: protocol schema accepted the IPv4-mapped private literal and the server route returned 204 instead of 400.
- Focused push tests after repair: `Test Files  3 passed (3)`, `Tests  12 passed (12)`.
- Typecheck: `tsc -b` completed without diagnostics.

## implementationNotes

- Kept validation inside the existing protocol subscription schema used by the server route.
- Subscription endpoints must remain HTTPS and must not use localhost, private IPv4, IPv4 link-local, IPv4-mapped private IPv6, IPv6 loopback, IPv6 link-local, or IPv6 unique-local literal hosts.
- No provider allowlist or DNS resolution was added.

## residualRisks

- DNS names that resolve to private/link-local addresses are not resolved or blocked; this repair only rejects literal hosts as requested.

## noStagedFiles

- true
