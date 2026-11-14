# POSTBOX-12 / D21 pilot — grilling decisions

Session date: 2026-11-14 UTC. Requested by Daniel on 2026-11-06. Base: `f0828fe` (`0.5.10`). Shaping branch: `spec/POSTBOX-12`. Related pilot: POSTBOX-11 / D29.

## Status

Resumed 2026-11-14 after production was restored (POSTBOX-15). D21 round 1 has seven accepted Questions on production 32187; waiting for Answers. Neither pilot has scope approval, a review-mode selection, or permission to implement. Both remain Backlog without `ready-for-agent`.

## Sources read

- Kitchen `skills/grill/SKILL.md`, installed `to-spec` and `pi-development`.
- Kitchen `research/20-synthesis-and-decisions.md` D21/D29 and subsequent policy updates; `research/21-artifact-strategy.md`; `research/28-skills-and-migration.md`; `research/30-build-order.html` Phase 4; `research/32-migration-dry-run-pi-postbox.md` Phase 4.
- Repository AGENTS.md, GLOSSARY.md, all existing ADRs and agent guides, `docs/question-images.md`, relevant `docs/protocol.md` sections and implementation schemas/Answer auto-wake code.

## Round 0: pilot order

Question ID/request ID: `pilot-grill-20261114-order`. Created using `write_question(action=create_batch)` on the checkout development profile, **not** Daniel's configured production endpoint. Revision 1 / owner revision 1. Answer ID: `6af02fa1-8728-41e1-aba7-65b6d03f1447`.

Question (verbatim):

> Which Postbox pilot should we grill first? Recommendation: D21 remote media first; D29 batching already exists, and this session itself can expose its remaining gaps.

Selected option (verbatim):

> D21 remote media first

Option description (verbatim):

> Settle URL evidence in Questions and Answers, then batch/Answer collection gaps.

`get_answer` response (verbatim; no free-text note was returned):

```json
{"questionId":"pilot-grill-20261114-order","answerId":"6af02fa1-8728-41e1-aba7-65b6d03f1447","answer":["d21-first"]}
```

Interpretation, separate from the Answer: grill POSTBOX-12 before POSTBOX-11. This is ordering only, not feature approval.

## Endpoint correction

Daniel (verbatim):

> why 44967? i thought we had a stable port for postbox? my app is currently configured for 32187

Daniel (verbatim):

> dude

The session incorrectly treated checkout-local autostart on 44967 as sufficient for Daniel's real app, configured for production 32187. The documented development launcher port is 45795. Do not ask Daniel to reconfigure his app to compensate for this routing error.

The kitchen orchestrator's authorization (verbatim):

> Yes. This answer comes from the kitchen orchestrator, under Daniel's request "send a pi subagent to do a grill-with-docs session using pi-postbox with me". That means his real Postbox, the one he answers on.
>
> Use the existing production Postbox on 32187 for this session's grilling questions, within these limits:
> - Only create your own Questions or batches, and read their answers.
> - Don't change, resolve or delete any other Questions.
> - Don't change app or server configuration.
> - Don't restart or stop the production server.
> - Don't touch its database directly.
>
> If a write fails or the server looks unhealthy, stop and report it. Don't repair it.
>
> Continue the session: first round via `create_batch`. Daniel is waiting on Postbox.

A local `ask_user` transport attempt could not run because this is not an interactive TUI. It collected no decision; authorization above came through chat.

## Observations and stopping point

