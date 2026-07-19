# Spec: Add question-scoped Chat to Postbox Questions

## Problem Statement

A Postbox Question currently gives the user structured context, fixed answer options, and an optional Note, but the user may still not understand the asking agent's terminology, the underlying technical concepts, or the trade-offs well enough to make a confident decision. Resolving that uncertainty requires leaving Postbox, finding the originating Pi Session, and manually reconstructing the context. That defeats the focused remote-decision workflow, especially from a phone.

The originating Pi Session already contains the best context for helping with the decision. Postbox also stores the exact session/leaf reference and structured handoff context. The user needs an optional, question-scoped Chat that can fork that context, teach or elaborate as needed, inspect only safe read-only repository evidence, and suggest additional answer options without polluting or unblocking the originating Pi Session prematurely.

The feature must preserve Postbox's core boundary: the Postbox Question remains the authoritative decision object, the user remains the only actor who can submit its answer, and Postbox must not become a general full-transcript coding-agent dashboard.

## Solution

Add an explicitly activated **Chat** to each pending Postbox Question. Chat runs as a temporary fork of the originating Pi Session on the originating machine. The Postbox extension owns a direct Pi SDK runtime, while the server relays browser commands and normalized runtime events using the existing outbound extension connection and browser HTTP/SSE architecture.

Chat does not generate automatically when opened. It starts with a freeform composer and three focused starters—**Elaborate**, **Pro–Cons**, and **Teach me**—so the user chooses what kind of help is needed. The interviewer may inspect the source Git worktree using tightly scoped read-only tools. It may also call `propose_answer`, which atomically appends a new, selectable, visibly Chat-suggested option to the Postbox Question. It can never select, submit, cancel, or otherwise resolve the question.

The temporary Pi fork is the sole Chat transcript. It is recoverable across routine extension/Pi restarts while the Postbox Question remains pending, but it is deleted as soon as the question becomes terminal. Postbox persists proposed answer options because they become authoritative answer data; it does not persist a duplicate Chat transcript in SQLite.

Desktop adds a fixed-width right Chat sidebar while making the existing left navigation collapsible. Mobile shows Question and Chat as bottom tabs only after Chat has been started.

## User Stories

