# Development

Use Node **22.19.0 or newer** and npm workspaces. The root package combines the Pi
extension and CLI; `packages/protocol` owns TypeScript/Zod contracts,
`packages/server` uses Fastify, better-sqlite3 and WebSocket/SSE transports,
`packages/extension` runs on Pi's SDK, and `apps/web` uses Svelte 5, Vite and
Tailwind. `apps/android` is a separate Kotlin/Compose Gradle app, outside npm
workspaces and the published tarball. Domain terms live in [GLOSSARY](../../GLOSSARY.md).

## Install and boot

Run builds, installs and tests on Coolify. From this checkout:

```bash
npm ci
npm run build
npm run dev
```

`npm run dev` invokes `scripts/dev.mjs`. It builds protocol/backend, derives
`development:<checkout-id>` from the canonical checkout path, and starts the API
on **45795** plus Vite on a separate selected port. Mutable state lives under
`$XDG_STATE_HOME/pi-postbox/dev/<checkout-id>` (normally
`~/.local/state/pi-postbox/dev/<checkout-id>`), including SQLite, process metadata
and `dev-ports.json`. Product data must stay outside the worktree.

Installed packages use the production profile, default port **32187**. The local
extension selects development only when loaded from that checkout with Pi's cwd
inside it; trusted `.pi/settings.json` provides the project package override.
See [profile isolation](../adr/0005-package-provenance-isolates-server-profiles.md).
Use distinct explicit `PI_POSTBOX_PORT` values for concurrent worktrees, and
`POSTBOX_DEV_WEB_PORT` if a fixed frontend port is needed. Both ports must differ.
The launcher persists/reselects the Vite preference; an occupied API port fails.
Never stop production to resolve a conflict or share its database/config directory.

For fully isolated experiments set `PI_POSTBOX_PROFILE_STATE_DIR` to a dedicated
outside-worktree directory for the launcher. Extension config overrides are
`PI_POSTBOX_CONFIG_DIR` / `PI_POSTBOX_CONFIG_PATH`; align these deliberately with
the test profile. Set `PI_POSTBOX_TAILSCALE=off` for local tests. For private
previews use a worktree-specific URL/mapping and the actual printed frontend port;
never reset shared Serve mappings. [Deployment](../deployment.md) explains exposure.

## Build and process identity

The built CLI serves `packages/server/dist/public`, a build-time copy of
`apps/web/dist`. A server restart alone does not incorporate web source edits;
run `npm run build`, restart the checkout process and refresh the browser.
Vite provides source HMR, but backend/extension/protocol changes still need their
build/restart steps. `npm run typecheck` is `tsc -b` and writes build output.

Every repository change bumps the project version in that same change. Keep root,
all workspace manifests and lock metadata synchronized; never reuse a version for
different states. Application version and protocol version are separate identities.
`packages/server/src/runtimeIdentity.ts` fingerprints executable content; do not
replace it with a static checkout identifier.

Before manual/agent verification after protocol/server/extension/generated changes:

1. Build all affected outputs and restart this checkout's server.
2. Inspect its process start time (for example `ps -o pid,lstart,args -p <pid>`)
   and verify it is newer than the tested source and build output.
3. Read `/healthz` at the explicit checkout URL. Match application version,
   protocol, profile, instance and `buildId` against this built runtime; connectivity
   and profile alone do not prove freshness.
4. Reload Pi after extension registration/tool-schema changes. Fully restart Pi
   after shared protocol changes if native ESM imports survive `/reload`. Use the
   built checkout extension and compatible schemas throughout the journey.

If freshness cannot be established, refresh the environment before testing. Never
present an older process's result as verification of the new build. Use
[verify.md](verify.md) for exact rungs, isolated DB/boot checks and receipts.

## Database and seeding

`packages/server/src/db/database.ts` opens SQLite with WAL/foreign keys and applies
startup migrations. Use an isolated temporary database for migration/boot proof;
copy and verify a backup outside the checkout before testing changes on existing
schemas. Back up `<database-path>.images` together with SQLite. Media references
belong to retained Question revisions; removing a current gallery does not license
deleting referenced historical blobs. See [Question images](../question-images.md).

There is **no app-level login** or account seeding. Dev/test login credentials do
not apply. Use synthetic sessions, Questions and image fixtures with isolated
storage and disabled push/exposure for automated tests. Tailnet/proxy access is
the trust boundary, including model spend and scoped repository reads by Chat.

## Android

Use JDK **17**, the committed Gradle wrapper and Android SDK (compile/target **36**,
minimum **26**). Configure `ANDROID_HOME` / `ANDROID_SDK_ROOT` outside git, then:

```bash
npm run check:android-protocol-contract
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The protocol package and fixture generator own Android wire contracts. Regenerate
with `npm run generate:android-protocol-contract` after intentional schema changes;
review the source/fixture/generated changes together and never hand-edit generated
Kotlin or hide drift. Protocol changes also require compatible server/extension
builds and a Pi restart. See [Android install](../../apps/android/README.md) and
[Android gotchas](android.md) for lifecycle, renderer, IME and device proof limits.

Keep secrets in a secret manager; do not put them in repository docs, logs or test
fixtures. Automatic memory stays disabled. Review durable knowledge as repository
edits; temporary ticket plans/research/handoffs belong in `docs/work/<ticket>/` and
are removed before merge. Store verification captures outside git, review for
private data, upload with `evidence put <file> --ticket <ticket> --markdown`, and
retain textual outcomes because links expire after 30 days.
