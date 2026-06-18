---
date: 2026-06-15
topic: postbox-self-healing-local-port
---

# Postbox Self-Healing Local Port

## Problem Frame

Pi Postbox currently depends on a static server URL from `PI_POSTBOX_URL` or `~/.pi-postbox/config.json`. When the local server falls back or restarts on a different port, Pi sessions can remain disconnected even though a healthy local Postbox server is running. The v1 goal is to eliminate local port drift and local server split-brain without requiring manual config edits or Pi restarts.

The intended local behavior is: Pi sessions converge on the same active local Postbox server. A dev Postbox server is preferred when running; otherwise the local production server is used. If a dev server starts while a local production server is running, production may stay alive but becomes inactive for Pi routing; running Pi sessions reconnect to dev. When dev disappears, production can become active again if still healthy.

Verified context: `packages/server/src/cli.ts` already falls back to an available port and prints the actual URL; `packages/extension/src/config.ts` reads static config/env; `packages/extension/src/client/PostboxClient.ts` reconnects to its configured URL but does not discover a replacement URL.

---

## Actors

- A1. Pi operator: Runs Postbox and expects `ask_postbox` to work without port surgery.
- A2. Pi extension: Registers sessions and sends questions to the active reachable Postbox server.
- A3. Local Postbox server/launcher: Knows its actual local URL, server role, and whether it should be the active local target.

---

## Key Flows

- F1. Production server starts with no dev server running
  - **Trigger:** A local production Postbox server starts or restarts on any available port.
  - **Actors:** A2, A3
  - **Steps:** The server becomes the active local target; running or newly-started Pi sessions discover the active local target; sessions register with the production server.
  - **Outcome:** Local Pi sessions use production Postbox when no dev server is active.
  - **Covered by:** R1, R3, R5, R8

- F2. Dev server starts while production is running
  - **Trigger:** A local dev Postbox server starts while a local production server is active.
  - **Actors:** A2, A3
  - **Steps:** The dev server becomes the active local target; the production server may keep running but is no longer the active Pi routing target; running Pi sessions reconnect to the dev server without manual config edits or Pi restarts.
  - **Outcome:** Local Pi sessions converge on the dev server, while production remains available to become active again after dev disappears.
  - **Covered by:** R1, R2, R4, R5, R8

- F3. Dev server stops, expires, or is absent
  - **Trigger:** No local dev server is active, but a local production server is available.
  - **Actors:** A2, A3
  - **Steps:** The production server becomes the active local target; Pi sessions reconnect to production after their normal recovery/reconnect cycle.
  - **Outcome:** The operator gets a working local Postbox without needing to remember which port production selected.
  - **Covered by:** R1, R3, R5, R8, R12

- F4. Config points to an intentionally remote URL
  - **Trigger:** The operator sets `PI_POSTBOX_URL` or config to a non-loopback URL such as a Tailscale URL.
  - **Actors:** A1, A2
  - **Steps:** The extension respects the explicit remote target and does not silently redirect to a local server.
  - **Outcome:** Local self-healing fixes local drift without hijacking remote/Tailscale setups.
  - **Covered by:** R6, R7

---

## Requirements

**Active local server selection**
- R1. Local Pi sessions must converge on one active local Postbox server rather than independently sticking to stale ports.
- R2. When a local dev Postbox server is running, it must be the preferred active local target.
- R3. When no local dev Postbox server is running, the local production Postbox server must be the active local target when available.
- R4. If a local dev server starts while a local production server is running, the dev server must become the active-local target; production may continue running but must be treated as inactive for Pi routing while dev is healthy.
- R5. When a newly selected active local server starts, already-running Pi sessions must reconnect to it without requiring manual config edits or Pi session restarts.

**Operator intent and safety**
- R6. Explicit non-loopback URLs, including Tailscale or hosted URLs, must remain authoritative and must not be silently replaced by local recovery.
- R7. Local recovery must only treat loopback URLs as local candidates; private LAN, Tailscale, `.local`, machine hostname, or arbitrary private DNS targets are not local recovery targets.