1. As a user facing an unfamiliar Postbox Question, I want to open a focused Chat, so that I can understand the decision without finding the originating Pi terminal.
2. As a user who can answer an easy question directly, I want Chat to remain unstarted by default, so that no unnecessary runtime or model work occurs.
3. As a user, I want starting Chat to be an explicit action on the selected Postbox Question, so that I understand which decision the conversation belongs to.
4. As a user, I want opening Chat not to trigger an automatic model response, so that I choose the first use of model capacity.
5. As a user who does not understand what the asking agent means, I want an Elaborate starter, so that the interviewer restates and explains the question.
6. As a user who understands the terminology but cannot judge the options, I want a Pro–Cons starter, so that I can compare the relevant trade-offs.
7. As a user with no background in the topic, I want a Teach me starter, so that I can learn the minimum concepts needed to answer responsibly.
8. As a user with a specific concern, I want to type my own first message, so that I am not constrained to starter prompts.
9. As a user, I want the interviewer to inherit the exact root-to-leaf source conversation when available, so that I do not repeat context.
10. As a user, I want the interviewer isolated from unrelated branches of the Pi Session, so that its context matches the decision point.
11. As a user, I want the original Pi Session to remain blocked on the Postbox Question while I chat, so that the coding agent does not continue before my answer.
12. As a user, I want Chat to use the originating session's model when possible, so that its behavior remains consistent with the asking agent.
13. As a user, I want a clear fallback to Pi's configured default model when the originating model is unavailable, so that Chat can still work without silently changing behavior.
14. As a user, I do not want a model picker in this focused workflow, so that Chat remains about the decision rather than agent configuration.
15. As a user, I want Chat to offer an explicit context-only fallback when the exact session file or leaf is missing, so that stored handoff context can still help me.
16. As a user, I want context-only fallback clearly labeled and manually confirmed, so that I know it is not the exact source fork.
17. As a user, I do not want an automatic degraded fallback, so that incomplete context is never presented as complete.
18. As a user, I want every new Postbox Question to include codebase and problem context, so that a context-only interviewer has a useful minimum handoff.
19. As a user with legacy Postbox Questions, I want them to remain readable even when they lack newly required context, so that an upgrade does not destroy history.
20. As a user with a legacy question lacking context, I want context-only Chat reported as unavailable, so that Postbox does not invent a handoff.
21. As a user, I want Chat to inspect relevant repository files read-only, so that it can verify facts before advising me.
22. As a user, I want repository reads confined to the originating Git worktree, so that Chat cannot roam across my machine.
23. As a user running Pi below a monorepo root, I want Chat to access the whole originating worktree, so that relevant sibling packages are not hidden.
24. As a user outside a Git repository, I want reads confined to the originating cwd subtree, so that a clear safe boundary still exists.
25. As a user, I want path traversal and symlink escapes rejected, so that the worktree boundary is real rather than cosmetic.
26. As a user, I want ignored and secret-like files denied, so that credentials are not accidentally sent to the model or browser.
27. As a user, I want read, grep, find, and list capabilities but no shell or mutation tools, so that Chat can gather evidence without changing my worktree.
28. As a user, I want inherited Pi extensions, skills, prompts, themes, and context discovery disabled, so that the fork cannot recursively load Postbox or unrelated automation.
29. As a user, I want compact tool activity visible, so that I know when the interviewer checked repository evidence.
30. As a user, I want to expand a tool activity row, so that I can inspect sanitized, bounded arguments and output when needed.
31. As a user, I want large tool output truncated, so that the Chat sidebar remains usable and finite.
32. As a user, I do not want private reasoning rendered or retained, so that Chat displays only appropriate user-visible output.
33. As a user, I want assistant messages to stream, so that I receive feedback without waiting for a complete model turn.
34. As a user, I want a message sent during generation to steer the current turn, so that I can correct a misunderstanding immediately.
35. As a user, I want accidental duplicate browser commands deduplicated, so that a retry or double click does not send the same prompt twice.
36. As a user switching between devices, I want both devices to control the same question-owned Chat, so that I can continue from whichever screen is convenient.
37. As a user, I do not want writer leases or collaborative-user workflows, so that the one-human Postbox use case stays simple.
38. As a user, I want an already-open browser to keep rendered messages visible during an extension outage, so that a transient disconnect does not blank the current screen.
39. As a user, I want offline Chat clearly marked and sending disabled, so that messages are not ambiguously queued for later execution.
40. As a user loading Chat while the extension is offline, I want an unavailable state and Retry action, so that Postbox does not pretend it can fetch the temporary fork.
41. As a user, I want Chat to resynchronize from the fork after reconnection, so that the browser recovers the authoritative conversation state.
42. As a user, I want an active Chat to recover after a routine Pi extension restart or reload, so that ordinary maintenance does not erase the discussion.
43. As a user, I want a stopped model response retained and labeled, so that text I already saw does not disappear.
44. As a user, I want Stop to abort only the active model turn, so that I can continue the same Chat afterward.
45. As a user, I want a terminal model failure to retain and label partial output, so that reconnects truthfully show what happened.
46. As a user, I want further work after a terminal model failure to require an explicit action, so that Chat does not spend or retry indefinitely.
47. As a user, I want the interviewer to suggest an answer not covered by the original choices, so that the decision form can evolve as understanding improves.
48. As a user, I want each suggestion appended as a normal selectable option, so that I can answer through the existing Postbox Question workflow.
49. As a user, I want a proposed option to support the same visible label, description, meaning, and context as an original option, so that it can be explained properly.
50. As a user, I want Postbox—not the model—to generate the proposed option's internal value, so that identity is collision-free and trustworthy.
51. As a user, I want proposed options marked Suggested in Chat, so that I can distinguish later interviewer additions from the asking agent's original choices.
52. As a user, I want proposed options appended in order and left immutable, so that the available answers have a stable history.
53. As a user, I want Chat to confirm compactly when an option was added, so that I know the tool action succeeded.
54. As a mobile user, I want an added-option confirmation to take me back to the Question tab, so that I can inspect and select it.
55. As a user, I do not want proposed options auto-selected, so that the interviewer never chooses on my behalf.
56. As a user, I want my current option selection left untouched when Chat proposes another option, so that advice does not overwrite my decision work.
57. As a user, I want the optional Note to remain entirely mine, so that Chat cannot write personal nuance on my behalf.
58. As a user, I want proposal attempts rejected after the question resolves, so that terminal decision history cannot change.
59. As a user, I want proposed options to remain on the resolved Postbox Question, so that History accurately explains a selected suggested value.
60. As a user, I want the existing option-count and payload limits enforced for proposed options, so that Chat cannot grow a question without bound.
61. As a user, I want answer submission to win immediately over in-flight Chat work, so that advisory work never delays unblocking the originating Pi Session.
62. As a user, I want active generation aborted and late tool effects rejected after answer, cancel, or expiry, so that terminal status is authoritative.
63. As a user, I want the temporary Chat transcript deleted when the Postbox Question becomes terminal, so that Postbox does not become a transcript archive.
64. As a user, I do not want resolved History to expose a Chat transcript, so that only the decision and durable options remain.
65. As a desktop user, I want the existing navigation open by default, so that the current orientation remains familiar.
66. As a desktop user, I want to collapse navigation with a visible button, so that the Question and Chat can use more horizontal space.
67. As a keyboard user, I want Cmd+B on macOS or Ctrl+B elsewhere to toggle navigation, so that sidebar control is fast and memorable.
68. As a user, I want my navigation preference remembered in that browser across questions, reloads, and restarts, so that Postbox preserves my layout.
69. As a desktop user, I want Chat absent until I start it, so that the central Question retains space by default.
70. As a desktop user returning to a question with Chat, I want its right sidebar restored, so that I can continue the discussion.
71. As a desktop user, I want to hide and reopen Chat independently for each question, so that I can focus on the Question without stopping Chat.
72. As a desktop user, I want a stable responsive Chat width, so that the layout remains predictable without drag-resize complexity.
73. As a mobile user, I want a Chat button in the Question view before activation, so that creating a Chat is explicit.
74. As a mobile user, I want Question and Chat bottom tabs only after Chat starts, so that unstarted questions retain the simple decision UI.
75. As a mobile user, I want the last selected tab remembered per question, so that I can alternate naturally between learning and deciding.
76. As a mobile user, I want project and question navigation to remain a separate drawer, so that navigation is not confused with Question/Chat tabs.
77. As a user on the tailnet, I want Chat to work without a new application login in v1, so that the existing Postbox trust model remains intact.
78. As a user, I want same-origin validation, rate limits, finite payloads, status revalidation, and strict tool scoping, so that the more capable Chat surface remains bounded.
79. As a Pi user, I want `/new`, `/resume`, `/fork`, and quit to preserve the existing Postbox Session replacement semantics, so that old unresolved questions and Chats do not move to a new Pi Session.
80. As a Pi user, I want `/reload` treated as recovery rather than replacement, so that a pending Postbox Question and its Chat can reconnect.
81. As an operator, I want stale private fork directories reconciled against authoritative pending-question state, so that crashes do not leak transcripts indefinitely.
82. As a developer, I want every browser/extension Chat payload validated by shared finite schemas, so that all process boundaries agree.
83. As a developer, I want deterministic acceptance tests without provider credentials, so that the complete relay and lifecycle can run in CI.
84. As a developer, I want packaged smoke coverage for the Chat relay, so that the installed combined npm package is proven to include its new runtime and UI resources.

