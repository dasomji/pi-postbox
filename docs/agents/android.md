# Android gotchas

Start with the [install guide](../../apps/android/README.md) and
[verification contract](verify.md). The app is independent of npm release identity:
read `versionName`/`versionCode` in `app/build.gradle.kts` and the protocol package
before reporting compatibility. Currently those are Android **0.5.4 (16)** and
protocol **0.1.12**. A root npm patch does not automatically bump the APK.

## Generated boundary and temporary Chat state

Treat `packages/protocol` schemas/fixtures as the wire source of truth. Run the
root generator/check; never hand-edit the generated Android contract. The app
checks health before state/actions/Chat/push/media and refuses incompatible endpoints.
An emulator uses `10.0.2.2` for the host; a real device needs its reachable Tailnet
HTTPS URL. Loopback health is not proof of phone reachability.

`questionchat/QuestionChatHttpClient.kt` and `QuestionChatEventTransport.kt` own
cancellable bounded I/O. `QuestionChatOwner.kt` alone owns selected-question
bootstrap, snapshot/event sequencing, reconnect and stale-generation rejection.
Open/buffer SSE before fetching the authoritative snapshot; reconnect must take a
new snapshot before applying events. Keep this separate from the dashboard state
stream. Backgrounding cancels work; resume reconstructs it from the live runtime.

Chat transcript, composer, tools and rendered Markdown are in-memory state. They
must not enter SavedState, preferences, diagnostics or the encrypted Question
answer-draft store. `question/AndroidKeystoreQuestionDraftStore.kt` persists only
human answer drafts, excludes backups and degrades to in-memory editing on secure
store failure. These are different privacy contracts.

## Markdown and IME

`SafeMarkdown.kt` converts CommonMark into an app-owned finite model; Compose
renders it with inert HTML, image alt text and allowlisted HTTP(S) links. Keep
source/node/nesting/code limits, plain-text fallback and conflated off-main parsing.
Do not add WebView or network image loading to Question Chat Markdown; Question
image galleries have their own bounded loader/viewer.

`QuestionChatUi.kt` bounds the transcript with a weighted `LazyColumn` and gives
the bottom composer one IME inset ownership path. Duplicating outer `imePadding`
can double-consume space and push the composer out of view. Keep Send/Steer/Stop
in the same accessible action slot, 48dp starter hit targets and explicit partial
Stopped/Interrupted labels. The note editor has its own keyboard/scroll behavior;
check both entry surfaces when changing insets.

The committed `QuestionChatImeGeometryTest` uses a bounded real-keyboard probe and
may skip on a headless emulator that never exposes the IME. A passing suite with
that skip is not keyboard-visible evidence. `QuestionChatEvidenceCaptureTest`
requires an explicit evidence prefix; its default skip is intentional. Preserve
these limits when reporting proof; no fabricated keyboard screenshot.

## Remaining device proof

Historical emulator/gallery tests and an ADR-recorded user confirmation do not
prove this checkout's full release journey. Physical-device TalkBack, maximum-image
memory use, rotation/Back/gestures, IME, notification permission/tray/tap routing and
FCM delivery need explicit coverage with the exact tested build. Record any missing
hardware/configuration as a coverage limit. Do not claim native History or rename
parity until those destinations/operations exist. Plane follow-ups track the remaining
work: **POSTBOX-2** covers native History and session metadata parity;
**POSTBOX-3** covers cross-client and physical-device release evidence.
**POSTBOX-5** tracks the web UI showing Connected/"Question resolved" during a server
outage, found by L3 and predating this PR. **POSTBOX-4** tracks GitHub backlog
reconciliation so earlier requests retain an explicit disposition.
