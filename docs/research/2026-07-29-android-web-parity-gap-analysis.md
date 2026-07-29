# Android/Web parity gap analysis

Date: 2026-07-29

## Purpose

Compare the current native Android app with the current Postbox web dashboard and identify the work required to bring Android to the same user-visible product level while preserving native platform differences.

## Baseline inspected

- Web UI and API client under `apps/web/src`
- Native Android app under `apps/android`
- Shared protocol schemas under `packages/protocol/src`
- Server HTTP/SSE routes under `packages/server/src`
- Android plan under `docs/plans/2026-06-24-postbox-native-android`
- Question Chat spec under `docs/prd/postbox-question-chat.md`
- Git history through `07e2c10`

The Android app's last major workflow update preceded the urgency, rich-option, and Question Chat work. Its most recent Android change (`b27902b`) only improved notification-open state loading. The original Android plan explicitly deferred full history/admin parity, so some gaps predate Question Chat rather than being regressions.

## What is already equivalent or has a native equivalent

- Explicit server URL onboarding and `/healthz` verification.
- Live state via `/api/state` and `/api/state/events` with reconnect behavior.
- Project/session/question navigation and recent-offline filtering.
- Pending single- and multi-choice answering.
- Optional note, synthetic `other`, cancellation, queue dismissal, and first-terminal-conflict handling.
- Rich handoff context inspection at a basic level.
- Cross-device question resolution and notification-target validation.
- Native Android notifications and FCM as the platform equivalent of PWA/Web Push.
- Postal visual language, loading/empty/error states, and minimum navigation touch targets.

Browser installation controls, service-worker behavior, desktop sidebars/keyboard shortcuts, and development mock controls are platform-specific and should not be copied to Android.

## User-visible parity gaps

### P0 — Question Chat is absent

Android has no client or UI for the server's Question Chat endpoints:

- exact-fork activation;
- explicit context-only fallback and confirmation;
- snapshot discovery/recovery;
- question-scoped Chat SSE events;
- freeform messages and Elaborate / Pro–Cons / Teach me starters;
- turn-versus-steer acknowledgements;
- Stop and retained stopped/interrupted output;
- offline/stale/retry states;
- model/fallback disclosure;
- repository tool activity;
- Chat-suggested answer option actions;
- mobile Question / Question Chat tabs after activation.

This is the largest functional difference and the main reason Android is behind the current web product.

### P0 — Android protocol DTOs lag the authoritative ask contract

Android currently ignores fields added to shared protocol schemas:

- `AskRequestSnapshot.urgency`;
- `AskOption.provenance`;
- distinct `description`, `meaning`, and option `context` presentation (Android collapses them into one fallback string);
- answer/cancel `rationale` and result rationale (relevant mainly to History display).

Unknown-field tolerance prevents crashes, but the data is not represented to users.

### P1 — Pending order differs

The web queue uses urgency first and age second. Android preserves server snapshot order / oldest-oriented presentation and does not expose urgency. High-urgency decisions can therefore appear behind normal or low-urgency decisions.

This must be corrected in the all-questions queue, project/session subsets, sidebar question lists, initial selection, and post-resolution routing.

### P1 — Rich and Chat-suggested options render incompletely

The web shows description, meaning, and context separately and marks server-authoritative Chat proposals with **Suggested in Chat**. Android currently displays at most one of description/meaning/context and has no provenance badge. After Chat proposes an option, Android can receive and select its value, but cannot explain its origin or full semantics.

### P1 — Decision History is absent

The web exposes `/api/history` and renders answered, cancelled, and expired Postbox Questions with:

- answer labels;
- note and rationale;
- created/resolved timestamps;
- project/machine/session/worktree metadata;
- retained rich context and proposed-option provenance;
- no Question Chat transcript.

Android has no History destination, protocol DTOs, loading/error/empty state, or history cards. The original native plan explicitly deferred this, but strict current web parity includes it.

### P1 — Session metadata and renaming are incomplete

The web session detail supports:

- inline machine rename;
- inline project rename;
- detected project, repo, head, CWD, git root, worktree, description, and last heartbeat;
- project icons.

Android's DTO already carries most of these fields, but its UI state discards many of them, renders only machine/project/branch/state/presence, does not render project icons, and does not call rename endpoints. The original plan labeled rename as optional-later; strict parity includes it.

### P1 — Post-resolution routing differs

Web behavior routes a locally resolved question to that project's queue when the project still has open questions, otherwise to the main queue. Android currently prefers the first pending question globally after answer/dismiss of the visible question. This can pull the user into an unrelated project's decision rather than preserving the current project workflow.

### P2 — Queue presentation differs

The web all-questions queue groups decisions by project, shows project icons, and describes urgency/age ordering. Android's queue is a flat list (while its sidebar is grouped). Strict information-hierarchy parity suggests grouped project sections in the all-questions queue, while retaining native Compose interaction patterns.

### P2 — Rich-context rendering is less expressive

Android shows additional context as labeled plain text. It does not preserve specialized visual handling for code, diagrams, or links and does not render Chat assistant Markdown. Functionality remains readable, but parity requires bounded native rendering appropriate to each context kind and safe assistant Markdown (at least headings/lists/emphasis/code/links without raw HTML or remote images).

### P2 — Refresh/resume behavior is less explicit

The web marks state as syncing and immediately refetches after the page returns from the background if data may be stale. Android stops the stream on `ON_STOP` and restarts it on `ON_START`; the first restarted SSE snapshot is authoritative, but there is no separate explicit stale-age check or immediate HTTP refresh fallback. Existing behavior is mostly equivalent, but tests should prove no false “all caught up” state after resume.

