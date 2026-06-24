## Findings

1. **Severity:** Medium  
   **Location:** `apps/web/src/components/QuestionLayoutSpotlight.svelte:180`  
   **Requirement/pattern violated:** Unit 02 accessibility basics for the context overlay/panel.  
   **Issue:** The fixed context overlay renders its panel as a plain `<aside>` with no dialog semantics (`role="dialog"`, `aria-modal`, or accessible name relationship). Screen-reader users are not told that a modal/panel opened or what it is, even though backdrop/Escape/close button close it.  
   **Required fix:** Add dialog semantics to the panel, e.g. `role="dialog" aria-modal="true" aria-labelledby="context-panel-title"`, and give the existing `Context` heading that id.

## Claude reviewer

- Result: Claude reviewer skipped: previous tdd-reviewer attempts timed out/hung.

## Validation notes

- Commands run, if any: `git diff -- ...`; `git diff --stat -- ...`; `git status --short -- ...`; `nl -ba ... | sed ...`.
- Scope checked: Unit 02 requested files/diff only: `App.svelte`, `Sidebar.svelte`, `QuestionLayoutSpotlight.svelte`, `mobileQuestionUi.static.test.ts`, and Unit 02 plan.