## Implementation Decisions

### Domain and lifecycle

- A **Question Chat** is a question-owned, temporary Pi conversation used only to help the user resolve one pending Postbox Question. It is not a Postbox Session and must not register itself as one.
- There is at most one Question Chat per Postbox Question. Browser devices attach to the same runtime and fork.
- Question Chat has distinct states sufficient for external behavior: not started, starting/recovering, ready, generating, stopped/interrupted, offline, unavailable, and terminal. These states are not a second durable server-side transcript model.
- Chat activation is idempotent and valid only while the Postbox Question is pending.
- Hide/show is presentation state only. Hiding Chat never stops, disposes, or deletes the runtime.
- Postbox Question terminal state is authoritative. Answer, cancel, expiry, Pi Session replacement, or shutdown that cancels the question aborts active generation, rejects late effects, disposes the SDK session, and removes the private fork and manifest.
- `/reload` remains a reconnect path under the accepted Pi Session lifecycle ADR. `/new`, `/resume`, `/fork`, and quit remain semantic replacement boundaries and cancel unresolved questions.

### Runtime ownership and fork construction

- The originating Postbox extension owns Question Chat because the source session path, working directory, model credentials, and Pi SDK environment are local to that machine.
- Use Pi's direct in-process SDK rather than a CLI RPC child process. Hide SDK specifics behind one extension-owned runtime adapter so process isolation can change later without changing the browser/server contracts.
- Construct an exact fork by opening the persisted source session with a private question-specific output directory and creating the root-to-recorded-leaf branch. The source session file must never be modified.
- The private fork directory and manifest use restrictive filesystem permissions and are keyed by stable request identity, not user-controlled path text.
- The Pi JSONL fork is the sole transcript source. The server must not persist user messages, assistant messages, deltas, tool output, or Chat snapshots in SQLite.
- Keep enough private manifest metadata to reopen the fork after extension/Pi reload or process restart while the question remains pending.
- Reconcile recoverable manifests with server-authoritative pending status after extension registration/reconnection. Delete manifests/forks for missing or terminal questions. Recovery must never resurrect a terminal Question Chat.
- A fresh browser obtains a complete normalized Chat snapshot from the connected extension before consuming new deltas. Runtime events carry monotonically increasing runtime-local sequence information so the client can detect a gap and request another snapshot.
- The extension may retain a bounded idempotency window for browser command IDs. The design assumes one human using alternate devices; it does not introduce writer leases or collaborative editing.

