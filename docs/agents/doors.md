# Merge doors

Classify the actual behavior and blast radius. Unknown cases and reviewer judgment
can upgrade a change to one-way. A two-way change is recoverable by reverting the
code without undoing durable data, trust, production exposure or external spend.

| Paths / behavior | Door | Reason and required judgment |
| --- | --- | --- |
| `packages/server/src/db/database.ts`, migration ledger, Question/Answer/revision storage and destructive lifecycle/media pruning | One-way | Startup migrates persistent SQLite; reverting code cannot reconstruct deleted or transformed records. Require isolated migration proof and a verified backup/restore plan. |
| `packages/protocol/src/**`, protocol fixtures, `scripts/generate-android-protocol-contract.mjs`, generated Android contract | One-way when changing the wire/storage contract | Server, extension, web and separately installed Android clients must agree. Review compatibility, upgrade/restart order and generated-contract checks. A generation-only identical-output repair can be two-way. |
| `packages/server/src/app.ts`, `security.ts`, routes/WebSocket authorization, `packages/extension/src/repositoryEvidenceTools.ts` | One-way when changing auth, access or secret boundaries | The service has no app-level authentication; access permits decisions, bounded reads and model spend. Same-origin protection is not authentication. |
| `packages/server/src/tailscaleServe.ts`, deployment/configuration and production profile/environment changes | One-way when changing production exposure/config | Tailnet Serve is best-effort, private and non-clobbering. Changes must preserve opt-out and never enable Funnel or overwrite another mapping. |
| `.github/workflows/publish.yml`, npm package/release metadata | One-way for publication/release effects | **Every push to main triggers the publish workflow**, ending in `npm publish --access public` after its gates. Publishing is an external release, including for this docs migration/version bump. Never publish manually during verification. |
| `packages/extension/src/questionChatRuntime.ts`, activation/turn/retry behavior, push service integrations | One-way when introducing or expanding spend/external effects | Explicit activation has no automatic model turn. Turns spend model tokens; notification integrations contact external services. Human authorization and scoped test doubles matter. |
| `scripts/dev.mjs`, checkout profile and private preview lifecycle | Two-way only while isolated | Revert must restore behavior, `verify:app` must cover it, and state/ports/mappings must belong exclusively to the preview. Touching production/data/auth upgrades it. |
| Web/Android presentation, ordinary read-only tools, maintained docs | Two-way when behavior remains reversible | Run applicable checks; a UI or docs change that changes access, decision submission, deletion, spend or deployment instructions inherits the stricter door. |

For this migration Daniel reviews and merges in **evidence mode**. No setting in
this branch authorizes automatic merging, publishing or repository-settings edits.
The integration owner supplies the final same-commit checks and cross-family door
review. Read effective doors/opt-in from the refreshed default branch at hand-back.

## Pilot opt-in

`auto-merge: enabled`

This is the Pi Postbox pilot opt-in. It becomes effective only for **later PRs**
after Daniel merges this migration. It never applies to this migration and never
bypasses one-way-door judgment, data/secrets/spend/deletion authorization or the
merge workflow's gates. Post-merge repository settings and undo evidence are owned
by the orchestrator, not implied by this marker.
