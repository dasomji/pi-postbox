# PRD: Pi Postbox

## Problem Statement

When multiple Pi agents are running across repositories, branches, worktrees, and machines, the user needs a lightweight way to notice and answer only the decisions that require human input without streaming every chat transcript into a dashboard.

Existing dashboard-style approaches tend to mirror full agent conversations. That is too noisy for the desired workflow. The user wants a focused “postbox” for agent attention: each Pi session registers its presence, reports useful session metadata, and sends structured decision cards when it needs input. The user can open the web interface from a phone or laptop over Tailscale/lizardtail, answer the card, and let the blocked Pi session continue.

The long-term vision is richer than a form UI: `ask_postbox` is a handoff to an interviewer. V1 is a simple structured question-answer interface, but the contract should preserve enough context for a future conversational interviewer, including relevance, decision impact, per-answer meaning, and codebase/problem context. Future interviewer conversations should help the user reach decisions without polluting the coding agent’s main context.

## Solution

Build **Pi Postbox**, consisting of:

- A standalone **`pi-postbox-server`** web service.
- A Pi extension exposing an **`ask_postbox`** tool.
- A reactive web UI optimized around pending attention cards, not streamed chat logs.

Each Pi extension instance connects outbound to the standalone server, registers the active Pi session, sends heartbeats and semantic state, and posts structured question requests. The server persists sessions, machines, projects, pending requests, resolved answers, and history in SQLite. Browser clients receive reactive state via SSE and submit answers via HTTP actions.

When an agent calls `ask_postbox`, the tool blocks the Pi session until the request is answered, cancelled, expires, or fails. The extension explicitly marks the session as blocked while waiting, independent of pi-ask. It also observes `ask_user` tool calls so local pi-ask prompts can still appear as attention states. While waiting, it emits Herdr-compatible blocked events so Herdr sidebars can reflect the same state when Pi runs inside Herdr.

V1 does not include native push notifications or a conversational interviewer. It must reserve the architecture for both: notification hooks exist server-side, and rich handoff context is stored even if the first UI renders it as collapsible sections.

## User Stories

1. As a user running multiple Pi agents, I want to see which sessions are live, so that I know what work is currently active.
2. As a user, I want Pi sessions to register automatically when they start, so that I do not manually add sessions to the dashboard.
3. As a user, I want each session to show its project, branch, worktree, and machine, so that I can identify what feature or task needs attention.
4. As a user, I want machine names to be editable in the web UI, so that I can recognize devices by friendly names.
5. As a user, I want project names and icons to be auto-detected but overrideable, so that the UI is visually scannable without mandatory configuration.
6. As a user, I want project icons to work even when the Pi session runs on another machine, so that the server does not require shared filesystem access.
7. As a user, I want pending questions shown as cards, so that I can answer decisions without reading full chat streams.
8. As a user on mobile, I want the attention inbox to prioritize pending questions, so that I can quickly unblock agents.
9. As a user with the dashboard open on multiple devices, I want an answer submitted on one device to immediately resolve the card everywhere else, so that state stays consistent.
10. As a Pi agent, I want to call `ask_postbox` with structured options, so that I can pause for a normalized human decision instead of guessing.
11. As a Pi agent, I want `ask_postbox` to return the selected machine-readable value(s), so that I can continue deterministically.
12. As a Pi agent, I want to include why the question matters, so that the user understands the decision context.
13. As a Pi agent, I want to describe the impact of the decision, so that the user can answer with awareness of downstream consequences.
14. As a Pi agent, I want to include per-answer context, so that the user understands what each option means.
15. As a Pi agent, I want to include codebase/problem context, so that a future interviewer can discuss the decision intelligently.
16. As a user, I want only final answers, notes, and concise rationale returned to the coding agent, so that rich interview context does not pollute the main coding session.
17. As a future interviewer agent, I want rich handoff context stored with the request, so that I can conduct a better conversation without needing the full coding-agent chat stream.
18. As a future tool, I want each request to store the originating Pi session path/id and leaf id, so that a temporary forked Pi session can be created from the exact decision point later.
19. As a user, I want Pi sessions to show `working`, `blocked/waiting`, and `idle` states, so that I can distinguish active work from input waits.
20. As a user, I want local `ask_user` waits to appear as blocked/attention states too, so that pi-ask prompts are not invisible.
21. As a user running Pi inside Herdr, I want `ask_postbox` waits to mark Herdr blocked, so that Herdr and Postbox agree.
22. As a user, I want resolved and expired questions retained for a limited history window, so that I can audit decisions later.
23. As a user, I want the server to survive restarts without losing names or pending/history records, so that Postbox can be trusted as infrastructure.
24. As a Pi user, I want Pi startup not to block if Postbox is unavailable, so that Pi remains usable without the server.
25. As a Pi user, I want the extension to reconnect in the background, so that the dashboard recovers automatically after network/server interruptions.
26. As a Pi user, I want `ask_postbox` requests to be idempotent across reconnects, so that duplicate cards are not created after connection drops.
27. As a Pi user, I want a local fallback command while a request is pending, so that I can answer/cancel from the terminal if the web UI is unavailable.
28. As a server operator, I want Postbox to run as a normal local HTTP service, so that lizardtail can expose it separately over Tailscale.
29. As a developer, I want the extension and server packaged through npm/Pi conventions, so that installation across machines is straightforward.
30. As a developer, I want schemas validated consistently, so that extension, server, and browser clients agree on request and answer shapes.