### Resource and model boundary

- Build the fork with a dedicated resource loader that disables inherited extensions, skills, prompt templates, themes, and context-file discovery.
- Supply a focused interviewer system prompt containing the authoritative Postbox Question, current options, required handoff context, tool boundaries, and the rule that only the user can resolve the question.
- Do not make a model call merely to start or resume Chat.
- On the first user action, static starters map to deterministic instructions:
  - Elaborate explains the asking agent's language and intent.
  - Pro–Cons compares the decision's relevant trade-offs at the user's current level.
  - Teach me introduces the minimum foundational concepts needed to understand the question.
- Resolve the recorded originating model first. If it is missing, unavailable, or unauthenticated, use Pi's configured default and surface the fallback clearly in Chat. Do not add model-selection UI.
- Do not expose or render private thinking/reasoning deltas. User-visible assistant text, lifecycle state, approved tool activity, and proposal confirmations are the only streamed model/runtime content.

### Context contract and degraded fallback

- New ask creation requires a `context` object with non-empty `codebaseContext` and `problemContext`. `additionalInfo` remains optional and bounded.
- Update the `ask_postbox` tool contract and every first-party producer to enforce the new minimum context.
- Keep persisted request snapshot parsing tolerant of legacy rows where context is absent. Creation strictness and historical-read compatibility are separate schemas/paths.
- Exact source reference remains optional for compatibility. Chat activation without a usable source file and leaf returns a typed source-unavailable response that says whether context fallback is possible.
- Context-only fallback is a separate, explicit user-confirmed start command. It creates a clearly labeled fresh temporary session from required handoff context rather than claiming to be an exact fork.
- Legacy questions without both required context fields cannot use context-only fallback and receive a precise unavailable reason.

### Read-only tools and sandbox

