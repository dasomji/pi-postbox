# Unit 04 — Native question list/detail/answer UI

## Goal
Provide the core native Postbox workflow: see sessions/open questions, inspect context, answer or cancel.

## Scope
- Mobile-first Compose layout for active sessions and pending questions.
- Question detail screen with prompt, context/relevance/impact, options, and rich context.
- Single-select and multi-select answer forms.
- Optional note/rationale fields if they fit without slowing the primary answer flow.
- Clear terminal states for answered/cancelled/expired/already-resolved.
- Basic empty/loading/error states.

## Test scenarios
- Pending single-select question enables submit only after one option is selected.
- Pending multi-select question enables submit after at least one option is selected.
- Submit success removes or marks the pending question according to latest state snapshot.
- Already-resolved conflict shows a non-destructive message and refreshes state.
- Long prompt/context is scrollable and does not hide action buttons.
- Offline/disconnected state does not lose the currently visible question.

## Notes
Follow the current mobile/PWA information hierarchy where useful, but prefer native Android interaction patterns over directly porting Svelte components.
