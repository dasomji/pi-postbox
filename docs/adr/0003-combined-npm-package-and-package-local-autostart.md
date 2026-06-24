# ADR 0003: Combined npm package and package-local autostart

## Status

Accepted

## Context

Pi Postbox has two related operator surfaces:

1. A Pi extension that registers Pi Sessions and exposes `ask_postbox`.
2. A server CLI, `pi-postbox-server`, that hosts the dashboard and request API.

Pi package installation is the correct mechanism for loading extensions into Pi, but it does not expose npm package binaries on the user's shell `PATH`. Users should not need to understand whether the server is already running before using Postbox, and a Pi-installed package should be able to recover by starting a local server even when the shell CLI was not globally installed.

The current workspace also has multiple internal packages (`@pi-postbox/extension`, `@pi-postbox/server`, and `@pi-postbox/protocol`). Publishing those as separate user-facing packages would make installation and documentation more complex than the product requires.

## Decision

Publish a single user-facing npm package, `@wienerberliner/pi-postbox`, that contains both the Pi extension and the server CLI implementation.

Users install the Pi extension with:

```bash
pi install npm:@wienerberliner/pi-postbox
```

`pi install npm:@wienerberliner/pi-postbox` installs the Pi resources/extension resources and the bundled package-local autostart support. It does not add shell binaries to `PATH`.

Users who want the manual shell command on `PATH` install the same package globally with:

```bash
npm install -g @wienerberliner/pi-postbox
```

The package exposes:

- Pi package metadata pointing at the extension entrypoint.
- A `bin` entry for `pi-postbox-server`.
- The built server, built protocol package, and built web UI needed for runtime.

The extension may autostart a package-local server process when a Postbox Question or user-only dashboard open needs a server and no preferred or active local server is reachable. The extension should prefer a bundled server CLI path inside the installed package and fall back to `pi-postbox-server` on `PATH` only when the package-local path is unavailable.

Autostart is enabled by default. `PI_POSTBOX_AUTOSTART=off` opts out, and `PI_POSTBOX_AUTOSTART_TIMEOUT_MS` controls the wait for recovery; the default timeout is 10 seconds (`10000` ms).

A configured `PI_POSTBOX_URL` or config `serverUrl` is a preferred Postbox server. The extension tries it first. If it is unreachable or unavailable, the extension may start an autostarted package-local Postbox server. Once a Pi Session registers with a fallback/autostarted server, session stickiness applies: it remains attached to that server until reload or restart rather than migrating mid-session.

## Consequences

- A single package name is documented for both Pi install and optional global CLI install.
- `pi install npm:@wienerberliner/pi-postbox` is enough for normal Postbox usage because autostart can use the bundled server.
- Users who expect a shell command still need the separate npm global install, because Pi package installation does not mutate shell `PATH`.
- The published tarball must include all runtime resources referenced by the Pi manifest and `bin` entry, including server build output and web UI assets.
- Internal package imports must resolve correctly from the published package. Either internal workspace packages must be bundled into the tarball or runtime imports must be made package-relative.
- Autostart creates a reusable background server process, not an operating-system service. It may outlive the Pi Session that started it so other local Pi Sessions can reuse it through active-local discovery.