**Connection behavior and diagnostics**
- R8. Successful recovery must result in normal session registration and `ask_postbox` delivery, not only a UI status change.
- R9. When recovery succeeds, the Pi status should make it clear which active local server was selected.
- R10. When recovery fails, the disconnected status should include enough diagnostic detail to identify stale config, no active local server, or conflicting local server state.

**Local source of truth**
- R11. The local server/launcher must publish enough active-server metadata for Pi sessions to distinguish dev vs production and avoid connecting to an unintended local instance.
- R12. The active-server metadata must be fresh enough that stale records from dead servers do not keep Pi sessions pointed at unavailable or wrong targets.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R5, R8.** Given config points to `http://127.0.0.1:33375`, no dev server is active, and a local production server is live at `http://127.0.0.1:3500`, when a Pi session starts, the session registers with production at `3500` without manual config edits.
- AE2. **Covers R1, R2, R4, R5, R8.** Given a local production server is active and a dev server starts, when running Pi sessions attempt their next recovery/reconnect cycle, they register with the dev server while production remains running but inactive for Pi routing.
- AE3. **Covers R3, R5, R8.** Given no dev server is active and a production server starts on a new port, when Pi sessions are already running, they reconnect to the production server without requiring `/new`, restart, or manual config edits.
- AE4. **Covers R6, R7.** Given `PI_POSTBOX_URL` is set to a Tailscale URL, when a local dev or production server is also running, the extension keeps using the Tailscale URL rather than silently switching to localhost.
- AE5. **Covers R10, R12.** Given stale active-server metadata points to a dead server and no active local server is available, when `ask_postbox` is used, the resulting unavailable state explains that no active local server could be recovered.

---

## Success Criteria

- Local port drift no longer causes `ask_postbox` to fail when a healthy active local Postbox server is running.
- Running Pi sessions follow the intended active local server without manual config edits or Pi restarts.
- Dev workflows are predictable: dev Postbox wins while healthy, and production is used when dev is absent, stopped, or stale.
- Planning can proceed without inventing local precedence rules: dev beats production; production is fallback; explicit non-loopback remote URLs are not overridden.

---

## Scope Boundaries

- In scope: local localhost/loopback recovery for stale ports.
- In scope: choosing a single active local server across dev and production local servers.
- In scope: routing Pi sessions to dev while dev is healthy, with production allowed to remain running but inactive.
- In scope: reconnecting already-running Pi sessions to the newly active local server.
- In scope: clear diagnostics when local recovery cannot happen.
- Out of scope for v1: discovering Postbox servers across Tailscale or LAN.
- Out of scope for v1: broad 1-65535 port scanning.
- Out of scope for v1: authentication or trust-boundary changes.
- Out of scope for v1: silently replacing explicit non-loopback remote URLs.

---

## Key Decisions

- Use an active-local-server model rather than broad discovery: this directly solves local port drift and avoids multiple local servers competing for Pi sessions.
- Dev server has precedence over production server: development should take over local Pi sessions while healthy.
- Production server is the fallback local target: if dev is absent, stopped, or stale, local Postbox should still work without port surgery.
- Do not make v1 a process supervisor: production may remain alive while inactive instead of being killed by dev startup.
- Treat explicit non-loopback URLs as intentional: local recovery should not hijack Tailscale or hosted deployments.
- Prefer deterministic local state over parsing logs: startup output is for humans and wrappers, not a reliable extension contract.

---

## Dependencies / Assumptions

- Assumption: The common broken state is stale local config or a local server role change, not an intentionally unavailable remote server.
- Assumption: The server/launcher can safely publish active-local-server metadata somewhere readable by the extension.
- Dependency: Implementation planning must choose the exact active-server metadata mechanism, freshness rules, and reconnect trigger.

---

## Outstanding Questions

### Resolve Before Planning

_None._

### Deferred to Planning

- [Affects R4, R12][Technical] Decide how active-local metadata marks dev healthy/stale and lets production resume when dev disappears.
- [Affects R5][Technical] Define the mechanism that notifies or causes already-running Pi sessions to reconnect to the newly active local server.
- [Affects R11, R12][Technical] Decide the exact active-server metadata format, freshness rules, and stale-record handling.
- [Affects R9, R10][Technical] Decide exact status strings and whether to surface recovery details in `ask_postbox` results.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