- Expose only scoped equivalents of `read`, `grep`, `find`, and `ls`, plus `propose_answer`. Do not expose `bash`, `edit`, `write`, or extension-provided tools.
- The filesystem scope is the Git worktree containing the recorded cwd. If cwd is not in a Git worktree, scope is the cwd subtree.
- Enforce containment after normalization and realpath resolution, including every traversed path and symlink target. Reject absolute, relative, and symlink escapes.
- Honor repository ignore rules and deny common secret-bearing names/patterns such as environment files, credentials, private keys, signing material, and token stores. A denied path must produce a safe tool error without revealing file contents.
- Keep tool arguments, match counts, directory entries, file bytes, and browser-rendered output finite. Sanitize and truncate expandable output at explicit protocol limits.
- Render tool execution as a compact row with target, running/success/error state, and an optional expanded details view. Full tool activity remains in the temporary fork but is never copied to server persistence.

### Proposed answer options

- `propose_answer` appends one new selectable option; it does not select an existing option, apply a draft, populate Note, populate Rationale, submit, cancel, or resolve.
- The model may supply the visible option label and optional description, meaning, and context within the same finite limits as original options.
- The model never supplies the authoritative option identifier. The server generates a collision-free opaque value.
- Proposal execution crosses the existing extension/server control plane and completes only after the server atomically validates and appends the option.
- The server rechecks that the Postbox Question is pending, the originating extension/session owns the request, payload limits pass, the generated value is unique, and the total option count remains within the established maximum.
- Persist proposed options in the authoritative Question record because selected values are validated against that record and may appear in resolved History. This persistence is answer data, not Chat-transcript persistence.
- Add server-controlled provenance to request snapshots so original and Chat-proposed options can be distinguished. Existing/legacy options without provenance are treated as original. Ask creators cannot spoof Chat provenance.
- Proposed options are append-only and immutable. They appear in chronological order in the normal option list with a subtle **Suggested in Chat** badge.
- A successful call emits a compact Chat confirmation. Mobile confirmation includes an action that selects the Question tab. Errors such as terminal status, duplicate/invalid data, or option-limit exhaustion render as bounded tool errors.
- A proposal never changes the user's current selected values or Note. The user selects and submits through the existing answer form.
- Do not add Rationale UI or model-authored Note behavior in this feature.

### Server relay and browser API

- Preserve the accepted topology: one outbound extension WebSocket, browser HTTP actions, and SSE for reactive browser events. Do not add a direct browser-to-extension connection.
- Extend the shared extension protocol with correlated, finite commands for Chat start/recovery, snapshot, send/steer, stop, and lifecycle cleanup; add normalized snapshot/event/result messages in the reverse direction.
- Browser-facing request resources expose four behaviors at the highest seam:
  - idempotently start or explicitly context-start a pending Question Chat;
  - fetch/resynchronize the current snapshot from the owning extension;
  - send a client-command-ID plus bounded user text;
  - stop the active model turn.
- Use a question-scoped SSE stream for normalized Chat events rather than putting token deltas into persisted full-state snapshots. The existing state SSE remains responsible for durable Question changes, including appended proposed options.
- When a user message arrives during generation, dispatch it through Pi's steering behavior for the active turn. Otherwise dispatch it as the next ordinary prompt.
- Browser command retries use stable client command IDs and receive idempotent accepted/completed responses. Do not silently queue commands while the extension is offline.
- Typed errors distinguish at least: request missing, request not pending, Chat not started, extension offline, source unavailable, context fallback unavailable, invalid/duplicate command, rate limited, command timeout, and runtime failure.
- State-changing Chat routes use the existing same-origin protection and finite body limits. Add bounded per-origin/request Chat command rate limits to constrain model spend and abuse.
- The server routes commands only to the live extension registered for the Postbox Session that owns the question. Extension and server both revalidate ownership and pending status at side-effect time.
- The server may relay transient events to connected browsers but must not make those events durable. A server restart requires a fresh extension snapshot.

### Browser behavior and presentation