- `pi list --approve` confirms the filtered distributed package plus this local checkout; `--no-approve` shows the globally installed package. Native `write_question` is registered.
- Initial local autostart failed because the better-sqlite3 native binding was missing after npm 12 install. Ran the documented `npm run install --prefix node_modules/better-sqlite3`; no source/config changes were required. First batch attempt hit the unavailable-result normalization error (`Cannot read properties of undefined (reading 'map')`); a subsequent attempt explicitly reported no persistence. Retried the same per-item request ID and obtained one accepted receipt after connection recovered.
- Checkout autostart started PID 1246024 at 17:23:38 UTC, after CLI build 17:20:22 and web build 17:20:32. Health/build identity matched compiled runtime: `0.5.10+sha256.986fd486d02fefa1`, protocol `0.1.12`, profile `development:79522f2660390417`, instance `a4248449-2947-4407-b881-041abfecb618`. This proves only local setup, not production readiness or pilot acceptance.
- Production health check at `https://coolify.tailf5ea68.ts.net:32187/healthz` returned **HTTP 502**. Loopback `127.0.0.1:32187` refused connections. An initial direct Tailnet-IP HTTP request returned HTTP 400. No production Question write was attempted after these checks; no production repair, restart, configuration edit, direct database access, or other-owner Question mutation was performed.
- Leave the pre-existing idle Pi process alone. No product implementation was done.
- Version metadata advances to `0.5.11-spec.postbox12.1` solely to satisfy the repository rule for this shaping-note commit. The observed development process above ran base `0.5.10`; do not claim it verifies this notes-only commit.

## Remaining frontier (not decisions)

D21: URL references versus copied media; image/video format support; Questions versus human Answer evidence entry; web/Android scope; loading/privacy/redirect/network boundary; size limits; external expiry/history behavior; metadata, ordering, retries and unchanged local-image behavior. Existing kitchen requirements already say any source, media files rather than HTML pages, R2 evidence deletion after 30 days, and no feature implementation before sign-off. Do not apply R2 expiry to existing retained local product galleries.

D29: evidence-based gaps in existing create_batch; incremental Answer collection versus waiting for a whole round; cancellation/revision/dependency handling; recommendations in existing text versus a new field; installed Claude/Codex owner-thread wake versus explicit D9 blocker/fallback. Existing requirements already say whole-frontier batches, per-question recommendation, no arbitrary fixed cap, no polling, answer-independent progress, and no implementation before sign-off.

## Next steps

1. Orchestrator restores/establishes healthy production Postbox separately; this session has no repair authority.
2. Route this session explicitly to the existing production 32187 endpoint **without** editing app/server configuration; native tools currently remain pinned to development and must not silently be reused there. If a compatible session-only route cannot be established, report that blocker rather than impersonating a working production connection.
3. Send the complete independent D21 frontier using `create_batch`, stable per-item request IDs, options/trade-offs/recommendations; inspect every receipt. Continue only answer-independent work, then wait once when only Answers block progress.
4. Record Answers verbatim here; add durable glossary/ADR/non-goal docs only as choices settle, commit/push with fresh synchronized versions, and notify Telegram of durable changes.
5. Finish POSTBOX-12 through to-spec, then POSTBOX-11 on its own spec branch. Canonical specs belong in Plane descriptions. Only explicit scope plus evidence/try-it sign-off permits Todo + ready-for-agent. Delete temporary docs/work before squash merge.

## Resume: production routing and D21 round 1

Production health verified at 18:04:55 UTC: version `0.5.7`, protocol `0.1.12`, build `0.5.7+sha256.76a89f03468390e0`, profile `production`, instance `8d970f87-182c-48b7-b060-39e019f7e647`. Installed production and checkout files `tools/writeQuestion.ts`, protocol `ask.js` and `ws.js` are byte-identical.

Native Pi tools remain development-pinned and were **not** used for this round. A session-only operational client uses the existing first-party `PostboxClient`, `toAskPostboxInput`, `executeAskPostbox` and `normalizeWriteQuestionResult` against the explicit production endpoint. No application/server configuration edits. Its private operational files are outside the worktree at `/tmp/postbox-grill-20261114/`; owner/session ID is `pi-postbox-design-grill-20261114-production`. Answer waiting uses that client's event-driven `waitForPostbox`, not polling. This is not a claim that native Pi auto-wake has been rerouted.

