# Pi Postbox

Pi Postbox is a remote decision handoff system for Pi agents. It tracks live Pi work and structured human decisions without mirroring full Pi Session transcripts.

## Language

**Postbox Session**:
A dashboard-visible record of one Pi session registration, keyed to the active Pi session identity. A new Pi `/new` command creates a distinct Postbox Session rather than reusing the prior one; the prior Postbox Session is explicitly shut down. When Pi has no durable session file, Postbox still treats the active Pi session as distinct using a per-session generated identity.
_Avoid_: Dashboard row, connection, conversation

**Pi Session**:
The underlying Pi conversation/runtime session represented by Pi's session file and current leaf. It is the source of identity for a Postbox Session.
_Avoid_: Chat, process, agent run

**Postbox Question**:
A structured human decision request that belongs to the Pi Session that created it. If that Pi Session is shut down or replaced, the server cancels unresolved questions rather than moving them to the replacement session.
_Avoid_: Prompt, card, ticket

**Question Chat**:
A private, question-scoped interviewer runtime that helps a human understand one pending Postbox Question without selecting, submitting, cancelling, or otherwise resolving it. Question Chat is distinct from the originating Pi Session and its transcript is never persisted by the Postbox server.
_Avoid_: Chat (when used alone), Pi Chat, conversation

**Exact fork**:
The primary Question Chat form: a private branch of the originating Pi Session at the recorded Postbox Question leaf, with the recorded authenticated model preferred before Pi's configured default.
_Avoid_: Copy, clone, source conversation

**Context-only interviewer**:
An explicitly confirmed Question Chat fallback created from persisted Postbox Question and handoff context when an exact fork is unavailable. It has no originating Pi Session transcript and must never be substituted silently.
_Avoid_: Context-only Chat, reconstructed fork, synthetic conversation

**Recovery manifest**:
A private, versioned metadata file beside a Question Chat fork that lets the extension reconcile and reopen that fork after reload or restart. It contains no Question Chat transcript and is deleted with terminal or invalid runtimes.
_Avoid_: Chat record, transcript cache, server manifest

**Question Chat turn**:
One ordinary Question Chat model invocation. The send acknowledgement uses `mode: "turn"`; a message accepted during generation instead uses `mode: "steer"`.
_Avoid_: Prompt, request, ask

**Autostarted Postbox Server**:
A reusable background `pi-postbox-server` process started by the Pi extension when the preferred configured server is unreachable and a Postbox Question needs to be sent. It is not an operating-system service; it may outlive the Pi Session that started it so other local Pi Sessions can reuse it through active-local discovery.
_Avoid_: System daemon, service, sidecar

**Preferred Postbox Server**:
The server URL configured through `PI_POSTBOX_URL` or config. The extension tries it first, but if it is unreachable the extension may start an Autostarted Postbox Server. Once a Pi Session registers with a fallback server, it stays with that server until reload or restart rather than migrating mid-session.
_Avoid_: Authoritative server, required server
