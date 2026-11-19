# Merge doors

Classify the actual behavior and blast radius. Unknown cases and reviewer judgment
can upgrade a change to one-way. A two-way change is recoverable by reverting the
code without undoing durable data, trust, production exposure or external spend.
An automatic patch publication is a public, irreversible release; recovery is a
newer patch release containing the revert. npm versions cannot be reused.
While every push to `main` publishes, every merge is therefore one-way (merge G2,
public irreversible release), whatever paths it touches. The table classifies
changes for review depth, and for the period after publishing stops being automatic.

| Paths / behavior | Door | Reason and required judgment |
| --- | --- | --- |
| `packages/server/src/db/database.ts`, migration ledger, Question/Answer/revision storage and destructive lifecycle/media pruning | One-way | Startup migrates persistent SQLite; reverting code cannot reconstruct deleted or transformed records. Require isolated migration proof and a verified backup/restore plan. |
| `packages/protocol/src/**`, protocol fixtures, `scripts/generate-android-protocol-contract.mjs`, generated Android contract | One-way when changing the wire/storage contract | Server, extension, web and separately installed Android clients must agree. Review compatibility, upgrade/restart order and generated-contract checks. A generation-only identical-output repair can be two-way. |
| `packages/server/src/app.ts`, `security.ts`, routes/WebSocket authorization, `packages/extension/src/repositoryEvidenceTools.ts` | One-way when changing auth, access or secret boundaries | The service has no app-level authentication; access permits decisions, bounded reads and model spend. Same-origin protection is not authentication. |
| `packages/server/src/tailscaleServe.ts`, deployment/configuration and production profile/environment changes | One-way when changing production exposure/config | Tailnet Serve is best-effort, private and non-clobbering. Changes must preserve opt-out and never enable Funnel or overwrite another mapping. |
| `.github/workflows/publish.yml`, root `package.json` `files`/`bin`/`prepack`/`publishConfig`, or other changes to what publish ships or how it authenticates/triggers | One-way for those publication changes | Review shipped contents, credentials and automatic release triggers. Verification-only changes follow the next row. Every push to main automatically publishes after its gates. Every merge is a public, irreversible release requiring Daniel's per-PR approval (merge G2/G7); recover with a newer patch containing the revert, never by reusing an npm version. Never publish manually during verification. |
| `.github/workflows/ci.yml`, `scripts/check-*.mjs`, `scripts/lint.mjs`, `scripts/test-vitest.mjs`, `scripts/protocol-discipline.mjs`, `scripts/smoke-postbox.mjs`, `scripts/verify-app.mjs`, `.githooks/**`, root `test`/`pretest`/`check:*`/`lint*`/`verify:app` scripts, `.oxlintrc.json`, branch protection or required checks | One-way when removing, skipping or weakening any check run by CI or publish; adding checks is two-way | Reduced coverage, failure detection or enforcement can admit unsafe merges. This includes publish checks such as `npm test`. Review the effective guarantees and fail-closed behavior; renaming or moving a gate does not remove this boundary. |
| `packages/extension/src/questionChatRuntime.ts`, activation/turn/retry behavior, push service integrations | One-way when introducing or expanding spend/external effects | Explicit activation has no automatic model turn. Turns spend model tokens; notification integrations contact external services. Human authorization and scoped test doubles matter. |
| Shared/other people's services, accounts or data | One-way | Anything other people use requires Daniel's per-PR approval. This includes users of the public npm package; the publication row adds the per-merge release rule. |
| `scripts/dev.mjs`, checkout profile and private preview lifecycle | Two-way only while isolated | Revert must restore behavior, `verify:app` must cover it, and state/ports/mappings must belong exclusively to the preview. Touching production/data/auth upgrades it. |
| Web/Android presentation, ordinary read-only tools, maintained docs | Two-way when behavior remains reversible | Run applicable checks; a UI or docs change that changes access, decision submission, deletion, spend or deployment instructions inherits the stricter door. |

The integration owner supplies the final same-commit checks and cross-family door
review. Read effective doors/opt-in from the refreshed default branch at hand-back.
Proposed rules never govern the PR that introduces them.

## Single-user opt-in

single-user: rollback-ok

rollback: Open a revert PR that reverts the merged change's code and docs but bumps root, workspace and lockfile versions to the next patch not used by any repository state or npm release (never restoring or reusing the reverted or merged version), pass the same gates, then merge it with Daniel's per-PR approval; that merge's push publishes the newer patch containing the revert.

Every push to `main` runs `.github/workflows/publish.yml`, which publishes the
version in the root `package.json` (a new patch under the AGENTS.md version rule) to
the public npm registry after its gates; an unbumped version fails to publish.
While that holds, every merge is a public, irreversible release and needs Daniel's
per-PR approval (merge G2/G7), even with this marker. Only once publishing stops being automatic on every merge
(for example, with a separate release step) may agents merge covered PRs without
asking, subject to merge G1–G8. GitHub auto-merge is never used.

Daniel approved npm-publishing merges on 2026-11-05 and 2026-11-06; his KITCHEN-27
sign-off on 2026-11-06 was "kitchen 27: yes, you are allowed to merge single-user
services without asking me". The 2026-11-07 decision put public releases back to
per-PR approval.

Changes to this marker, the rollback line or these door rules take effect only
after they merge with Daniel's recorded per-PR approval (merge G8). A PR never
governs itself or is judged by rules it changes; changes to `doors.md` always need
per-PR approval. Read rules from the refreshed default branch; the marker never
bypasses one-way-door judgment, data/secrets/spend/deletion authorization or the
merge workflow's gates.

G6 deploy-health: the `publish.yml` run for the merge commit must reach success,
and `npm view @wienerberliner/pi-postbox version` must show the new version.
Never unpublish, reuse a version or publish manually. Deprecating a bad version is
Daniel's decision. `publish.yml` publishes through GitHub OIDC (`id-token: write`);
agents never use npm credentials.
