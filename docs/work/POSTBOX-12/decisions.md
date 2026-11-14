# POSTBOX-12 / D21 pilot — grilling decisions

Session date: 2026-11-14 UTC. Requested by Daniel on 2026-11-06. Base: `f0828fe` (`0.5.10`). Shaping branch: `spec/POSTBOX-12`. Related pilot: POSTBOX-11 / D29.

## Status

Paused before substantive feature grilling: the authorized production Postbox endpoint returned HTTP 502. Neither pilot has scope approval, a review-mode selection, or permission to implement. Both remain Backlog without `ready-for-agent`.

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
