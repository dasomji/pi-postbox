# Bounded native Markdown for Android Question Chat

**Research ticket:** [Research bounded native Markdown for streamed Question Chat](https://github.com/dasomji/pi-postbox/issues/60)

**Date:** 2026-07-29

## Question

Which current native Android/Compose approach should render progressively streamed Question Chat assistant content as a bounded safe subset of Markdown?

## Recommendation

Use **`org.commonmark:commonmark:0.29.0` only as the parser**, then convert its AST into a small app-owned `SafeMarkdownDocument` and render that model with ordinary Compose primitives. Do not render HTML, use a WebView, load images, or delegate URL opening to a Markdown library.

This is more implementation than dropping in a broad renderer, but it makes all security- and product-relevant behavior explicit and testable:

- exact supported block and inline types;
- finite input, nesting, AST, line, and code-block limits;
- `http`/`https` link allowlisting before a `LinkAnnotation` exists;
- image alt text without an image request;
- inert raw HTML and unknown-syntax fallback;
- Compose heading/list/code semantics;
- deterministic plain-text fallback;
- conflated off-main parsing for streamed replacements and reconnect snapshots.

CommonMark Java 0.29.0 was released on 2026-06-20. Its core has no runtime dependencies, supports Java 11+, is Android-tested on a best-effort basis down to API 19, exposes an AST, and allows both a restricted block set and a `maxOpenBlockParsers` nesting limit ([project README](https://github.com/commonmark/commonmark-java/blob/commonmark-parent-0.29.0/README.md), [`Parser.java`](https://github.com/commonmark/commonmark-java/blob/commonmark-parent-0.29.0/commonmark/src/main/java/org/commonmark/parser/Parser.java), [0.29.0 release](https://github.com/commonmark/commonmark-java/releases/tag/commonmark-parent-0.29.0), [Maven POM](https://repo1.maven.org/maven2/org/commonmark/commonmark/0.29.0/commonmark-0.29.0.pom)). The app's API 26 / JVM 17 target is within that envelope.

## Repository constraints

- The shared protocol caps one assistant message at **32,000 UTF-16 characters**, one delta at 4,000, and a snapshot at 100 messages (`packages/protocol/src/chat.ts`). Android must preserve those limits before rendering.
- The web oracle currently supports headings, lists, emphasis, block quotes, links, and code; makes raw HTML inert; turns images into alt text; allows only `http`, `https`, root-relative, and fragment links; and caps tall code presentation (`apps/web/src/lib/questionChat.ts`, `apps/web/src/components/QuestionChatActivation.test.ts`). Native Android need not reproduce its HTML implementation, but it must preserve the same safety outcomes.
- Android currently uses Kotlin `2.1.21`, Compose BOM `2025.05.01`, coroutines `1.10.2`, minSdk 26, and JVM 17 (`apps/android/build.gradle.kts`, `apps/android/app/build.gradle.kts`). It has no Markdown dependency.
- Question Chat state is temporary. Parser input, parsed documents, and rendering state must remain in ordinary memory and must not enter saved state, preferences, files, caches, logs, analytics, notifications, or crash breadcrumbs.

## Options considered

### 1. `multiplatform-markdown-renderer` 0.43.0

This is the strongest broad Compose renderer considered. It is actively maintained, has native Compose components, marks headings with Compose semantics, supports custom components/annotators, parses asynchronously, and added an append-only `StreamingMarkdownState` in 0.42.0 ([README](https://github.com/mikepenz/multiplatform-markdown-renderer/blob/v0.43.0/README.md), [`StreamingMarkdownState.kt`](https://github.com/mikepenz/multiplatform-markdown-renderer/blob/v0.43.0/multiplatform-markdown-renderer/src/commonMain/kotlin/com/mikepenz/markdown/model/StreamingMarkdownState.kt), [`MarkdownHeader.kt`](https://github.com/mikepenz/multiplatform-markdown-renderer/blob/v0.43.0/multiplatform-markdown-renderer/src/commonMain/kotlin/com/mikepenz/markdown/compose/elements/MarkdownHeader.kt)).

It is **not selected now**:

- its Android artifact declares Kotlin stdlib `2.4.0`, coroutines `1.11.0`, and collections-immutable `0.5.0`, ahead of this app's Kotlin 2.1.21/coroutines 1.10.2 toolchain ([0.43.0 POM](https://repo1.maven.org/maven2/com/mikepenz/multiplatform-markdown-renderer-android/0.43.0/multiplatform-markdown-renderer-android-0.43.0.pom));
- its default link listener passes any parsed destination to `LocalUriHandler.openUri` without a scheme allowlist and prints the failed destination on error ([`AnnotatorSettings.kt`](https://github.com/mikepenz/multiplatform-markdown-renderer/blob/v0.43.0/multiplatform-markdown-renderer/src/commonMain/kotlin/com/mikepenz/markdown/annotator/AnnotatorSettings.kt));
- its parser/state has no caller-facing source, nesting, node, or code limit; `StreamingMarkdownState` owns an uncapped append-only `StringBuilder`;
- its broad default surface includes images, tables, checkboxes, autolinks, and optional network image/highlighting integrations that Question Chat must exclude;
- append-only state is awkward when an authoritative snapshot replaces partial text after a reconnect.

A hardened adapter would still need to own URL filtering, image/HTML substitution, AST limits, fallback, replacement handling, and privacy. Updating the Android toolchain solely to adopt this renderer is not justified. Re-evaluate it only after the app independently moves to a compatible Kotlin toolchain and the adapter can prove all limits.

### 2. `compose-markdown` 0.7.2 / Markwon

`compose-markdown` was updated in April 2026, but it wraps a `TextView` renderer, is distributed through JitPack, pins Compose 1.6.6 and Markwon 4.6.2, and advertises HTML, remote images/GIFs, tables, and automatic URL/email/phone linkification ([README](https://github.com/jeziellago/compose-markdown/tree/0.7.2), [library Gradle file](https://github.com/jeziellago/compose-markdown/blob/0.7.2/markdowntext/build.gradle)). Markwon itself last released 4.6.2 in February 2021 and targets native Android `TextView`/`Spannable`, not Compose ([Markwon repository](https://github.com/noties/Markwon), [4.6.2 release](https://github.com/noties/Markwon/releases/tag/v4.6.2)).

**Rejected.** Interop is unnecessary, the defaults are the opposite of the required subset, and the transitive rendering stack is broader and older than the app needs.

### 3. CommonMark Java parser plus app-owned safe model/Compose renderer

**Selected.** The parser is maintained, small, standards-based, and independent of the Kotlin/Compose toolchain. Its current builder can restrict recognized block types and cap simultaneously open block parsers. The app then walks the AST iteratively into a finite domain model and never uses `HtmlRenderer`.

### 4. Fully hand-written Markdown parser

**Rejected.** Markdown delimiter, escape, nested-list, code-fence, and malformed-stream edge cases are deceptively complex. An app-owned *policy/model/renderer* is appropriate; an app-owned Markdown grammar is not.

## Proposed safe subset

The later rendering-contract ticket should settle presentation details, but the parser boundary should expose only these meanings:

### Blocks

- paragraph;
- ATX and setext heading levels 1–6;
- unordered and ordered lists, with bounded nesting;
- block quote;
- fenced and indented code block;
- thematic break.

Configure `Parser.enabledBlockTypes` with only `Heading`, `ListBlock`, `BlockQuote`, `FencedCodeBlock`, `IndentedCodeBlock`, and `ThematicBreak`. Paragraph parsing remains the fallback. Do not add GFM tables, task lists, alerts, footnotes, autolinks, YAML, or other extensions. CommonMark documents `enabledBlockTypes` specifically for restricting recognized block features ([parser builder source](https://github.com/commonmark/commonmark-java/blob/commonmark-parent-0.29.0/commonmark/src/main/java/org/commonmark/parser/Parser.java#L152-L217)).

### Inlines

- plain text and soft/hard line breaks;
- emphasis and strong emphasis;
- inline code;
- explicit inline/reference links only after safe destination validation.

Do not automatically link plain URLs, emails, or phone numbers. An `Image` node becomes bounded visible alt text such as `Image omitted: <alt>`; its destination is discarded. `HtmlInline` is emitted as inert literal text, never interpreted. Unsupported nodes preserve bounded readable text when possible; if conversion cannot do that safely, the whole message uses the plain-text fallback.

## Link policy

Compose's current supported mechanism is `LinkAnnotation.Url` inside an `AnnotatedString`; `ClickableText` is deprecated. Android's examples use a `LinkInteractionListener` and `LocalUriHandler.openUri` ([text interaction guide](https://developer.android.com/develop/ui/compose/text/user-interactions), [multiple-links guide](https://developer.android.com/develop/ui/compose/quick-guides/content/support-multiple-links)).

Before creating a link annotation:

1. parse a bounded destination;
2. require an absolute, hierarchical URI;
3. lowercase and allowlist only `http` or `https`;
4. require a non-empty host;
5. reject control characters, credentials if desired by the later contract, malformed percent escapes, and every other scheme;
6. render a rejected destination's label as ordinary text with no destination annotation.

Revalidate in the click listener before calling `openUri`. Do not log the destination or click. Unlike the browser, native Android should leave root-relative and fragment-only links inert unless a later contract deliberately defines a trusted base-resolution rule.

## Finite-work contract

The protocol's 32,000-character ceiling is necessary but not sufficient. The adapter should define injectable/tested constants, initially:

| Boundary | Initial ceiling | On exceed |
|---|---:|---|
| Source per assistant message | 32,000 UTF-16 chars | protocol/render error; bounded plain text |
| Open block parsers | 32 | parser treats deeper starts as text |
| Converted AST nodes | 4,096 | bounded plain-text fallback |
| Rendered blocks | 512 | bounded plain-text fallback |
| List nesting shown structurally | 8 | flatten deeper content as indented plain text |
| Code block content | 16,000 chars / 400 lines | explicit truncated code presentation |
| Link destination | 2,048 chars | label only |

The exact node/block/code ceilings can be tuned with implementation benchmarks, but they must remain explicit and have boundary ±1 tests. Use `maxOpenBlockParsers(32)`; CommonMark 0.28 introduced this option so excess nesting becomes paragraph text instead of deeper structure ([changelog](https://github.com/commonmark/commonmark-java/blob/main/CHANGELOG.md#0280---2026-03-31)). Walk the AST iteratively with an explicit stack and counters instead of recursively accepting arbitrary depth.

Parsing is synchronous and not cooperatively cancellable. Run one parser lane on `Dispatchers.Default`; use a conflated input channel so one parse finishes before the latest pending replacement begins. Never launch parallel parses for every delta. Keep the last successfully converted document visible while a newer prefix parses.

## Progressive streaming contract

The Chat owner remains authoritative for text. The Markdown adapter receives **bounded whole-message replacements**, not transport delta callbacks, so reconnect snapshots, deduplication, final-text correction, and message replacement all follow the same path.

For a streaming assistant message:

- conflate rapid replacements and parse at a bounded cadence (start around one update per 100 ms; tune with a device benchmark);
- parse/convert off the main thread;
- publish immutable `SafeMarkdownDocument` results on the main-safe state seam;
- retain the previous rich document during parsing to avoid flicker;
- parse the terminal `final`, `stopped`, or `interrupted` text without the streaming delay;
- ignore late parse results unless message ID, content version, server, request ID, and owner generation still match;
- clear source and parsed references when the Chat owner is replaced or disposed.

Incomplete Markdown at the stream tail is normal. CommonMark's parse of the current prefix is the presentation; a later prefix may restyle that tail. Focus and scroll must not be reset just because inline structure changed. Stable message keys come from protocol message IDs, not parsed node identity.

Do not mark the changing assistant body as a Compose live region. Android warns against live regions for frequently changing content because repeated announcements overwhelm users. Announce coarse state transitions separately—such as “Answer complete,” “Stopped,” or “Connection lost”—and let the user navigate the updated body on demand ([Compose semantics guide](https://developer.android.com/develop/ui/compose/accessibility/semantics)).

## Native Compose rendering notes

- Render paragraphs and styled inlines with `Text(AnnotatedString)`.
- Apply `Modifier.semantics { heading() }` to heading blocks so accessibility services can navigate sections; Android explicitly documents heading semantics ([Compose semantics guide](https://developer.android.com/develop/ui/compose/accessibility/semantics#headings)).
- Use native rows/columns for lists and expose coherent list/item semantics; do not concatenate a whole nested list into one inaccessible string.
- Render code as selectable monospace text in a bounded container with horizontal scrolling and an explicit vertical/truncation treatment. Do not add syntax highlighting in this slice.
- Keep links visually identifiable and use `LinkAnnotation`; any separate action such as copy/open must meet Android's recommended 48 dp touch target ([Compose accessibility defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults)).
- Wrap selectable prose/code intentionally; do not make the entire conversation one selection node that erases message and heading structure.

## Failure and privacy behavior

If parsing throws, conversion exceeds a limit, or an unknown node cannot preserve content safely, display the original **already bounded** source as plain text with a non-disruptive “Formatting unavailable” label. Never display an empty bubble for non-empty source. Plain text is the safety fallback, not HTML output.

The parser and renderer perform no network I/O and own no disk cache. Do not add image loaders, WebView, HTML rendering, syntax highlighters, URL preview fetchers, or library logging. Parsed documents are derived transient state: no `rememberSaveable`, `SavedStateHandle`, serialization, cache file, debug dump, analytics, or notification content. An explicit user copy action, if accepted by the later contract, is the only deliberate transfer to the system clipboard.

## Validation matrix for the implementation plan

### Parser/model JVM tests

- every supported block and inline type, mixed/nested forms, escapes, Unicode, incomplete fences/emphasis/links;
- raw inline/block HTML remains inert; scripts and event-handler attributes never become behavior;
- image syntax performs no load and preserves bounded alt text;
- `https`/`http` links accepted; case variants normalized; `javascript`, `data`, `file`, `content`, `intent`, `mailto`, relative, fragment, malformed, control-character, and oversized destinations rendered inert;
- source, depth, node, block, list, code, and URL boundaries at limit ±1;
- adversarial nested lists/quotes/brackets/emphasis and 32,000-character single-line/code inputs;
- parse/conversion failure always returns non-empty bounded plain text;
- stale version/generation results cannot replace newer content.

### Streaming/state tests

- many tiny deltas are conflated and never parsed concurrently;
- incomplete tail becomes valid Markdown without flicker or message-key replacement;
- authoritative snapshot replacement and non-prefix final correction rebuild correctly;
- terminal text bypasses the streaming delay;
- owner disposal releases source and parsed references.

### Compose tests

- headings expose heading semantics; lists retain order and readable item structure;
- safe links expose link behavior and unsafe labels do not;
- code is monospace, bounded, scrollable/selectable as contracted, and truncation is explicit;
- raw HTML/image input creates no WebView/image/network node;
- rich-render failure shows the plain source and “Formatting unavailable”;
- progressive text does not become a chatty live region and does not steal focus.

Before shipping, benchmark ordinary and adversarial 32,000-character messages on the lowest representative device. Record parse latency, allocation, frame timing, and update cadence; tighten cadence/structural limits if parsing can cause visible jank.

## Consequence for the rendering-contract ticket

Issue 63 can now decide typography, spacing, list indentation, code viewport/truncation copy, and exact accessibility announcements without choosing a parser. The non-negotiable seam is:

```text
bounded assistant String
  -> single conflated off-main SafeMarkdownParser
  -> immutable finite SafeMarkdownDocument | PlainTextFallback
  -> app-owned Compose renderer
```

The renderer accepts no HTML and no image loader; it receives only validated safe-link values. This keeps streamed Markdown presentation separate from the Chat transport/state owner while preserving deterministic fallback and strict in-memory privacy.
