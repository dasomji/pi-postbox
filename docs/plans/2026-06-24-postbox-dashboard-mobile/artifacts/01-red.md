# Unit 01 RED — Sidebar active/recent session filtering

## changedFiles

- `apps/web/src/lib/store.svelte.test.ts`
- `vitest.config.ts`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-red.md`

## testsAddedOrUpdated

- `apps/web/src/lib/store.svelte.test.ts`
  - `store sidebar project groups > shows live, stale, and recently disconnected sessions while hiding older offline sessions and empty projects`
  - Asserts sidebar/store project groups contain live and stale sessions across `working`, `blocked`, `idle`, and `unknown` semantic states.
  - Asserts an offline session disconnected 4m59s before the snapshot timestamp remains visible.
  - Asserts offline sessions disconnected at/older than 5 minutes, offline sessions missing `disconnectedAt`, and projects emptied by filtering are hidden.
  - Asserts visible sessions keep existing branch-label sort order.

## commandsRun

- `npx vitest run apps/web/src/lib/store.svelte.test.ts`
  - Result: failed initially before test execution with `ReferenceError: $state is not defined`, showing the root Vitest config was not transforming Svelte rune `.svelte.ts` modules.
- `npx vitest run apps/web/src/lib/store.svelte.test.ts`
  - Result: failed as intended after adding the Svelte Vite plugin to the Vitest config.

## validationOutput

Targeted RED failure:

```text
FAIL  apps/web/src/lib/store.svelte.test.ts > store sidebar project groups > shows live, stale, and recently disconnected sessions while hiding older offline sessions and empty projects
AssertionError: expected [ 'Missing Disconnect Project', …(2) ] to deeply equal [ 'Visible Project' ]

- Expected
+ Received

  [
+   "Missing Disconnect Project",
+   "Old Offline Project",
    "Visible Project",
  ]
```

Why this proves the missing behavior: current `store.projects` groups every snapshot session directly, so offline-only projects with missing or old `disconnectedAt` are still shown instead of being filtered out relative to `snapshot.timestamp`.

## residualRisks

- The RED test uses the exported Svelte store singleton as the public interface. A future GREEN may choose to extract a pure helper, but the behavior must still be observable through `store.projects`.
- `vitest.config.ts` now includes the Svelte plugin so rune-based web modules can be tested; this is test infrastructure, not product behavior.

## noStagedFiles

- No files were staged by this RED pass.