All seven Questions below received created/pending receipts, revision 1 and owner revision 1, on production. The first question acknowledges the earlier 44967 mistake. The checkout development server PID 1246024 received SIGTERM after production receipts; it did not finish shutdown, so the same verified development PID received SIGKILL. Its database remains untouched. Production PID 1625345 and the idle Pi process were not signalled.

### postbox12-20261114-r1-lifetime

**Question (verbatim):**

> D21 round 1 — should remote media stay external, or be copied into Postbox? Recommendation: keep URL references; do not silently retain evidence after its source deletes it. The earlier Questions on 44967 were a routing mistake. This batch goes to your real production Postbox on 32187.

**Ambiguity (verbatim):**

> The kitchen evidence service deletes R2 objects after 30 days; other sources can expire sooner. Existing local-image galleries retain sanitized copies across Question revisions. References avoid large uploads/storage and respect source expiry, but old evidence can disappear or change. Copies make historical proof stable but create a second retention/storage policy. Any media source is already required; no R2-only allowlist.

**Options (verbatim):**

- `references`: **Keep remote URL references** — No durable server copy. History keeps the URL and description; media availability/content remains external.
- `copy`: **Import durable media copies** — Fetch, validate and retain an immutable copy; requires a separate explicit retention, size and network-security policy.
- `explicit-import`: **References plus optional import** — Let the sender choose per item; more controls and two lifecycles to build and explain.

**Answer:** pending.

### postbox12-20261114-r1-formats

**Question (verbatim):**

> Which media types must the first pilot display inline? Recommendation: JPEG/PNG/static WebP images plus MP4 video; add more formats only with a demonstrated use case.

**Ambiguity (verbatim):**

> Any source does not guarantee every codec works on web and Android. Current attachments support only JPEG/PNG/static WebP. Video is new; HTML pages, YouTube pages, logs and arbitrary downloads are not media files. MP4 still needs a supported codec, not merely an .mp4 suffix.

**Options (verbatim):**

- `images-mp4`: **Existing image types + MP4 video** — Target JPEG/PNG/static WebP and MP4 with H.264/AAC; bounded, testable cross-client baseline.
- `images-mp4-webm`: **Also include WebM video** — More useful for browser recordings, with additional codec/device compatibility work.
- `native-media`: **Any client-supported image/video** — Use native decoding capabilities and explain unsupported cases; more variability between devices.

**Answer:** pending.

### postbox12-20261114-r1-answer-authoring

**Question (verbatim):**

> How should humans attach remote evidence to an Answer? Recommendation: paste one or more media URLs in a dedicated Answer evidence area, with descriptions; submit them together with the normal option selection and note.

**Ambiguity (verbatim):**

> Today only agent-authored Questions have local-image attachments. Answers contain selected options and an optional note. Your requested pilot includes evidence in both Questions and Answers. Binary file uploads and a full media library are separate scope.

**Options (verbatim):**

- `paste-urls`: **Dedicated URL evidence on Answers** — Paste/reorder/remove URL entries with descriptions before submitting the Answer; no file uploads.
- `note-links`: **Recognize media links in the note** — No dedicated attachment editor, but prose parsing and descriptions/order are less explicit.
- `urls-and-uploads`: **URLs and human file uploads** — Broader authoring flow, requiring upload/storage/draft behavior as well as remote media.

**Answer:** pending.

### postbox12-20261114-r1-clients

**Question (verbatim):**

> Must web and Android both support the D21 pilot at handoff? Recommendation: yes—view Question media and author/view Answer evidence on both, since your real decision workflow uses the app.

**Ambiguity (verbatim):**

> The web gallery and native Android gallery are separate implementations. Android History is already tracked separately in POSTBOX-2; this pilot need not implement that missing destination. A web-only feature would leave the app without the requested evidence workflow.

**Options (verbatim):**

- `both`: **Web + Android together** — Equivalent core media/Answer journeys, while preserving separately tracked History limits.
- `web-first`: **Web pilot first; Android later** — Smaller first delivery, but the app shows remote evidence only as safe external links until follow-up.

**Answer:** pending.

