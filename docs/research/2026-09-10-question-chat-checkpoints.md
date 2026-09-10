# Question Chat: historical forks after asynchronous questions

## Recommendation

Keep the existing isolated Pi interviewer and repair question-scoped context capture. Pi supports retrospective branching from a saved entry; the originating agent can continue working. A question-only assistant is an explicit lower-context alternative, not necessary because of a Pi limitation.

This is a feasibility investigation and source audit, not a reproduction or fix of the reported web/Android failure. No running Postbox server was used for verification.

## Verified Pi capability

The project pins Pi 0.80.10, corresponding to upstream commit `8dc78834cde4e329284cf505f9e3f99763df5529`.

- Entries have stable IDs and parent relationships. `branch(entryId)` changes the manager's leaf without deleting later entries. `createBranchedSession(entryId)` extracts the ancestor path into a separate session and switches that manager to it. Call it on a private manager, never the working agent's manager. [Pinned implementation](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1280-L1425).
- A saved session path plus entry ID is enough to locate historical conversation context while the source file remains available. Labels are optional human navigation aids, not required checkpoints. The SDK accepts an entry ID; this does not require driving the interactive `/fork` selector. [SessionManager API](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1161-L1215).
- Context reconstruction handles compaction and branch summaries along the selected path. A transcript checkpoint does not snapshot files, external systems, credentials, or the entire running process. Avoid importing summaries from subsequent work into the question's historical context. [Context construction](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L450-L469).

An isolated harness installed the exact published package in `/tmp/postbox-fork-research-77Zequ`. Command: `node /tmp/postbox-fork-research-77Zequ/check.mjs`.

Result: **PASS**. The harness recorded question A, appended unrelated work and question B, copied the source, branched at A, reopened the fork, and appended an independent user message. Assertions established that A was present, later work/B were absent, and the source bytes and original manager leaf were unchanged. It also confirmed branching switches the private manager. This exercised session persistence and context reconstruction without model calls; it did not test tool-call boundaries, compaction, chat transport, or either UI. The harness is a temporary local artifact.

## Current Postbox wiring

1. `write_question` reads the current session file and leaf, then calls `updateQuestionSource`, updating shared session metadata. It does not inject that reference into the individual question draft. The converter forwards question fields, and the client sends the resulting drafts. [Extension](../../packages/extension/src/index.ts), [converter](../../packages/extension/src/tools/writeQuestion.ts), [client](../../packages/extension/src/client/PostboxClient.ts).
2. The protocol already has optional `ForkReferenceSchema`, and the request store persists `fork_reference_json`. Thus the storage concept exists. [Protocol](../../packages/protocol/src/ask.ts), [store](../../packages/server/src/services/requestStore.ts).
3. Chat activation calls `sessionStore.questionChatSource(snapshot.sessionId)`, which reads the session row, rather than using `snapshot.forkReference`. Consequently, a later question's session update can change the source used to activate an earlier question. This is a concrete source-level mismatch with per-question historical context, not proof of the complete reported runtime failure. [Route](../../packages/server/src/routes/requestRoutes.ts), [session store](../../packages/server/src/services/sessionStore.ts).
4. The runtime already snapshots the source privately and calls `createBranchedSession(source.leafId)`. It provides an interviewer system prompt, scoped repository tools and answer proposals. Activation carries the request ID and source but no explicit selected question body. Multiple questions in one assistant message/batch therefore need explicit targeting even with the correct leaf. [Runtime](../../packages/extension/src/questionChatRuntime.ts), [activation schema](../../packages/protocol/src/ws.ts).
5. Questions now survive session shutdown/replacement, but chat dispatch still depends on the originating extension connection. A correct checkpoint alone will not provide offline chat. `CONTEXT.md` still describes cancellation on shutdown and conflicts with the newer ADR. [Lifecycle ADR](../adr/0001-pi-session-replacement-lifecycle.md), [relay](../../packages/server/src/services/questionChatRelay.ts), [domain document](../../CONTEXT.md).
6. Android uses the same request chat endpoints, so the shared backend issue applies to both clients. [Android transport tests](../../apps/android/app/src/test/java/dev/pi/postbox/questionchat/QuestionChatTransportTest.kt).

## Proposed implementation

1. Capture a reference in the extension for every created question, including each batch member: durable session identity, source path, entry ID, cwd and model identity. Persist it with the question; never derive old question context from current session metadata. Metadata must come from the runtime, not model-supplied paths.
2. Define and test the capture boundary. During tool execution the leaf can be the assistant's tool-call message, before its result. Record the exact tool-call identity and selected question payload; test immediate activation and multiple calls in a turn. Do not wait for a later agent turn to discover the checkpoint. If necessary use the preceding complete conversation boundary plus explicit question context, documenting that semantic choice.
3. For stronger durability, preserve a private session snapshot when the question is created and start the model runtime lazily on first chat use. A reference-only checkpoint is cheaper, but depends on retaining the original JSONL file. Session snapshots do not freeze repository evidence; reads will see current files unless a separate revision snapshot is introduced.
4. Pass the selected question ID, revision, text, ambiguity and options into the interviewer explicitly. For batch questions, sharing a historical entry is valid, but each interviewer needs its own question identity. Define whether a question revision starts a new chat context or supplies an explicit update; never silently reinterpret old discussion.
5. Keep the actual answer flow separate: the human submits a structured answer, and the current owner obtains it through Postbox. Do not merge the interviewer conversation back into the working agent or rewind that agent to consume an answer.
6. If chat must work after the original agent exits, add a durable host-side runtime service with access to saved context and credentials, independent of the original session socket. Routing, retention, ownership transfer and cleanup need explicit implementation. A fresh question-only assistant also requires a runtime host; changing the prompt does not solve availability.

## Simpler alternative

A fresh interviewer can start with the question, ambiguity, options and a captured decision brief containing relevant facts, constraints and rationale. It is easier to make harness-neutral and avoids depending on Pi transcript retention, but cannot reliably explain reasoning omitted from that brief. If offered as fallback, clearly identify its reduced context; do not silently substitute it for an exact fork. This would change the current exact-fork-only product contract.

Prefer historical forks for Pi-created questions. Consider a question-only interviewer as an explicit mode for other harnesses or unavailable historical context. The first repair should verify A → B → chat A, batch targeting, activation during tool execution, restart/recovery, revisions and owner transfer. Runtime and UI verification must use a freshly rebuilt/restarted checkout server with exact build identity, as required by AGENTS.md.
