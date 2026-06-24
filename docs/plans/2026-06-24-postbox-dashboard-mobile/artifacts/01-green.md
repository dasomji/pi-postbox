# Unit 01 GREEN — Sidebar active/recent session filtering

## changedFiles

- `apps/web/src/lib/store.svelte.ts`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-green.md`

Pre-existing RED files still present in the working tree and unchanged by this GREEN pass:
- `apps/web/src/lib/store.svelte.test.ts`
- `vitest.config.ts`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/artifacts/01-red.md`
- `docs/plans/2026-06-24-postbox-dashboard-mobile/units/01-sidebar-active-recent-sessions.md`

## commandsRun

- `git status --short`
  - Result: passed; confirmed existing RED working-tree changes before implementation.
- `npx vitest run apps/web/src/lib/store.svelte.test.ts`
  - Result: failed before implementation with the expected RED assertion showing old/missing offline projects were still visible.
- `npx vitest run apps/web/src/lib/store.svelte.test.ts`
  - Result: passed after implementation.
- `npm run typecheck`
  - Result: passed.
- `git diff --cached --quiet; echo "cached_diff_exit=$?"`
  - Result: passed; `cached_diff_exit=0` confirms no staged files.

## validationOutput

Targeted Vitest after GREEN:

```text
RUN  v4.1.9 /home/dev/Development/pi-daniel/extensions/dashboard

Test Files  1 passed (1)
     Tests  1 passed (1)
```

Typecheck after GREEN:

```text
> @wienerberliner/pi-postbox@0.1.0 typecheck
> tsc -b
```

## residualRisks

- The filtering is applied to sidebar project grouping (`store.projects`) only. Raw snapshot sessions and selection lookup remain unchanged, preserving the Unit 01 non-goal of not deleting or hiding API response records globally.

## noStagedFiles

- true
