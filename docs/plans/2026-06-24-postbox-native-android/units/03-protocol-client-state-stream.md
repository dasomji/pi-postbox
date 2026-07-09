# Unit 03 — Postbox protocol client and state stream

## Goal
Implement the native client layer for Postbox dashboard APIs.

## Scope
- Kotlin DTOs for the state, session, ask, health, answer, and cancel payloads used by the app.
- JSON parsing that ignores unknown fields.
- HTTP client for `GET /healthz`, `GET /api/state`, answer, and cancel.
- SSE client for `GET /api/state/events` with reconnect/backoff and fallback to manual refresh.
- Repository/state holder that exposes connection status, sessions, and questions to Compose UI.

## Test scenarios
- Parses representative `StateSnapshot` JSON from `packages/protocol` fixtures or captured examples.
- Ignores unknown fields without failing.
- Sends answer payload with selected values and optional note/rationale.
- Sends cancel payload with optional note/rationale.
- Converts HTTP `409` into an already-resolved UI state.
- SSE initial event updates state; malformed events are logged/recovered without crashing.
- Network failure transitions to disconnected/retry state.

## Notes
OkHttp `okhttp-sse` is acceptable for first pass but should be wrapped behind an app-owned interface because the API is documented as experimental.
