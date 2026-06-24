# U1 REVIEW

## Findings

1. **Severity:** High  
   **Location:** `package.json:59`  
   **Requirement/pattern violated:** U1 plan/ADR require the published tarball’s internal runtime imports to resolve from the installed package.  
   **Issue:** The root package now includes `packages/protocol/dist`, but it does not make the bare specifier `@pi-postbox/protocol` resolvable for packed/global installs. Root `dependencies` only list external packages, while runtime files still import `@pi-postbox/protocol` (`packages/server/dist/cli.js`, `packages/server/dist/app.js`, `packages/extension/src/client/PostboxClient.ts`). This passes in the workspace because npm creates workspace links, but an installed `@wienerberliner/pi-postbox` package will not automatically install dependencies from nested `packages/server/package.json` or resolve sibling `packages/protocol` as `@pi-postbox/protocol`.

   **Required fix:** Make `@pi-postbox/protocol` resolvable in the published install path—e.g. bundle/refactor internal imports to package-relative paths, or declare and bundle/publish the internal workspace dependency—and add a regression check that validates import/CLI resolution from the packed package rather than only checking file presence.

## Claude reviewer

- Result: unavailable/error — attempted quick nested Claude reviewer, but `claude -p --tools "" --no-session-persistence` timed out after 75 seconds with no usable output.

## Validation notes

Commands run by reviewer:
- `git status --short && git diff --stat && git diff -- ...`
- read U1 dossier, RED/GREEN artifacts, orchestration plan, implementation plan, ADR, package metadata, README
- inspected package metadata and built runtime imports
- `grep -R "@pi-postbox/protocol" -n packages/server/dist packages/extension/src`
- checked staged-file state

No staged files reported.
