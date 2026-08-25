# Pi Postbox Development Instructions

## Version discipline

- Every repository change must update the project version in the same change. Keep the root and all workspace package versions, plus lockfile metadata, synchronized; do not reuse a version for different repository states.
- Development build identity and health/status output must make it possible to distinguish the exact running build. Do not treat a checkout-only identifier or a static protocol version as proof that the running process contains the latest code.

## Development server freshness

- After changes that affect the protocol, server, extension, or generated build output, rebuild and restart the checkout-scoped development server before manual or agent verification.
- Before verification, confirm from process start time and exact build/version identity that the active development server is newer than the source/build being tested. Do not rely only on connectivity or the profile name.
- Ensure the Pi extension and development server use compatible protocol/tool schemas. Reload the Pi session when extension registration or tool schemas changed.
- Never report verification against a stale process. If freshness cannot be proven, stop and refresh the development environment first.