## Server gaps

No new server feature is required for core parity. The current server already exposes the necessary History, rename, Question Chat, proposal, state, and notification endpoints.

Server changes should be limited to compatibility fixes discovered by real Android requests. Android should consume the existing finite shared contracts rather than add parallel mobile-only endpoints.

## Recommended scope definition

“Same level as the web version” should mean **user-visible functional parity**, not literal component parity:

Include:

1. Current ask contract, urgency ordering, rich/proposed options.
2. Full mobile Question Chat workflow and lifecycle.
3. Decision History.
4. Session metadata, project icons, machine/project rename.
5. Web-consistent post-resolution routing and grouped queue hierarchy.
6. Native accessibility, lifecycle, offline handling, tests, docs, and APK validation.

Do not copy:

- PWA installation and service-worker controls;
- browser Web Push subscription UI (FCM is the native equivalent);
- desktop-only resizable/collapsible layout and keyboard shortcuts;
- browser-local development mock toggle;
- server shutdown/operator-only controls.

## Recommended implementation slices

1. **Contract and queue parity** — expand Android DTOs, urgency/rich/provenance rendering, deterministic sorting, grouped queue, and project-local post-resolution routing.
2. **Question Chat activation and first turn** — HTTP contract, exact/context activation, snapshot, starters/freeform send, question/chat tabs, first streamed response.
3. **Question Chat lifecycle hardening** — recovery, sequence/gap resync, offline/retry, steer, Stop, interrupted output, model disclosure, tool activity, proposal action.
4. **History parity** — history contract and native audit view.
5. **Session presentation parity** — full metadata, project icons, machine/project rename.
6. **Product validation and docs** — Android lifecycle/accessibility tests, full Gradle checks, APK assembly/lint, root regression gates, real-device smoke when `adb` is available, and README update.

## Preferred test seams

Use the highest stable seams already present:

- **Protocol seam:** MockWebServer against the real Android HTTP/SSE clients for endpoint paths, finite JSON decoding, typed availability errors, and event streams.
- **State seam:** JVM tests of app-owned workflow/lifecycle reducers or view models with fake clients/streams for ordering, navigation, Chat sequencing/recovery, terminal races, and preservation of user drafts/selections.
- **Presentation seam:** focused Compose UI tests for Question/Chat tabs, activation fallback confirmation, accessibility semantics, History, metadata rename, and proposal navigation. If instrumentation is unavailable locally, keep pure state tests authoritative and record the device-test gap.
- **End-to-end seam:** existing running Fastify server plus Android HTTP clients where practical; avoid duplicating server behavior in Android-only mocks for the final contract check.
- **Release seam:** `./gradlew test assembleDebug lintDebug`, root `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke`, and package-safety checks.

## Validation performed during analysis

- Repository was clean on `main` before this report.
- `cd apps/android && ./gradlew test --console=plain` passed (51 tasks, all successful/up-to-date).
- GitHub CLI is authenticated; the repository uses GitHub Issues and has the `ready-for-agent` label required by `/to-spec` and `/to-tickets`.

## Risks

- Question Chat is a substantial native state-streaming feature; coupling it directly into the already-large question screen/view model would make failures hard to isolate. Use an app-owned Chat client plus reducer/view model with explicit lifecycle boundaries.
- Android SSE and Activity lifecycle transitions can create duplicate streams or stale updates if ownership is unclear. One question-scoped owner must close on selection/server changes and ignore stale request IDs/sequences.
- Chat transcript data is intentionally private and temporary. Android must not persist it to SharedPreferences, saved-state bundles, logs, analytics, notification payloads, or disk caches.
- Rich Markdown/tool output must remain bounded and must not enable raw HTML, remote images, or unsafe URI schemes.
- FCM configuration is developer-local; builds without `google-services.json` must continue to compile and use in-app notifications.
- A real-device smoke remains necessary for confidence in tabs, scrolling, IME behavior, deep links, and notification-to-question navigation.

## Published plan

Strict user-visible functional parity and the proposed test seams were approved through Pi Postbox.

- Parent spec: [#47 — Bring native Android dashboard to functional parity with web](https://github.com/dasomji/pi-postbox/issues/47)
- [#48 — Surface and prioritize authoritative question options](https://github.com/dasomji/pi-postbox/issues/48)
- [#49 — Keep project queues coherent and authoritative](https://github.com/dasomji/pi-postbox/issues/49)
- [#50 — Activate Question Chat safely](https://github.com/dasomji/pi-postbox/issues/50)
- [#51 — Complete the first Question Chat turn](https://github.com/dasomji/pi-postbox/issues/51)
- [#52 — Steer and stop active Question Chat turns](https://github.com/dasomji/pi-postbox/issues/52)
- [#53 — Recover Question Chat across disconnects and lifecycle](https://github.com/dasomji/pi-postbox/issues/53)
- [#54 — Apply Question Chat-suggested answer options](https://github.com/dasomji/pi-postbox/issues/54)
- [#55 — Add native Decision History](https://github.com/dasomji/pi-postbox/issues/55)
- [#56 — Complete session identity and metadata management](https://github.com/dasomji/pi-postbox/issues/56)
- [#57 — Validate and document functional parity](https://github.com/dasomji/pi-postbox/issues/57)

The initial implementation frontier is #48, #50, #55, and #56. Work should proceed one ticket at a time; #48 is the recommended first slice because it establishes the complete ask/option semantics reused by queue coherence and Chat proposals.
