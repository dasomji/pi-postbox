# Pi Postbox agent routing

- [Glossary](GLOSSARY.md): domain terms and lifecycle boundaries.
- [Development](docs/agents/development.md): stack, isolated profiles and build freshness.
- [Verification](docs/agents/verify.md): exact check commands and hook setup.
- [Android gotchas](docs/agents/android.md): generated contract, streaming, privacy and IME.
- [Doors](docs/agents/doors.md), [ADRs](docs/adr/) and [out of scope](docs/out-of-scope/): review boundaries and decisions.
- [README](README.md), [configuration](docs/configuration.md) and [deployment](docs/deployment.md): product/operator contracts.

Every repository change must bump the project version in the same change, keeping
root, workspace packages and lockfile metadata synchronized. Never reuse a version
for different repository states. Running health/status must identify the exact
executable build; a checkout ID or static protocol version is insufficient.

After protocol, server, extension or generated-output changes, rebuild and restart
the checkout development server before manual or agent verification. Prove its
process start is newer than the tested source/build and match exact version/build
identity. Reload Pi when registration/tool schemas change; fully restart it when
shared protocol modules remain cached. Never verify a stale process: refresh first.

Development uses checkout-specific state outside the worktree, API port `45795`
and a separate Vite port; production uses `32187`. Never stop production to free a
development port. There are no app-level login accounts. Keep automatic memory off.

<!-- prettier-ignore-start -->

<!-- BEGIN PLANE PROJECT -->

## Plane project

- Workspace: Personal
- Workspace slug: personal
- Workspace ID: c51280e8-6121-4a07-b25a-244d6dc466b2
- Name: Pi Postbox
- Identifier: POSTBOX
- Project ID: d4676922-3fa1-4877-8b0b-8ae49299b1c0
- Instance: https://plane.audiopoesis.com

<!-- END PLANE PROJECT -->

<!-- prettier-ignore-end -->
