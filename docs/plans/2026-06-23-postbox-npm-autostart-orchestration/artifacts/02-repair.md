# U2 REPAIR: Preserve fallback active-local affinity

## changedFiles

- `packages/extension/src/activeLocalTargetResolver.ts`
- `packages/extension/src/index.ts`
- `packages/extension/test/extension.test.ts`
- `docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/02-repair.md`

## testsAddedOrUpdated

- Added `keeps fallback active-local clients from polling back to a recovered configured remote` in `packages/extension/test/extension.test.ts`.
  - Starts registration with a configured remote that fails health verification and fresh healthy active-local metadata.
  - Verifies the registered client uses the active-local URL.
  - Simulates configured remote recovery, invokes the client's polling resolver hook, and verifies it still resolves an active-local target without probing or selecting the recovered remote.

## commandsRun

- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts` — passed.
- `npm test -- packages/extension/test/activeLocalTargetResolver.test.ts` — passed.
- `npm test -- packages/extension/test/extension.test.ts packages/extension/test/resilience.test.ts` — passed.
- `git status --short && echo '---DIFF STAT---' && git diff --stat && echo '---CACHED---' && git diff --cached --name-only` — passed; no staged files.
- `git status --short docs/plans/2026-06-23-postbox-npm-autostart-orchestration/artifacts/02-repair.md packages/extension/src/activeLocalTargetResolver.ts packages/extension/src/index.ts packages/extension/test/extension.test.ts && echo '---CACHED---' && git diff --cached --name-only` — passed; changed repair files are unstaged and cached diff is empty.

## validationOutput

Combined resolver + impacted extension/client validation:

```text
Test Files  3 passed (3)
Tests  28 passed (28)
```

Targeted resolver validation:

```text
Test Files  1 passed (1)
Tests  10 passed (10)
```

Impacted extension/client validation:

```text
Test Files  2 passed (2)
Tests  18 passed (18)
```

Staging check:

```text
---CACHED---
```

(no staged files)

## residualRisks

- No known residual U2 repair risk. The initial resolver still prefers a healthy configured non-loopback remote before falling back, while active-local polling resolvers now skip configured remotes to avoid mid-session migration back to a recovered preferred remote.
- Autostart, status command, and browser behavior remain intentionally out of scope.

## noStagedFiles

true
