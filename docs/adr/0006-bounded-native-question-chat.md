# Bounded native Question Chat

## Status

Accepted; extracted from implemented Android transport/rendering decisions and
Question–Chat workspace acceptance. Source-context policy is
[ADR 0004](0004-fresh-question-chat-settings.md); old exact-fork/fallback mockups
are superseded and do not define current activation.

## Decision and trade-off

Use a dedicated, in-memory Question Chat owner, with cancellable bounded OkHttp
HTTP/SSE adapters and explicit snapshot-first reconciliation. One generation keyed
by server URL and Question rejects stale work. Keep dashboard-state transport and
Chat reconnect/reducer policy separate: sharing a generic stream would obscure
sequencing, selected-question ownership and transcript privacy.

Use CommonMark only as a parser. Convert it into an app-owned finite safe model
and render with Compose: inert HTML, image alt text, HTTP(S)-only links, bounded
source/nodes/nesting/code, deterministic plain-text fallback and conflated off-main
parsing. This requires more local policy code than a broad renderer, but makes
bounds, replacement snapshots and privacy testable without adopting a new toolchain
or network-capable rendering surface.

Keep the app-owned Question/Chat workspace rather than adopting a full chat kit.
A bounded weighted transcript sits above a composer with one IME-inset owner.
Suggested options return to the normal Question surface for human submission;
Stop retains partial output with an explicit terminal label. Platform-native
presentation does not persist Chat state in the encrypted answer-draft store.

## Evidence and alternatives

Implemented in [QuestionChatOwner](../../apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatOwner.kt),
[transport](../../apps/android/app/src/main/java/dev/pi/postbox/questionchat/QuestionChatEventTransport.kt),
[safe Markdown](../../apps/android/app/src/main/java/dev/pi/postbox/questionchat/SafeMarkdown.kt)
and [Compose UI](../../apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt).
Tests cover owner generations, malformed/bounded transport, Markdown fallback and
workspace/IME geometry; device coverage must still be reported separately.

Historical [Markdown research](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/research/2026-07-29-android-question-chat-markdown.md)
rejected broad renderer defaults/toolchain changes, TextView/Markwon interop and
an app-written Markdown grammar. [Transport research](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/research/2026-07-29-android-question-chat-transport.md)
rejected coupling to the dashboard stream and `okhttp-sse` without caller frame
limits. The [polish report](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/IMPLEMENTATION_REPORT.md)
rejected Stream's broader ecosystem/attachment/state model for this narrow app.
These are scoped choices, not permanent bans on revisiting a dependency.