## Implementation Decisions

- Product/tool naming:
  - Tool: `ask_postbox`.
  - Server CLI/package identity: `pi-postbox-server`.
  - The name “postbox” is intentional: it signals queued attention/decision handoffs, not streamed chat dashboards, and avoids “inbox” terminology collisions.

- Architecture boundary:
  - The server is standalone.
  - The Pi extension is a thin client.
  - The extension must not own or start the web server in v1.

- Transport:
  - Pi extension to server uses one outbound WebSocket connection per extension runtime/process.
  - Browser clients use SSE for reactive state and HTTP endpoints for actions.
  - Answer submissions must broadcast state changes to all connected browser clients.

- Persistence:
  - Server uses SQLite from day one.
  - Persist machine aliases, project aliases, session registry/history, pending/resolved/expired requests, answers, timestamps, and icon cache metadata.
  - Presence is derived from connection/heartbeat state, not treated as permanently persisted live state.

- Server stack:
  - TypeScript workspace.
  - Fastify server.
  - Zod for schema validation.
  - Vite + React + TypeScript + Tailwind for the web UI.

- Extension configuration:
  - Support environment variable configuration for the server URL.
  - Maintain a small extension config file for persistent generated machine identity and defaults.
  - Add a status command for connection health.
  - V1 uses Tailscale as the trust boundary and does not require app-level auth.

- Machine identity:
  - Use hostname plus a generated persistent machine id.
  - Allow dashboard-side renaming persisted by machine id.
  - Do not use MAC address or IP address as the primary identity.

- Project/session metadata:
  - Extension sends cwd, git root, repo name, branch, head sha, dirty state, and worktree path when available.
  - Primary display title is Pi session name when available; otherwise repo/worktree plus branch.
  - Project metadata is auto-detected with optional repo-local override for display name, icon, and description.
  - Icons are uploaded by the extension as small cached blobs/hashes because the server may not share the Pi machine filesystem.

- Presence/state model:
  - Adapt Herdr’s semantic state model for Pi lifecycle:
    - agent start → working.
    - `ask_postbox` waiting → blocked/waiting.
    - `ask_user` tool call observed → locally blocked.
    - agent end → debounced idle.
    - session shutdown → release/offline.
  - Add dashboard WebSocket heartbeat for remote presence/offline detection.
  - Mark sessions offline/stale when heartbeat/connection is lost beyond the configured threshold.

- Herdr interoperability:
  - `ask_postbox` emits Herdr-compatible blocked events while waiting and clears them afterward.
  - Postbox state remains independent and must not depend on Herdr being installed.

- Ask behavior:
  - `ask_postbox` blocks until answered/cancelled/expired/failure.
  - Requests are idempotent by request id across reconnects.
  - Reconnect with exponential backoff while keeping the request pending until timeout/expiry.
  - Default timeout should be long enough for remote/asynchronous attention, not a short interactive timeout.
  - Expired requests return a structured expired result to the agent.