- Build native Svelte components consistent with the current dashboard. Reuse interaction and reducer ideas from researched chat projects, but do not import a React runtime or a general coding-agent workbench.
- Render finalized/streaming assistant text as sanitized Markdown with bounded code blocks; render user messages plainly. Never render hidden reasoning.
- Preserve already-rendered client state during a temporary extension disconnect, mark it stale/offline, disable send/Stop as appropriate, and expose Retry. A new/reloaded client with no extension connection shows unavailable rather than fabricated history.
- On terminal model failure, retain accumulated assistant text in the fork and UI with an Interrupted marker. On user Stop, retain it with a Stopped marker. Neither action deletes Chat.
- Desktop defaults to left navigation open, central Question visible, and Chat absent until explicit activation.
- Add an accessible navigation toggle button and own Cmd+B on macOS / Ctrl+B elsewhere as the dashboard navigation shortcut.
- Persist left-navigation open/closed preference browser-locally across question changes, reloads, and browser restarts. Do not server-sync it.
- Started Chat appears as a fixed responsive-width right sidebar when its question is selected, unless hidden for that question. Per-question hide/show is client presentation state and does not affect runtime lifecycle.
- Do not add drag resizing in v1.
- Before mobile Chat activation, show a Chat button in the Question view and no Question/Chat tab bar.
- After activation, show bottom Question and Chat tabs, select Chat initially, and remember the last selected tab independently per question. Keep project/question navigation in its existing drawer.
- Proposed options update through authoritative Question state, remain scrollable with original options, and retain the normal single/multi selection behavior.
- The empty Chat surface always exposes freeform input alongside Elaborate, Pro–Cons, and Teach me starters.

### Packaging and compatibility

- Declare and package the Pi SDK runtime relationship in a way that works for the combined npm/Pi package installation and does not depend on an undeclared accidental module-resolution path.
- Keep the direct runtime compatible with the Pi SDK revision validated during research (0.80.10) or update the adapter and tests deliberately if the package advances.
- Ensure built protocol, server, extension, and web assets required for Question Chat are included in the one user-facing package under the accepted packaging ADR.
- Document that Chat adds model spend and scoped repository-read capability under the existing Tailscale-only trust boundary.
- Preserve unknown-field tolerance and additive snapshot compatibility where possible. The new required context is intentionally strict for new ask creation while historical snapshots remain tolerant.

## Testing Decisions

- Tests assert externally observable behavior and process-boundary contracts, not private class structure, exact internal event-handler calls, generated CSS, or Pi SDK implementation details.
- The confirmed primary acceptance seam is one running Fastify app with temporary SQLite, a fake originating extension connected through the real extension WebSocket, browser-facing HTTP actions, and real SSE clients. A deterministic fake Question Chat runtime emits snapshots, deltas, tool activity, proposal calls, failures, and lifecycle events without provider credentials.
- Through that primary seam, cover:
  - strict new context validation and tolerant legacy snapshots;
  - pending-only, idempotent Chat activation;
  - exact-fork unavailable responses and explicit context-only fallback;
  - snapshot synchronization followed by ordered streaming events;
  - ordinary prompt versus in-progress steering behavior;
  - client-command deduplication;
  - Stop preserving Chat while answer/cancel/expiry aborts and terminates it;
  - extension disconnect/offline errors without queued commands;
  - extension reconnect and snapshot resynchronization;
  - proposal append, generated identity, provenance, state SSE broadcast, selection validity, and resolved History retention;
  - option limit, invalid proposal, wrong owner, and terminal-race rejection;
  - no Chat transcript appearing in SQLite-backed state or History.
