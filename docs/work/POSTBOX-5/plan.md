# POSTBOX-5 plan: outage-safe web connection state

Ticket: https://plane.audiopoesis.com/personal/projects/d4676922-3fa1-4877-8b0b-8ae49299b1c0/work-items/7acf669d-6a40-4d8a-bc26-d5011dbaa58a
Review mode: evidence (Opus reviews GPT code). Merge publishes to npm: hand back merge-ready; Daniel merges.
Base: origin/main f0828fe.

## Chunk A: web outage behaviour, test and verify:app journey (owner: implementer, codex gpt-6.1-sol)

Outcome:
- While the server is unreachable the connection indicator leaves "Connected" within the reconnect timeout.
- Pending Questions stay shown as pending (or unknown/stale), never "Question resolved".
- Answer controls show that a submission cannot be delivered while offline.
- Restart recovery is unchanged.
- Web test(s) plus an outage step in the `verify:app` journey cover it; regression proofs recorded.
- Android client checked for the same behaviour: fix if in scope and small, otherwise record and file a follow-up.
- Version bump across root, workspaces and lockfile.

Owned files: `apps/web/src/**`, `scripts/smoke-postbox.mjs` / `scripts/test/**` (journey), `apps/android/**` (only if needed), manifests + `package-lock.json`, `docs/agents/verify.md` (cited claims only).

Blocks/dependencies: none.

Status: Chunk A implementation complete. L0 focused tests/type gates passed during editing; final same-commit L0/L1/L2 results and regression proof receipts are recorded in `.kitchen/receipts.jsonl` and the implementer handoff. Browser L3 remains the orchestrator/verifier handoff. No push, PR or Plane changes by the implementer.

## Findings

- Root cause: `PostboxStore.failStateSnapshot` replaced the last successful snapshot with an error, so derived requests became empty and `MainView` inferred “Question resolved”. Connection state was set by startup health only; stream/poll failures never updated it.
- Fix: keep the last authoritative snapshot on failure, mark it syncing/stale and the connection unavailable immediately on SSE error or failed snapshot fetch, and restore connected state after a successful snapshot. Fallback polls recheck health/compatibility before loading state, including updated build identity after restart.
- UI: retained Questions, galleries, selections and notes remain visible. Real Submit/Cancel are disabled with an offline/reconnecting explanation; the form also refuses offline delivery at its action boundary. An uncached selected Question says “Question status unknown” until a fresh connected snapshot confirms its absence.
- Regression coverage: `storeStartup.svelte.test.ts` covers stream loss, failed polls, retained pending state, automatic recovery and a Question resolved elsewhere during another outage. `QuestionWorkspace.test.ts` covers rendered badge/Question/gallery/draft/disabled delivery, restored controls and authoritative removal, plus uncached unknown-to-resolved status. Each new regression failed on old behavior before its corresponding fix; an additional retention mutant proves a failed fetch cannot clear pending state. Logs are under `.kitchen/mutation-*.log`.
- Packaged smoke limitation: `scripts/smoke-postbox.mjs` uses HTTP/SSE/WebSocket clients and fetches the UI shell; it does not execute browser JavaScript or observe rendered state. Its existing restart/reconnect journey is preserved. No smoke assertion was weakened and no browser framework was added; outage UI coverage uses the existing Svelte DOM/Vitest setup. A real shared-browser outage/restart journey is still required for L3 by the orchestrator.
- Android: no matching false-resolution bug. `QuestionWorkflowViewModel.handleStreamStatus` copies connection status on reconnect/disconnect without discarding the visible Question/draft; `refreshState` errors likewise preserve them. Existing JVM test `disconnectedStreamStatePreservesCurrentlyVisibleQuestion` asserts DISCONNECTED, reason, Question and selected values. `OkHttpPostboxStateStream` retains latest state and reconnects; `PostboxProtocolClient` propagates I/O failures. `QuestionWorkflowScreen.ConnectionNotice` exposes disconnected/error status. Difference: Android still allows Submit while disconnected; `submitAnswer` catches I/O failures and `showSubmissionError` preserves the draft with a visible error. This is not the false-resolved bug; no Android code or generated Kotlin was changed. The orchestrator can track stricter pre-submit offline disabling separately if desired.
- Version: root/all workspace manifests, workspace dependency pins and lock metadata are 0.5.11. Regenerated Android fixture health version/build metadata and updated the existing package identity test literals; protocol stays 0.1.12 and generated Kotlin is unchanged. Third-party dependency versions are unchanged.
- Door: reversible web presentation/state handling and additive tests; no protocol, storage, production, spend or verification-gate weakening.