- Local fallback:
  - While a request is pending, show compact local status.
  - Provide local commands to answer or cancel the active pending request from the terminal.
  - Do not automatically open local prompts in v1.

- `ask_postbox` contract:
  - Keep compatibility with the core ask-user pattern: single/multi/preview-style options, normalized machine-readable values, optional freeform/custom answer.
  - Add rich handoff fields from v1:
    - question prompt.
    - why this question is relevant.
    - what effect the decision will have.
    - per-answer meaning/context.
    - optional diagrams/code snippets/additional information.
    - codebase/problem context intended for a future interviewer, not necessarily for direct user display.
  - The first UI renders rich context as simple/collapsible card sections.
  - The future conversational interviewer can consume the same stored handoff contract.

- Coding-agent context hygiene:
  - The coding agent supplies rich context explicitly in the tool call.
  - The extension adds objective metadata only.
  - Do not automatically crawl or summarize the repo in v1.
  - Return only final selected answers, user notes, and concise rationale to the coding agent.
  - Do not return full future interviewer transcripts to the main coding session by default.

- Future fork reference:
  - Store originating Pi session path/id and current leaf id on each ask request.
  - This supports a later separate feature where a conversational interviewer can start a temporary forked Pi session from the exact decision point.
  - This future backchannel is not part of the v1 `ask_postbox` schema.

- Dashboard UX:
  - Primary view is an attention inbox sorted by urgency/age.
  - Cards show project, branch, machine, session title, age, and current status.
  - Hierarchy metadata is visible, but machine/project/branch tree navigation is not the primary v1 workflow.
  - Answer UX supports options, optional note, submit, and cancel.
  - First answer wins; after one device submits, all other clients update and disable/resolve the card.

- Notifications:
  - Native push notifications are out of scope for v1.
  - V1 may expose server-side event hooks so notifications can be added later.
  - Manual dashboard usage is acceptable for MVP.

- Deployment/lizardtail:
  - Server runs as a normal local HTTP service.
  - lizardtail/Tailscale exposure is handled outside the app.
  - The app should expose health/status endpoints useful for wrapping and monitoring.

## Testing Decisions

- Test external behavior and protocol outcomes, not implementation details.
- Highest-value test seams:
  - `ask_postbox` tool behavior from call → pending request → answer → normalized tool result.
  - Extension state transitions for working/blocked/idle/offline.
  - Observation of `ask_user` tool calls causing local blocked state.
  - Herdr-compatible blocked event emission around `ask_postbox` waits.
  - WebSocket reconnect/idempotent request behavior.
  - Server persistence across restart for machines, aliases, requests, answers, and history.
  - SSE client state updates after HTTP answer submission.
  - First-answer-wins behavior across multiple browser clients.
  - Metadata collection for git branch/worktree/session/machine.
  - Rich context rendering as card sections without returning it wholesale to the coding agent.

- Extension tests should use mocked Pi extension context/events where possible.
- Server tests should exercise Fastify routes/WebSocket/SSE contracts with an isolated temporary SQLite database.
- UI tests should focus on card lifecycle and answer submission behavior rather than visual internals.
- End-to-end smoke tests should run a fake extension client and browser client against the server to verify registration, pending card creation, answer resolution, and persisted history.

## Out of Scope

- Streaming full Pi chat transcripts to the dashboard.
- Native push notifications for phone/laptop.
- Conversational AI interviewer.
- Interviewer-to-coding-agent backchannel.
- Starting temporary forked Pi sessions from the dashboard.
- Full pi-ask UI parity such as per-option notes, review tabs, and elaborate flows.
- Full multi-user accounts or app-level authentication.
- Server-managed lizardtail/Tailscale lifecycle.
- Automatic codebase crawling or summarization by the extension/server.
- Docker deployment as the primary v1 distribution.

## Further Notes

Herdr’s Pi integration is important prior art. It reports semantic state from Pi lifecycle hooks, includes native session references, debounces idle, handles retryable provider errors, and uses `herdr:blocked` events for integrations that need to mark blocked state. Postbox should borrow the lifecycle/state ideas but add dashboard-specific heartbeat, persistence, WebSocket registration, and structured ask/answer workflows.

The current project directory is empty and not a git repository, so this PRD is written locally rather than published to an issue tracker.
