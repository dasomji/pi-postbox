# Postbox Question fork-chat research

**Date:** 2026-07-17
**Scope:** A web-only, question-scoped conversation with an ephemeral fork of the Pi Session that called `ask_postbox`, plus an assessment of Daniel's starred repositories for reusable chat UI.
**Status:** Research complete. The subsequent grill is recorded in [`../brainstorms/2026-07-17-postbox-question-chat-grill.md`](../brainstorms/2026-07-17-postbox-question-chat-grill.md); that shared-understanding brief supersedes conflicting recommendations here (notably server-persisted transcripts and a proposal-only tool boundary).

## Executive finding

The feature is feasible without reconstructing the originating conversation by hand:

- Postbox already stores the source session file, leaf, cwd, model, and rich handoff context on each Postbox Question ([protocol schema](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/protocol/src/ask.ts#L19-L64)).
- Pi 0.80.10 can open that file with a different output directory and extract only the root-to-leaf branch into a new session file ([`SessionManager.open`](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1447-L1461), [`createBranchedSession`](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1329-L1426)).
- Pi's SDK exposes prompt, streaming events, steering, abort, disposal, custom tools, and explicit tool selection for an embedded UI ([SDK lifecycle](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/sdk.md#L44-L114), [events](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/sdk.md#L263-L322), [tools](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/sdk.md#L493-L576)).

**Recommended shape:** run the ephemeral fork on the originating Pi machine under the Postbox extension, relay normalized events through the Postbox server, persist finalized conversation data on the server for browser reconnects, and build a small native Svelte chat surface. Do not import a React chat stack into the existing Svelte application.

## 1. Verified Postbox seams

### 1.1 The source reference is already durable

`AskCreatePayload` contains the complete structured question, handoff context, and optional `ForkReference` fields `agentSessionId`, `agentSessionPath`, `leafId`, `cwd`, and `model` ([schema](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/protocol/src/ask.ts#L19-L64)). `RequestStore.create()` serializes both context and fork reference into SQLite ([store](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/server/src/services/requestStore.ts#L64-L103)).

The extension currently forwards a caller-supplied fork reference but does not synthesize one inside `createAskPayload()` ([tool input and payload](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/extension/src/tools/askPostbox.ts#L14-L29), [payload construction](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/extension/src/tools/askPostbox.ts#L112-L138)). The implementation must therefore validate that a pending question has at least a usable `agentSessionPath` and `leafId`, and provide a clear unavailable state when it does not.

### 1.2 The extension connection is the right control plane, but its protocol must grow

The protocol currently accepts extension-to-server registration, heartbeat, session lifecycle, and ask lifecycle messages. Server-to-extension messages are only acknowledgements, ask resolution, registration, and errors ([WebSocket unions](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/protocol/src/ws.ts#L10-L77)). The server already keeps each WebSocket open and pushes `ask.resolved` back to the extension ([socket route](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/server/src/ws/extensionSocket.ts#L37-L178)).

That makes the existing socket a natural transport for new server-to-extension fork commands and extension-to-server runtime events. A separate second connection is not justified by the current topology.

### 1.3 Terminal lifecycle is already centralized

Answers and cancellations use compare-and-update transactions constrained to `status = 'pending'`, so only one terminal transition wins ([answer transaction](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/server/src/services/requestStore.ts#L120-L164), [cancel transaction](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/server/src/services/requestStore.ts#L166-L200)). Session shutdown cancels unresolved questions except on reload ([socket lifecycle](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/server/src/ws/extensionSocket.ts#L164-L177)).

`RequestStore` resolution notifications are therefore the natural server-side trigger for terminating the question-scoped runtime. The extension's own `session_shutdown` hook already stops its client and clears registration state ([extension lifecycle](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/packages/extension/src/index.ts#L131-L150)).

### 1.4 The browser transport currently favors snapshots, not chat deltas

The browser fetches state immediately, then consumes full-state snapshots over SSE with polling fallback ([web store](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/apps/web/src/lib/store.svelte.ts#L226-L293)). Full snapshots are suitable for question metadata but inefficient for token deltas. The implementation should add question-scoped incremental events while retaining a durable history fetch for reconnect. Whether that uses named events on the existing SSE stream or a separate stream is an implementation detail; do not place model execution in the browser.

## 2. Exact Pi runtime mechanism

The checked package is `@earendil-works/pi-coding-agent` 0.80.10; npm's `gitHead` for that version is `8dc78834cde4e329284cf505f9e3f99763df5529`, matching tag `v0.80.10` ([package at tag](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/package.json#L1-L10)). All Pi claims below are pinned to that source revision.

### 2.1 Recommended branch construction

1. Create a private, Postbox-owned temporary directory on the originating Pi machine.
2. Call `SessionManager.open(sourcePath, temporaryDirectory)`.
3. Call `createBranchedSession(leafId)` on that newly opened manager.
4. Create a dedicated SDK `AgentSession` from the resulting manager.
5. On terminal lifecycle, unsubscribe, abort if active, dispose, and recursively delete the directory.
6. On extension startup, sweep stale Postbox-owned temporary directories left by crashes.

Why this works:

- `open(path, sessionDir)` reads the original file but uses the supplied session directory for subsequent branch output ([source](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1447-L1461)).
- `createBranchedSession(leafId)` obtains the exact branch, rewrites parent links after excluding labels, gives it a new session ID, records the original as `parentSession`, and makes the opened manager point at the new file ([source](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1329-L1426)).
- The SDK can open a specific manager, stream events, abort, and dispose ([source](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/sdk.md#L44-L114)).

This is preferable to copying rendered messages into `SessionManager.inMemory()`: the file branch preserves Pi's exact typed entries and lineage, while the private output directory keeps the fork out of ordinary session storage and makes cleanup auditable.

### 2.2 Recommended resource boundary

A normal `createAgentSession()` performs standard resource discovery unless given a custom loader ([SDK](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/sdk.md#L44-L63)). `DefaultResourceLoaderOptions` in 0.80.10 includes `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`, and `systemPrompt` ([source](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/resource-loader.ts#L119-L157)).

**Recommendation:** set every `no*` boundary, supply an interviewer-specific system prompt, and expose only explicitly approved tools. This prevents the fork from recursively loading Postbox or inheriting unrelated global/project automation. Pi also supports an explicit tool allowlist and direct custom tools ([SDK](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/sdk.md#L493-L576)).

The minimum useful custom tool is `propose_answer`: it should create a server-persisted proposal but must not answer the Postbox Question by itself. The user remains responsible for explicit final submission through the existing answer form.

### 2.3 Direct SDK versus child-process isolation

Pi's direct SDK is the simplest same-process integration and exposes all required lifecycle APIs. A child process would add a stronger kill boundary at the cost of another protocol, process supervision, credential/environment forwarding, and more failure modes.

**Recommendation for the first version:** direct SDK inside the extension with strict resource/tool boundaries and explicit teardown. Keep the runtime behind a small internal interface so it can move to a child process later if operational evidence shows that `abort()`/`dispose()` is insufficient. This remains a hard-to-reverse-enough decision to confirm in the grill.

## 3. Recommended distributed shape

The source session path and model credentials belong to the machine running Pi. The standalone Postbox server may be reached remotely, so it cannot assume that `agentSessionPath` exists on its own filesystem. Therefore:

```text
Browser
  HTTP: start/send/fetch/propose
  SSE: normalized chat events
        │
        ▼
Postbox server
  durable metadata/messages/proposals
  routes commands to the owning extension socket
        │
        ▼
Originating Postbox extension
  validates pending question + source reference
  creates and owns ephemeral Pi fork
  streams normalized runtime events upward
```

Recommended ownership:

- **Extension:** Pi SDK objects, source-file access, temporary fork files, model streaming, abort/dispose.
- **Server:** authorization/origin checks, question status, durable finalized messages and proposals, monotonic event ordering, reconnect history, single-winner answer transition.
- **Browser:** presentation, draft input, reconnect, proposal selection, explicit answer submission.

Persist finalized user/assistant messages and answer proposals, not private chain-of-thought. Token deltas can be transient; finalized assistant text is the durable replacement. A monotonically increasing per-question sequence lets all browser clients detect gaps and replay from server state.

## 4. Starred repository assessment

All source inspections below are pinned to exact commits. The stars export used for discovery is retained locally at `tmp/research/github-stars.tsv` (ignored, not a product artifact).

| Candidate | What the source establishes | Reuse verdict |
|---|---|---|
| [`earendil-works/pi-chat`](https://github.com/earendil-works/pi-chat/tree/9adbd29b40ee27ff1decf0fc87cbe180b40924f5) | It is a Discord/Telegram bridge to sandboxed Pi sessions, not browser UI ([README](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/README.md#L1-L41)). It has per-channel JSONL logs and locks ([layout](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/README.md#L98-L121)), append-only records and stale-lock recovery ([log source](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/src/log.ts#L70-L141)), and edit-in-place streamed previews ([stream source](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/src/render/streaming.ts)). | Runtime/lifecycle inspiration only. No web component to import. Its actual `LICENSE` is Apache-2.0, despite the README's “MIT” line and package metadata also saying Apache-2.0 ([license](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/LICENSE), [metadata](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/package.json#L1-L26), [README line](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/README.md#L215-L227)). |
| [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui/tree/fe26a58452b57d2f6bd2a1bb11e93d3394ea1b24) | MIT React/Electron UI over upstream Pi ([architecture](https://github.com/minghinmatthewlam/pi-gui/blob/fe26a58452b57d2f6bd2a1bb11e93d3394ea1b24/README.md#L88-L107)). It defines a clean session-driver contract with normalized streaming/tool/lifecycle events, fork, send, abort, subscribe, and close ([types](https://github.com/minghinmatthewlam/pi-gui/blob/fe26a58452b57d2f6bd2a1bb11e93d3394ea1b24/packages/session-driver/src/types.ts#L150-L358)). Its Pi driver demonstrates branch construction and event translation ([fork implementation](https://github.com/minghinmatthewlam/pi-gui/blob/fe26a58452b57d2f6bd2a1bb11e93d3394ea1b24/packages/pi-sdk-driver/src/session-supervisor.ts#L496-L590), [event subscription](https://github.com/minghinmatthewlam/pi-gui/blob/fe26a58452b57d2f6bd2a1bb11e93d3394ea1b24/packages/pi-sdk-driver/src/session-supervisor.ts#L1196-L1201)). Its timeline includes virtualization and “new activity below” behavior ([timeline](https://github.com/minghinmatthewlam/pi-gui/blob/fe26a58452b57d2f6bd2a1bb11e93d3394ea1b24/apps/desktop/src/conversation-timeline.tsx#L229-L297)). | Best runtime-abstraction and interaction-pattern reference. Port concepts, not React components. |
| [`BlackBeltTechnology/pi-agent-dashboard`](https://github.com/BlackBeltTechnology/pi-agent-dashboard/tree/b6bd243f70f97bbf7568272bf04da4963e336698) | MIT React/Tailwind live web chat. `ChatView` handles virtualization, tool groups, selection retention, streamed tails, and scroll pinning ([source](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/b6bd243f70f97bbf7568272bf04da4963e336698/packages/client/src/components/ChatView.tsx#L1-L299)). Its own embedding guide says the full-fidelity export is workspace-only raw TSX, requires multiple React providers, one React copy, Tailwind source scanning, bounded height, and 24 external packages ([guide](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/b6bd243f70f97bbf7568272bf04da4963e336698/docs/embedding-chat-view.md)). The published `MinimalChatView` is also React and provider-dependent ([source](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/b6bd243f70f97bbf7568272bf04da4963e336698/packages/client-utils/src/minimal-chat/MinimalChatView.tsx#L1-L131)). | Strongest production behavior reference, worst direct architectural fit. Port reducer, scroll, reconnect, and streaming-tail lessons; do not embed it. |
| [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss/tree/4289b16097322e9911d3078d8a64bd8c830717c3) | Apache-2.0 React package with explicit `SessionViewer`, `TurnCard`, and user/system message exports ([exports](https://github.com/craft-ai-agents/craft-agents-oss/blob/4289b16097322e9911d3078d8a64bd8c830717c3/packages/ui/src/components/chat/index.ts#L1-L21)). `SessionViewer` documents itself as a read-only finished-session snapshot and groups messages into collapsible turns/activities ([source](https://github.com/craft-ai-agents/craft-agents-oss/blob/4289b16097322e9911d3078d8a64bd8c830717c3/packages/ui/src/components/chat/SessionViewer.tsx#L1-L49), [rendering](https://github.com/craft-ai-agents/craft-agents-oss/blob/4289b16097322e9911d3078d8a64bd8c830717c3/packages/ui/src/components/chat/SessionViewer.tsx#L72-L223)). The package depends on Craft workspace types and has a large React/Tailwind/Markdown/Radix peer surface ([manifest](https://github.com/craft-ai-agents/craft-agents-oss/blob/4289b16097322e9911d3078d8a64bd8c830717c3/packages/ui/package.json#L1-L76)). | Best packaged visual/API ideas, especially turn grouping and plan-like actions; still not a direct fit. Port ideas only. |

### UI conclusion

Postbox's web package is Svelte 5 and currently has no runtime dependencies beyond its protocol package ([manifest](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/apps/web/package.json#L1-L21)). Adding React solely for a sidebar would duplicate rendering ecosystems and import far more agent-workbench behavior than this feature needs.

Build native Svelte components for:

1. finalized user messages;
2. streamed/finalized assistant Markdown;
3. compact generating, reconnecting, stopped, and error states;
4. a composer with clear busy/queued semantics;
5. a first-class Answer Proposal card that can populate the existing answer form;
6. optional compact activity rows only if read-only repo tools are approved.

Do not display hidden reasoning. Avoid full coding-agent affordances such as terminals, diffs, file attachments, model switching, branching, or generic interactive-tool rendering unless separately requested.

## 5. Layout implications

The existing desktop shell permanently allocates an 80-unit left sidebar, while mobile uses a modal navigation drawer ([`App.svelte`](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/apps/web/src/App.svelte#L55-L111)). The question surface is centered and owns answer selection/submission ([question layout](https://github.com/dasomji/pi-postbox/blob/ddc6c516e3d63650796409d65c0b256b682ef8aa/apps/web/src/components/QuestionLayoutSpotlight.svelte#L69-L250)).

The user's proposed direction is structurally compatible:

- Desktop: collapsible existing navigation sidebar on the left, selected pending question in the center, question-scoped interviewer on the right.
- Mobile: Question and Chat bottom tabs; keep project navigation as a separate drawer.

The exact desktop widths, default open state, and `Cmd/Ctrl+B` behavior remain product decisions. `Cmd+B` conflicts with browser bookmark UI in common browsers, so cross-platform shortcut semantics must be explicitly chosen rather than assumed.

## 6. Failure and safety requirements

Regardless of later UX choices, the implementation should satisfy these invariants:

- Never start against a resolved Postbox Question.
- Validate source path/leaf immediately before creating the fork; do not trust stale browser state.
- One active runtime owner per question; concurrent browser tabs are viewers/writers through the server, not separate Pi forks.
- Server persists accepted user turns before dispatch and assigns ordering; reconnect never relies solely on token deltas.
- A proposal is not an answer. Only the existing atomic answer transition resolves the question.
- Answer, cancel, expiry, source-session shutdown/replacement, extension shutdown, or explicit chat stop aborts and disposes the fork.
- Delete temporary files after teardown and sweep crash leftovers on startup.
- Never load inherited extensions/skills/context implicitly.
- Never expose mutation tools unless the user explicitly chooses that policy.
- Never persist or render private reasoning deltas.

## 7. Decisions still requiring the grill

In dependency order:

1. Does the interviewer start automatically for every pending question, or only after explicit Chat activation?
2. Is conversation history durable until the question/history record is pruned, or intentionally ephemeral beyond the live runtime?
3. Is the first version allowed only `propose_answer`, or also read-only repository tools?
4. Confirm direct in-process SDK versus child-process isolation.
5. What exactly can an Answer Proposal populate: option selection, note, rationale, and/or an “Other” answer?
6. How should multiple browser clients coordinate simultaneous sends and proposal edits?
7. What are the desktop sidebar defaults and cross-platform shortcut semantics?
8. What should users see when the originating extension is offline, the source file/leaf is missing, the model fails, or the stream reconnects?

## Recommendation to carry into the grill

Start with **explicit Chat activation**, one direct-SDK runtime per pending question, durable finalized history, only `propose_answer` as a tool, and an explicit final user submit. This is the lowest-surprise, lowest-capability first version: it avoids spending model tokens for questions the user can answer directly, keeps the security boundary narrow, and leaves room to add read-only tools after the interaction proves useful.