- Add one narrow extension runtime-adapter seam using temporary fixture Pi session files and a deterministic injected AgentSession/model boundary. Cover exact root-to-leaf branch isolation, source immutability, private output placement, no inherited resources, explicit tool allowlist, source-model fallback, context-only labeling, Stop, dispose, restart recovery, and terminal cleanup.
- At the runtime-adapter seam, test filesystem wrappers with real temporary directories and repositories: worktree-root discovery, non-Git cwd fallback, `..` escape, absolute escape, symlink escape, ignored paths, secret-like paths, finite traversal/matches/output, and ordinary tracked/untracked source access.
- Add focused protocol schema tests for every new browser/extension command, event, snapshot, provenance field, size limit, and legacy compatibility case.
- Add focused RequestStore tests at its existing transaction seam for atomic proposal append, pending-only enforcement, unique server-generated values, immutable provenance, option maximum, answer validation against proposed values, first-terminal-transition wins, and persistence across server restart.
- Add Svelte store/layout behavior tests for:
  - browser-persisted navigation state and Cmd/Ctrl+B;
  - desktop Chat start/show/hide behavior per question;
  - mobile activation and remembered per-question tabs;
  - starters and freeform first send;
  - streamed/stopped/interrupted/offline rendering state;
  - compact expandable read-only tool activity;
  - Chat proposal confirmation and Question-tab navigation;
  - proposed option badge without auto-selection or Note mutation.
- Prefer behavior-level Svelte state/component tests. Existing store tests and mobile/static UI tests are prior art; static source assertions alone are insufficient for streaming and interaction state where a behavior test is practical.
- Extend the packaged smoke path with a fake extension/runtime exchange proving: registration, context-complete ask creation, Chat activation, one streamed response, one proposed option, option selection/answer, terminal cleanup signal, state/history correctness, and packaged UI availability. Do not require live model credentials.
- Run the existing full typecheck, unit/integration suite, production build, package-content checks, and smoke test to guard the combined package, lifecycle ADRs, answer loop, SSE state, security, and Tailscale behavior from regressions.

## Out of Scope

- Android-specific Chat UI or native Android work.
- A general-purpose Postbox chat dashboard or mirroring complete originating Pi transcripts.
- Persisting Question Chat messages, deltas, tool output, or transcripts in server SQLite.
- Showing Question Chat transcripts after a Postbox Question resolves.
- Automatically starting Chat or automatically generating a first model turn.
- Automatically using context-only fallback without user confirmation.
- Multiple independent Chats per Postbox Question.
- Collaborative multi-user chat, writer leases, presence cursors, or conflict-resolution UX.
- Pi CLI RPC child processes, containers, or a direct browser-to-extension connection.
- Shell, write, edit, patch, terminal, diff, attachment, branch, compaction, or generic coding-workbench controls.
- Reading outside the source worktree/cwd boundary or reading ignored/secret-like files.
- Model selection, thinking-level controls, or private reasoning display.
- Model-authored Note or Rationale content.
- Letting the interviewer select, submit, cancel, expire, or otherwise resolve the Postbox Question.
- Editing or deleting Chat-proposed options after append.
- Drag-resizable desktop panels or server-synchronized layout preferences.
- New app-level accounts/authentication. V1 retains the accepted Tailnet-private trust boundary.
- Public Tailscale Funnel exposure.

## Further Notes

- This spec advances the original Pi Postbox PRD's explicitly reserved “future conversational interviewer” into scope while preserving its context-hygiene rule: only the final selected values and user-authored Note return to the originating coding agent, never the interviewer transcript.
- The accepted Pi Session replacement ADR remains authoritative. Question Chat recovery applies to reload/reconnect of the same Pi Session, not migration to a replacement session.
- The accepted Tailnet-private deployment ADR remains authoritative. Because Chat adds model spend and repository reads, documentation must make the expanded consequence of tailnet access explicit.
- The accepted combined-package ADR remains authoritative. A release is incomplete if the installed Pi package cannot load the direct SDK adapter or serve the Chat UI.
- The research assessment found useful runtime and interaction patterns in existing starred repositories, but their React/workbench coupling is inappropriate for this Svelte surface. Port patterns, not components.
- The product decision record and source-pinned research are maintained separately from this issue specification. Where earlier research recommended server-persisted transcripts or a proposal-only tool boundary, this spec supersedes those recommendations with the completed grill decisions.