### Review round 1

1. Recovery now starts after startup health failure and any running-store snapshot failure. Successful compatibility negotiation opens a missing or CLOSED EventSource, so startup and quiet-stream refresh failures recover without reload or a new pushed change.
2. Stream errors invalidate cached health. Reconnected state events cannot restore Connected or delivery until fresh compatible health is available; restart tests cover changed version/build/profile and incompatible protocol.
3. README and protocol package-version statements now say 0.5.12. Root/workspace manifests, internal pins, lock metadata, identity test literals and the generator-produced Android health fixture are synchronized; third-party versions and generated Kotlin are unchanged.
4. Recovery polls do not overlap. Polling stops after a fresh health/state recovery with an OPEN stream, or a healthy live state event; permanently CLOSED streams are replaced. Dispatch sequences prevent older HTTP snapshots from overwriting newer live state or reviving resolved Questions.
5. Direct form-action tests bypass disabled controls and prove offline Submit and Cancel issue no POST and preserve the selected answer/note. Store transport tests construct a fresh store, form tests reimport their singleton, and workspace tests inject a fresh store per case.
6. Submit and Cancel reference the live delivery explanation with aria-describedby. Connected background refreshes use neutral “Refreshing…” wording. An offline action error disappears once delivery is available again; native disabled buttons and the live status explanation are retained.

Verification: new regression cases fail against the pre-round implementation or targeted guard mutants, with logs in `.kitchen/mutation-r1-*.log`. Final same-commit L0/L1/L2 and individual mutation receipts are appended to `.kitchen/receipts.jsonl`. No push, PR, Plane, production-server or Android behavior changes are part of this round.

### Review round 2

1. Recovery health and snapshot reads now share a four-second abort deadline, shorter than the five-second poll interval. A blackholed request releases the polling guard for a later successful attempt. Cleanup aborts startup and recovery fetches. Fake-timer DOM tests cover hung health and snapshot reads, retained pending Questions and Submit becoming available again; transport tests cover cancellation during startup health, recovery health and recovery snapshot reads.
2. Queue Dismiss is disabled while disconnected, including nested Questions, and references a live offline explanation with `aria-describedby`. The action boundary also refuses offline dismissal. DOM tests prove the controls and explanation recover, and bypassing the disabled button sends no request or resolves any Question.
3. Version 0.5.13 synchronizes root/workspace manifests, internal pins, lock metadata, identity assertions, README/protocol statements and the generator-produced Android health fixture. Third-party dependencies and generated Kotlin are unchanged.

Regression proofs use the old behavior or targeted mutants; logs are `.kitchen/mutation-r2-*.log`. Final same-commit verification and individual mutation receipts are in `.kitchen/receipts.jsonl`. No push, PR, Plane, production-server or Android behavior changes are part of this round. Half-open stream liveness (POSTBOX-17), Android (POSTBOX-16) and accepted startup-incompatible snapshot wording remain outside scope; browser L3 remains with the parent verifier.

### Review round 3

1. Retain the four-second whole-attempt deadline so hung health, headers or bodies release recovery. Discard a late recovery failure only when a newer snapshot has applied, health is present, the connection is Connected and EventSource is OPEN. Release the polling guard and attempt resources before failure handling so an immediate retry can start. A fake-timer DOM regression holds a recovery body for 4.5 seconds while live snapshots arrive every two seconds, checking the badge and Submit/Cancel/Dismiss every 250 ms for 20 seconds after reconnection. A transport regression proves immediate retry when the stream has meanwhile left OPEN.
2. Offline Dismiss uses the not-allowed cursor; the wait cursor applies only during an in-flight dismissal while connected.
3. Version 0.5.14 synchronizes manifests, internal pins, lock metadata, identity assertions, README/protocol statements and the regenerated Android health fixture. Third-party dependencies and generated Kotlin are unchanged.

Regression proofs and final same-commit L0/L1/L2 receipts are recorded in ignored `.kitchen/mutation-r3-*.log` and `.kitchen/receipts.jsonl`. No push, PR, Plane or production changes; browser L3 remains with the parent verifier. POSTBOX-16/17/18 and navigation draft loss remain outside scope.
