# Notification-open latency diagnosis

Date: 2026-07-29

## Conclusion

The main bottleneck is not the absence of a client database. The dashboard sends several large, overlapping representations of terminal question history while a notification-open path waits for a fresh state snapshot.

At the measured live server state:

- `/api/state`: about **1.15 MB**, containing **478 terminal requests** and no pending requests.
- A state snapshot containing sessions and pending requests only: about **9.5 KB**.
- `/api/history`: about **1.47 MB**, containing the same 478 terminal decisions in history form.
- The one-question compact bootstrap used in the controlled experiment: **4.3 KB**.

A notification open starts two `/api/state` requests concurrently:

1. `store.start()` calls `loadSnapshot()`.
2. `openRequestFromNotification()` independently calls `fetchSnapshot()`.

The SSE connection also sends a complete state snapshot immediately. Its initial event triggers another history refresh. History is already fetched once during startup. On a constrained connection, these requests compete for bandwidth.

The first fix should therefore be to bound and deduplicate live data, not to add SQLite to the browser.

## Feedback loop

Harness (ignored diagnostic artifact):

```text
tmp/measure-notification-open.mjs
```

It runs the current production web app through Chrome/CDP, opens the notification URL, and changes only the chosen terminal request in the second browser response to `pending`. This avoids changing live server data while exercising the real notification navigation and rendering path. The check fails if the target question is not visible within 5 seconds.

Controlled mobile profile:

- 1.6 Mbps download
- 750 Kbps upload
- 100 ms latency
- 4x CPU slowdown
- cold browser cache unless noted

Red command:

```bash
MAX_QUESTION_VISIBLE_MS=5000 node tmp/measure-notification-open.mjs \
  https://coolify.tailf5ea68.ts.net:32187 \
  notification-prefetch-direction mobile cold normal full
```

Observed:

```text
FAIL: question became visible at 27814ms (budget 5000ms)
exit=1
```

Two prior identical runs rendered the question at 27,755 ms and 27,733 ms, so the reproduction is stable.

## Experiments

| Scenario | Question/data ready | Result |
|---|---:|---|
| Current notification open, full background traffic, cold | 27.7–27.8 s | Reproduces the complaint |
| Notification open, history and initial SSE traffic suppressed, cold | 15.6 s | Background traffic accounts for about 12 s under this profile |
| Ordinary root open, one full state request and background traffic suppressed, cold | 9.55 s | The notification path's duplicate state request adds about 6 s |
| Compact 4.3 KB question bootstrap, background traffic suppressed, cold | 3.34 s | Under the 5 s budget; cold app shell dominates |
| Compact 4.3 KB question bootstrap, warm shell | 0.36 s | Installed/warm-app target behavior |

The compact experiment passes the same budget check:

```text
questionVisibleAtMs: 3341
compactStateBytes: 4278
exit=0
```

## Other measurements

Five direct `/api/state` requests took:

- Local server: 27–92 ms total.
- Tailnet URL from this machine: 58–71 ms total.

This rules out database query time, Fastify response generation, TLS setup, and Tailnet round-trip latency as the dominant cause. Transfer volume and duplicated client work dominate on constrained mobile conditions.

The API responses are currently uncompressed. The captured JSON compresses from:

- State: 1.15 MB raw to 327 KB with gzip.
- History: 1.47 MB raw to 342 KB with gzip.

Compression would help but would not remove the duplicated work or the unbounded live-state design.

## Ranked causes

1. **Terminal history is included in live state.** `getSnapshot()` calls `requestStore.list()` without a status filter, so every retained terminal request is sent through both `/api/state` and SSE.
2. **Notification startup duplicates `/api/state`.** `store.start()` and `openRequestFromNotification()` fetch it independently.
3. **History is eagerly and repeatedly loaded.** Startup fetches it, and every SSE state event fetches it again, although only `HistoryView` reads it.
4. **The SSE subscription immediately sends another full state snapshot.** This duplicates the initial HTTP snapshot.
5. **Cold app-shell cost is secondary.** The current JS bundle takes about 3 seconds to load under the controlled profile, but a warm compact bootstrap renders in about 0.36 seconds.
6. **JSON/schema parsing and rendering are secondary.** They add measurable work, but much less than transferring repeated megabyte payloads.

## Recommended implementation order

1. **Make live state pending-only and bounded.** `/api/state` and SSE should not carry the retained terminal history. Preserve any short local answer-confirmation behavior explicitly rather than retaining hundreds of terminal requests in every live snapshot.
2. **Lazy-load history.** Fetch it when History is opened, not at app startup and not after every state event.
3. **Coalesce initial notification navigation with startup state loading.** One current-state request should satisfy both startup and notification selection.
4. **Avoid HTTP+SSE initial duplication.** Either use the HTTP snapshot followed by future-only SSE updates, or let SSE provide the initial snapshot and avoid the HTTP request.
5. **Set explicit cache semantics on dynamic APIs and enable compression.** Current JSON responses have neither `Cache-Control` nor `Content-Encoding` headers.
6. **Re-run the notification harness on the real implementation.** The target is under 5 seconds cold and near-instant with a warm installed shell.
7. **Only then consider service-worker prefetch.** If a real phone still has noticeable latency, use Cache Storage (or IndexedDB for structured records) to prefetch a bounded per-question bootstrap. Do not add SQLite/WASM; `localStorage` is unavailable in service workers and SQLite adds unnecessary weight and lifecycle complexity.

## Scope and artifacts

No production code or live database rows were changed. Browser response mutation was confined to the diagnostic page. Raw run outputs are in ignored `tmp/*.json` files.
