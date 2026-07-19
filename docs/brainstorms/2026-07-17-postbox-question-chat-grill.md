# Postbox Question Chat — shared-understanding brief

**Date:** 2026-07-17
**Status:** Grill complete; this brief supersedes conflicting recommendations in the earlier research report.
**Research:** [`../research/2026-07-17-postbox-question-fork-chat.md`](../research/2026-07-17-postbox-question-fork-chat.md)

## Product boundary

A pending Postbox Question can own one optional Chat backed by a fork of the Pi Session that asked the question. Chat helps the same human user understand and answer that question. It is not a second coding workspace and never submits the authoritative answer itself.

Chat is web-only. One user may move between browser devices; this is not a collaborative multi-user chat.

## Activation and first turn

- Chat starts only after the user clicks that question's **Chat** button.
- Starting Chat creates or recovers the fork but does **not** call the model automatically.
- The empty Chat view contains a freeform composer and three static starters:
  - **Elaborate** — explain what the asking agent means when the wording is unclear.
  - **Pro–Cons** — compare trade-offs when the terminology is understood but the user lacks enough context to judge.
  - **Teach me** — teach the necessary basics when the subject is unfamiliar.
- Selecting a starter sends its corresponding prompt as the first turn.
- A message sent while the model is generating steers the current generation rather than becoming a queued follow-up.

## Runtime and transport

- The originating Postbox extension owns one direct, in-process Pi SDK runtime per active question Chat.
- This uses an RPC-style Postbox relay: browser commands pass through the Postbox server and the extension's existing WebSocket; normalized SDK events stream back through the server. It does **not** spawn `pi --mode rpc` as a child process.
- The extension opens the source Pi session and creates the exact root-to-leaf branch in a private, question-keyed directory.
- The temporary Pi JSONL fork is the sole Chat transcript. Postbox does not duplicate finalized Chat messages into SQLite.
- The fork and a small manifest survive routine extension/Pi process restarts and are reopened while the question remains pending.
- Answer, cancel, expiry, or another terminal question transition immediately aborts active work, disposes the runtime, and deletes the fork. Late proposed options are rejected.
- **Stop** aborts only the current model turn, preserves accumulated output marked as stopped, and leaves Chat usable.
- After Pi's bounded retries are exhausted, partial model output remains visible and is marked interrupted; further model work requires explicit user action.

## Transcript availability

- An already-open browser keeps its rendered messages during an extension outage, marks them offline, disables writes, and offers Retry.
- A fresh or reloaded browser cannot fetch Chat while the extension is offline; after reconnect it resynchronizes from the fork.
- Resolving the question deletes the transcript, so resolved History has no Chat transcript.

## Source and model fallback

- Use the originating session's recorded model when available and authenticated; clearly fall back to Pi's configured default otherwise. Postbox adds no model picker in v1.
- If the exact source file or leaf is unavailable, explain the degradation and offer an explicit fresh interviewer session using persisted handoff context. Never fall back silently.
- Every **new** Postbox Question must provide non-empty `codebaseContext` and `problemContext`; `additionalInfo` remains optional.
- Legacy stored questions without context remain readable. They may use an exact fork when available but cannot use context-only fallback.

## Allowed tools and data boundary

The runtime disables inherited extensions, skills, prompts, themes, and context-file discovery. It exposes only:

- `read`, `grep`, `find`, and `ls` through scoped wrappers;
- `propose_answer`.

Read-only tools are confined to the originating cwd's Git worktree root, or the cwd subtree when no worktree exists. They reject lexical and symlink escapes, honor ignore rules, and deny common secret/credential/key paths. Tool activity appears as compact status rows with expandable, sanitized, truncated arguments and output.

## Proposed answers

`propose_answer` does not recommend/apply an existing selection and does not create a full answer draft. Instead, each successful call appends one new selectable option to the authoritative Postbox Question.

- The model may supply the full visible `AskOption` metadata: label plus optional description, meaning, and context.
- The server generates the collision-free internal option value and appends the option atomically only while the question is pending.
- Proposed options are append-only and persist on the Question even though the Chat transcript is temporary.
- They render in the ordinary option list with a subtle **Suggested in Chat** badge and remain in resolved History.
- Chat renders a compact “Added proposed option” confirmation. On mobile it also offers a way to view the Question tab.
- Proposals never auto-select an option.
- The user scrolls to and selects any original or proposed option normally.
- The optional answer Note remains entirely user-authored. Rationale is not used in this version.
- Existing option-count and payload limits remain authoritative; a proposal that cannot be appended returns a visible tool error.

## Layout

### Desktop

- Default: existing left navigation open, central Question visible, Chat absent/closed.
- The navigation has a visible toggle and **Cmd+B** on macOS / **Ctrl+B** elsewhere.
- Navigation open/closed state is browser-local and survives question changes, reloads, and browser restarts.
- A started Chat appears as a fixed responsive-width right sidebar whenever its question is selected, unless the user has hidden that question's Chat.
- Chat visibility can be hidden/shown independently per question; hiding does not stop or delete it.
- The Chat sidebar is not drag-resizable in v1.

### Mobile

- Before Chat starts, the Question view contains the Chat button and no Chat tabs.
- Starting Chat reveals bottom **Question** and **Chat** tabs and selects Chat.
- The UI remembers the last selected tab per question so the user can alternate between the decision and conversation.
- Project/question navigation remains a separate drawer.

## Coordination and trust

- All browser devices view/control the same question-owned fork. The product assumes one human user rather than simultaneous independent writers; request IDs still prevent accidental duplicate commands.
- The existing Tailscale-only, no-app-auth trust boundary remains for v1. Same-origin checks, pending-status revalidation, command rate limits, scoped read tools, and secret filtering are mandatory because Chat adds model spend and repository-read capability.

## Explicit non-goals

- No Android-specific UI.
- No child-process runtime or direct browser-to-extension connection.
- No server-persisted Chat transcript or resolved Chat history.
- No automatic model turn on activation.
- No write, edit, shell, terminal, diff, attachment, branch, or model-picker UI.
- No inherited Pi extensions/skills/context resources.
- No hidden reasoning display or persistence.
- No model authority to submit, cancel, or otherwise resolve a Postbox Question.
