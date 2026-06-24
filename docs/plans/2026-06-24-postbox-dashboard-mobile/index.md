# Postbox dashboard active sessions + mobile-first question UI

Current state: Unit 01 PASS; Unit 02 initial GREEN done, review found dialog semantics issue; user added mobile hamburger menu requirement, next action RED for hamburger behavior.

Goal:
1. Sidebar only displays online sessions (`live`/`stale`) plus `offline` sessions whose `disconnectedAt` is less than 5 minutes before the snapshot timestamp.
2. Question view project/footer info is sticky.
3. Context box/panel is closed by default and expands with ease-in-out animation when clicked.
4. UI is mobile-first and should look good on small phones and Honor Magic V3/foldable widths.

Preflight:
- Role agents are available. `smart_compact` visible to role agents.
- npm/node/vitest available.
- Nested Claude reviewer smoke succeeded in tdd-reviewer preflight.
- Browser screenshot evidence may be blocked: verifier did not find google-chrome/chromium in PATH. Use best available DOM/build evidence unless browser becomes available.
- Project guidance: no repo-local AGENTS/CLAUDE; workspace AGENTS says extension work is its own package/repo.

Units:
- [01 Sidebar active/recent session filtering](units/01-sidebar-active-recent-sessions.md) — RED next.
- [02 Mobile-first question layout, sticky footer, animated context](units/02-mobile-question-ui.md).

Decisions:
- Treat `live` and `stale` as active/online for display because user said online includes idle/blocked/working and protocol has live/stale/offline presence.
- Offline grace window is 5 minutes from `disconnectedAt` to state snapshot timestamp. Missing/invalid `disconnectedAt` means do not show offline session.

Cross-unit risks:
- Svelte 5 runes syntax; tests should focus on pure helpers where possible and component behavior only if existing setup supports it.
- Mobile visual evidence may be limited by missing browser executable.

Update: User likes mobile-first direction but mobile sidebar must be behind a hamburger menu instead of a top list. Treat as Unit 02 repair/subrequirement.
