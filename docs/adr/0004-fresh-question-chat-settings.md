# Fresh Question Chat and shared defaults

Accepted 2026-09-10. Supersedes the exact-fork-only parts of the Question Chat PRD and earlier research recommendation.

Question Chat creates a fresh private Pi session from the selected Question's current revision, prompt, ambiguity and options. The interviewer helps the human understand that decision; it does not inherit the originating agent's transcript or resolve the Question. The human still submits an Answer through Postbox. Repository tools retain their existing read-only boundaries.

Model and effort defaults live in the server SQLite database. Web and Android expose Settings, fetch the same record and save with an expected revision. A stale write returns 409. Screens refresh while foregrounded and retain unsaved drafts when another device changes the settings. The installation has no app-level user accounts, so these are shared defaults for the user of that server, not per-device preferences.

An empty model setting delegates to the chat host's configured Pi default; an explicit provider/model ID must be available and authenticated there. Unavailable explicit models fail rather than silently falling back. Pi adjusts effort to model capabilities and the snapshot reports the effective effort. Settings changes apply to newly created chats; recovered chats retain their saved model and effort.

The extension continues to host the runtime and hold credentials. Fresh context removes dependence on the source transcript and checkpoint, but does not add an always-on runtime host: offline extensions cannot serve chat. Version-2 recovery manifests preserve fresh chats across reload, including the initial question seed before the first model response. Old exact-fork manifests are discarded rather than mislabeled as fresh chats. Protocol 0.1.12 coordinates the server, extension, web and Android change.

Settings loads `GET /api/settings/models` on opening (and Android resume). This reads the server user's Pi authenticated model catalog, including custom models, using the same offline catalog policy as fresh chats. It does not start a Pi session or expose credentials. Deployments with remote chat hosts must keep their Pi model configuration aligned with the server; activation still checks availability on the actual chat host. A missing selected model is retained as a disabled `(legacy)` option with a warning. Catalog failures show a retryable error instead of treating every model as removed.

Android 0.5.4 removes routine chat status/model text, shows the project and branch in the header with connection-colored repository/total counts, and gives the note editor keyboard inset/scroll handling. The user confirmed these behaviors on their physical Android device on 2026-09-10.