### postbox12-20261114-r1-loading

**Question (verbatim):**

> When should external media contact its source? Recommendation: only after you tap Load; videos never autoplay. This avoids silently sending your device's IP and a signed evidence URL to third parties just by opening a Question.

**Ambiguity (verbatim):**

> Any-source URLs may be hosted by third parties, may be large, and may contain access tokens in their query strings. A description and Answer controls should remain available without loading media. This is the user-visible consent/loading behavior; the fetch/proxy mechanism will follow the lifetime decision.

**Options (verbatim):**

- `tap-to-load`: **Tap to load each remote item** — No automatic remote request when a Question opens; video playback requires a separate play action.
- `auto-images`: **Auto-load images; tap videos** — Faster screenshot review, but opening the Question makes remote image requests automatically.
- `auto-previews`: **Auto-load images and video previews** — Most immediate browsing, with the highest background data use and third-party contact.

**Answer:** pending.

### postbox12-20261114-r1-capacity

**Question (verbatim):**

> How many media items may one Question or Answer contain? Recommendation: eight total items per gallery, preserving the current Question limit and avoiding an extra allowance for each source type.

**Ambiguity (verbatim):**

> Questions currently allow eight local images in an ordered gallery. Remote images/videos and Answer evidence need a clear capacity policy. Item count does not replace byte/pixel/runtime loading safeguards.

**Options (verbatim):**

- `eight-total`: **Eight total per Question or Answer** — Questions may mix existing local images and remote media within eight slots; Answers get eight remote slots.
- `sixteen-total`: **Sixteen total per Question or Answer** — More comparison evidence, but a larger editing and viewing surface.
- `no-count-cap`: **No fixed item-count cap** — Keep galleries navigable with lazy loading; requires separate payload and usability bounds.

**Answer:** pending.

### postbox12-20261114-r1-agent-access

**Question (verbatim):**

> What should the originating agent receive from media attached to an Answer? Recommendation: URL, media description/caption and ordinary Answer text only; no automatic download, vision/video analysis or extra model turn.

**Ambiguity (verbatim):**

> Showing evidence to Daniel and teaching an agent to inspect human-supplied media are different features. Automatic fetching/analysis expands network, context and potentially spend. Question Chat is currently a fresh private, read-only helper and must not resolve Questions on the human's behalf.

**Options (verbatim):**

- `references-only`: **Return evidence references and text** — The agent can reason about the Answer and use separately authorized tools if later needed; Postbox performs no automatic analysis.
- `explicit-inspection`: **Add explicit agent media inspection** — Include an opt-in inspection tool in this pilot, with separate size, trust and model-cost controls.
- `automatic-analysis`: **Automatically analyze attached evidence** — Widest scope: media handling becomes part of agent/model context and requires explicit spend and safety design.

**Answer:** pending.

## Waiting boundary

After answer-independent code inspection and saving round 1, called the production client's event-driven `waitForPostbox` once through the session-only transport. The containing command reached its one-hour execution timeout without returning an Answer event to the agent. No Answer/status polling or repeated wait was performed, and no production Answers were read. All seven scope decisions remain unresolved from this agent's perspective; a command timeout is not cancellation, rejection or approval.

The helper can retain notifications, but it cannot inject native Pi auto-wake into this existing development-bound session. For a fully native continuation, the orchestrator should relaunch **this design Pi session**, not the production server, with session-only `PI_POSTBOX_URL=https://coolify.tailf5ea68.ts.net:32187` and `PI_POSTBOX_AUTOSTART=off`, or load the installed production extension outside checkout-local shadowing. Do not edit production configuration. Existing production round-1 Questions belong to the operational owner `pi-postbox-design-grill-20261114-production`; keep using that client for their notified Answer reads rather than creating duplicates or taking over other owners. Its private transport files are at `/tmp/postbox-grill-20261114/`. The client accepts only create_batch, notified own get_answer, explicit wait and its own identity; it has no mutation/repair/admin interface.
