# Android Question Chat transport and streaming constraints

**Research ticket:** [Research Android Question Chat transport and streaming constraints](https://github.com/dasomji/pi-postbox/issues/59)  
**Date:** 2026-07-29

## Question

Which current Android, Kotlin coroutine, and networking APIs—and which existing Pi Postbox Android client patterns—should underpin question-scoped activation/snapshot HTTP plus long-lived Question Chat SSE?

## Recommendation

Keep OkHttp 4.12.0, Kotlin serialization, coroutines, and MockWebServer. Add **no general networking abstraction and no third-party SSE stack**. Introduce three narrow seams:

1. **`QuestionChatHttpClient`** — cancellable one-shot activation, confirmed context activation, snapshot, send, and stop calls.
2. **`QuestionChatEventTransport`** — one closeable question-scoped SSE connection that reports open, decoded frame, malformed frame, EOF, and failure. It does not reconnect, fetch snapshots, or reduce Chat state.
3. **`QuestionChatOwner`** — the sole `(normalized server URL, requestId)`-keyed owner of the in-memory snapshot, command jobs, stream/reconnect loop, sequencing, and stale-owner rejection.

Use `Call.enqueue()` plus `suspendCancellableCoroutine` for one-shot calls. Cancellation must call `Call.cancel()`, and every response must close even when cancellation races with callback delivery. OkHttp documents that `execute()` blocks and that cancellation can surface as `IOException`; a coroutine around blocking `execute()` does not itself bind Job cancellation to the Call ([OkHttp 4.12 `Call.kt`](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/Call.kt), [coroutines `suspendCancellableCoroutine`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html)).

For SSE, retain an app-owned streaming reader over `ResponseBody.source()` with explicit `Call.cancel()` and a bounded channel/Flow adapter. Do **not** add `okhttp-sse` for this slice: its public API is cancellable and its parser is useful prior art, but 4.12.0 deliberately does not auto-retry and its reader has no public per-line/per-event byte limit ([`RealEventSource.kt`](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp-sse/src/main/kotlin/okhttp3/internal/sse/RealEventSource.kt), [`ServerSentEventReader.kt`](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp-sse/src/main/kotlin/okhttp3/internal/sse/ServerSentEventReader.kt)). Owning the small parser is justified here because finite frames and snapshot-aware reconnects are protocol requirements, not generic EventSource policy.

## Repository facts

- Android currently uses OkHttp `4.12.0`, coroutines `1.10.2`, serialization `1.8.1`, lifecycle `2.9.0`, and MockWebServer `4.12.0` (`apps/android/app/build.gradle.kts`).
- Ordinary HTTP uses blocking `Call.execute()` inside `withContext(Dispatchers.IO)` and then `ResponseBody.string()` (`PostboxProtocolClient.kt`). This is useful endpoint/JSON prior art, but it neither propagates coroutine cancellation to the Call nor bounds raw response bytes.
- Dashboard state SSE already supplies the correct operational precedents: zero call/read timeout, dedicated I/O work, explicit `Call.cancel()`, idempotent start, reconnection, and MockWebServer coverage (`PostboxStateStream.kt`, `PostboxStateStreamTest.kt`). Its policy and replaying `SharedFlow` should not become the Chat owner: Question Chat has a different bootstrap, sequence, privacy, and one-selected-question contract.
- `MainActivity` starts the dashboard workflow at `ON_START` and closes it at `ON_STOP`. AndroidX documents that `repeatOnLifecycle(STARTED)` starts work while started, cancels it below that state, and restarts it on return; either that API or the existing explicit observer may drive the owner, but the actual Chat connection must be cancellable by the lifecycle rather than live in an unobserved permanent scope ([Android lifecycle coroutines](https://developer.android.com/topic/libraries/architecture/coroutines?hl=en), [StateFlow and SharedFlow](https://developer.android.com/kotlin/flow/stateflow-and-sharedflow?hl=en)).
- The server exposes activation/context activation/snapshot/send/stop as HTTP and one question-scoped SSE endpoint. The stream writes `: question-chat-connected\n\n`, followed by single-line `data: <JSON>\n\n`; it does not replay a transcript (`packages/server/src/routes/requestRoutes.ts`, `docs/protocol.md`).
- The browser's race-free bootstrap is the behavioral oracle: open and buffer the event stream, wait for open, fetch a fresh snapshot, install it, then sort/apply buffered runtime events (`apps/web/src/lib/questionChatLifecycle.svelte.ts`).
- Runtime events carry a positive monotonic `sequence`; snapshots carry the high-water mark. Transport online/offline events are intentionally unsequenced. The protocol bounds messages, deltas, tools, command IDs, and array counts (`packages/protocol/src/chat.ts`).
- The relay defaults command waits to 10 seconds and caps configuration at 60 seconds (`packages/server/src/services/questionChatRelay.ts`). One-shot Android timeouts must therefore be finite but longer than the supported relay maximum plus network margin; SSE call/read timeouts remain zero and lifecycle cancellation supplies the bound.

## Options considered

### A. Extend `PostboxProtocolClient` and `PostboxStateStream`

**Rejected.** It minimizes files but combines unrelated ask actions, one selected Chat transcript, stream bootstrap, sequencing, and lifecycle policy. The current state stream also replays status objects and owns reconnect internally, while Chat must snapshot after every reconnect before applying events.

### B. Add OkHttp's `okhttp-sse` module

**Not selected for this protocol.** It provides an asynchronous `EventSource`, cancellation, content-type validation, and a tested SSE reader ([`EventSource.kt`](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp-sse/src/main/kotlin/okhttp3/sse/EventSource.kt), [`EventSources.kt`](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp-sse/src/main/kotlin/okhttp3/sse/EventSources.kt)). But 4.12 ignores SSE `retry`, does not reconnect, and does not expose frame limits. The Android owner would still need all reconnect and snapshot policy, while finite malformed-input handling would be weaker.

### C. Core OkHttp plus narrow cancellable HTTP/SSE adapters

**Selected.** It reuses installed dependencies and local patterns, allows bounded reads, keeps reconnect and reducer policy visible at the owner seam, and remains straightforward to exercise with MockWebServer.

## Required transport behavior

### One-shot HTTP

- Build paths with `HttpUrl.addPathSegment`; never concatenate an untrusted request ID.
- Send the exact existing endpoint shapes and decode typed success/unavailable bodies even on non-2xx status.
- Adapt `enqueue` with `suspendCancellableCoroutine`; install `invokeOnCancellation { call.cancel() }` before enqueue. Callback/cancel registration must be thread-safe because cancellation can race with callback execution ([coroutines API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html)).
- Close `Response` on all branches, including a response delivered after cancellation. OkHttp response bodies are one-shot socket-backed resources and must be closed ([OkHttp 4.12 `ResponseBody.kt`](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/ResponseBody.kt)).
- Use a finite command/snapshot call timeout greater than the relay's supported 60-second maximum (for example 70 seconds), while retaining short connect/write timeouts. Do not reuse the current zero-timeout ordinary client unchanged.
- Bound raw JSON before decoding. A practical initial ceiling is **32 MiB for snapshots/activation** and **256 KiB for acknowledgements/errors**; these preserve the shared schema's worst-case bounded transcript while preventing an unbounded `body.string()`. Keep the constants next to Android Chat protocol limits and test boundary ±1 byte.
- Treat network cancellation/timeout as ambiguous: OkHttp notes the remote server may have accepted a request before failure. Never invent a local message. Stable `clientCommandId` permits an explicit same-ID retry, while resume/recovery first fetches the authoritative snapshot.

### SSE framing

The HTML Living Standard requires UTF-8; LF, CRLF, or CR line endings; one optional space removal after the first colon; comments beginning `:`; literal field names; multiline `data` joined with LF; dispatch only on a blank line; and discard of an incomplete event at EOF ([HTML SSE parsing and interpretation](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)). The Android parser should implement that small contract even though today's server emits only comments and one `data` line.

Add hard bounds while parsing, before string allocation/JSON decode:

- **256 KiB maximum accumulated event data** (covers the protocol's largest valid `message.finished` frame with JSON escaping headroom);
- a line bound no larger than that event bound;
- a small bounded count of fields/data lines per event.

Ignore comments and unknown fields. A blank event with no data dispatches nothing. A malformed, oversized, undecodable, or wrong-request frame must never reach the reducer; report it as stale and force snapshot resynchronization rather than waiting for a later sequence gap.

Expose the reader through a cold, bounded Flow/channel or equivalent closeable connection. Coroutines documents `callbackFlow`/`awaitClose` as the bridge for multi-shot callback APIs, with mandatory cleanup and thread-safe unregister/cancel; the same cleanup rule applies if a `channelFlow` worker performs the blocking source read ([`callbackFlow`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/callback-flow.html), [`awaitClose`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/await-close.html)). Backpressure must suspend reading rather than drop events.

### Bootstrap, reconnect, and sequencing

For every activation, reattachment, retry, foreground resume, and stream reconnect:

1. capture the current `(server, requestId, generation)`;
2. open the SSE connection and buffer its finite events;
3. after transport-open, fetch a fresh snapshot;
4. reject either result if the key/generation changed;
5. install the snapshot;
6. apply buffered sequenced events in sequence order, ignoring `sequence <= snapshot.sequence`;
7. if the next sequence is greater than `snapshot.sequence + 1`, mark stale and repeat the handshake;
8. process live events only while online/current.

A transport `online` after offline also requires the handshake; opening a socket is not proof that the retained snapshot is current. Transport events do not participate in numeric ordering. Reconnect delay/backoff belongs to the owner and must be injectable for deterministic tests.

### Ownership and Android lifecycle

- Exactly one owner key exists. Replacing server or request increments a generation, cancels the stream and every in-flight HTTP Call/job, drops all transcript/tool/draft references, then installs the new key.
- Every callback and command completion checks key plus generation before mutation; payload `requestId` is also validated.
- `ON_STOP` cancels calls/stream and marks any retained in-process snapshot stale/offline. It may keep that snapshot only in RAM so the current view does not flash empty. `ON_START` performs the full stream-first snapshot handshake before declaring Chat online.
- Process death restores no Chat transcript. A recreated app probes/fetches from the extension-backed server if the selected pending Question is still available.
- Terminal Question state cancels writes/stream but may retain already-rendered output in the current in-memory owner as read-only.

## Privacy boundary

Chat snapshots, messages, deltas, tool details, and drafts may exist only in ordinary in-memory owner state and bounded transient transport buffers. They must not enter `SavedStateHandle`, `rememberSaveable`, preferences/DataStore, Room/files, OkHttp disk cache, logs, crash breadcrumbs, analytics, notifications, or test failure dumps. Use an OkHttp client with no disk cache and redact Chat URL/body details from any logging interceptor. Closing/replacing the owner must release references immediately.

## Test matrix for the implementation plan

### Real client + MockWebServer

- exact/context activation, probe/snapshot, send turn/steer, stop, typed unavailable statuses, encoded request IDs, unknown additive fields;
- cancellation before response, during body read, and cancellation-vs-response race; server-observed disconnected socket;
- one-shot timeout and response-size boundary ±1 byte;
- SSE request headers/path, open comment, LF/CRLF/CR, comments, optional single space, multiline data, unknown fields, incomplete EOF;
- malformed JSON, schema-invalid/wrong-request data, oversized line/event, non-200, wrong content type, EOF, explicit close;
- backpressure without dropped frames and at most one active stream.

### Fake clients + owner/reducer

- stream-first buffer/snapshot ordering, duplicate/stale suppression, exact next sequence, gap resync, malformed-frame resync;
- offline/online and reconnect snapshot, reconnect backoff, resume snapshot before online;
- server/request replacement cancels old resources and stale callbacks cannot mutate the replacement;
- command cancellation ambiguity, same command-ID explicit retry, no offline queue, no optimistic transcript;
- terminal transition becomes read-only while retaining current in-memory output;
- owner disposal clears transcript/tool/draft state and persistence/notification/logging seams contain no Chat content.

## Consequences for the later module-boundary ticket

The transport interfaces should return protocol facts, not UI states. In particular, HTTP methods return typed ready/unavailable results; the event transport returns connection/frame/failure facts; only `QuestionChatOwner` knows `starting`, `online`, `offline`, `stale`, activation fallback, sequence high-water, or whether a Retry action is available. This keeps the selected-question lifecycle testable without Compose and prevents either OkHttp callbacks or the general `QuestionWorkflowViewModel` from becoming the transcript owner.
