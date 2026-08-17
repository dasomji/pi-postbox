# Postbox output-reduction implementation

Date: 2026-08-15
Version: 0.1.4
Status: complete; fresh 0.1.4 checkout runtime verified (Pi extension reload remains an operator action)

## User direction

Implement the five recommended reductions from `docs/audits/2026-08-15-postbox-verbose-output-reduction.html`. Compatibility with the session-only 0.1.3 tool contract is not required; prefer the best long-term interface. The user explicitly approved rewriting obsolete tests.

The Postbox clarification attempt failed because the currently loaded extension is stale after the 0.1.3 protocol restart. The user answered through the structured local interview instead: choose the best long-term contract and verify the protocol, RequestStore, and transport/tool-registration seams.

## Interface decisions

Use reduced outputs by default and keep complete forensic forms explicit:

1. **Batch context defaults**
   - Batch `ask_postbox` requires `defaults.context`.
   - Each batch item may omit `context` or replace the default with a complete context.
   - The compact payload crosses the WebSocket. The server expands and validates every draft before persistence; stored Questions remain self-contained.
2. **Question controls by default**
   - `get_questions({ questionIds })` returns control records: ids, both revisions, lifecycle status, owner/creator, optional parent, and update timestamp.
   - `view: "full"` returns the complete content/options/context/lifecycle record.
3. **Event history by default**
   - `get_question_history({ questionId })` returns one initial full content snapshot, section-level content revisions containing only replaced sections, and non-content lifecycle/ownership/parent events.
   - `view: "full"` returns immutable full revision snapshots and all events.
   - Section-level deltas match existing complete-replacement semantics and avoid a second patch language.
4. **Scoped owner discovery**
   - Add `list_postbox_owners({ scope })`, with `feature` as the default and only `feature`, `worktree`, or `repository` allowed.
   - Derive scope from the registered caller; accept no global mode and no arbitrary scope IDs.
   - Return only owner identity, coarse presence, and queue counts—no titles, paths, heartbeat timestamp, semantic state, or Question content.
5. **Structured pending Answer reads**
   - `get_answer` returns `{ type: "pending", status: "pending", questionId }` instead of an error while unresolved.
   - It remains a bounded read, not a hidden wait.

Do not implement stateful cursors or opaque concurrency tokens; the audit recommended retaining the robust explicit forms.

## Confirmed test seams

The user selected:

- protocol schemas and inferred contracts;
- RequestStore / SessionStore public behavior;
- WebSocket transport and extension tool registration;
- full build, typecheck, test, smoke, and fresh-runtime proof after all slices.

Use vertical red → green slices and rewrite old expectations that encode the superseded 0.1.3 defaults.

## Planned slices

1. Batch defaults: **green** at protocol/tool/RequestStore seams. The compact defaults object crosses the WebSocket and RequestStore expands it before validation/persistence.
2. Compact/full Question views: **green** at protocol/tool-schema/RequestStore seams. Compact controls are now the default and `view: "full"` is explicit.
3. Event/full history views: **green** at protocol, RequestStore, WebSocket, and tool-schema seams. Event history is the default; full immutable snapshots remain explicit.
4. Scoped owner discovery: **green** at protocol, SessionStore, authorized WebSocket, and tool-schema seams. Results are capped at 100 and expose only owner, coarse presence, and scope-filtered queue counts.
5. Pending Answer result: **green** at protocol, RequestStore, WebSocket/client correlation, and tool-schema seams.
6. Cross-slice WebSocket transport acceptance: **green** for batch defaults, compact/full details, event/full history, and pending Answer reads.
7. Documentation and release/runtime verification: **complete**. README and protocol contracts document all five reductions; the audit HTML distinguishes the preserved 0.1.3 correctness baseline, implemented 0.1.4 reductions, and deliberately rejected cursor/concurrency alternatives.

## Final validation

- Focused slice suites passed after deliberate RED failures.
- The first full suite found four obsolete 0.1.3 expectations/fixtures; all four were rewritten and their focused rerun passed (4 files / 13 tests).
- New cross-slice WebSocket transport acceptance passed (1 file / 1 test).
- `npm run typecheck` passed.
- Final `npm test` passed: 97 files / 576 tests.
- `npm run build` passed, including the Vite production build and packaged server asset copy.
- `npm run smoke` passed against the built CLI, including async owner single/batch, Question Chat, restart, durable history, Answer reads, and capacity paths.
- Root, web, protocol, server, and extension manifests plus their package-lock workspace entries all report `0.1.4`.
- `git diff --check` passed.
- Stale checkout-profile processes were stopped and the development launcher was restarted on stable API port `41657` (UI `37105`). Fresh `/healthz` and profile metadata agree on version/protocol `0.1.4`, build `0.1.4+sha256.fe7ee0667bcd625c`, instance `c9e5d0d4-0d8d-45c4-8a37-bbf4cb31046b`, and URL `http://127.0.0.1:41657/`.
- The active server process started at 16:28:17 UTC, after the newest implementation build output at 16:19:12 UTC and source at 16:20:07 UTC. Only the fresh checkout server and Vite process remain for this profile.
- A non-mutating live WebSocket check against that exact process accepted both default-control and explicit-full `questions.get` requests and returned correlated empty results for a deliberately nonexistent ID.

## Operator follow-up

The current Pi process loaded the pre-0.1.4 extension tool schemas. Run `/reload` so this session registers the new `list_postbox_owners` tool and updated batch/view/pending schemas before using those tools live.
