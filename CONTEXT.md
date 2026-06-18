# Pi Postbox

Pi Postbox is a remote decision handoff system for Pi agents. It tracks live Pi work and structured human decisions without mirroring full chat transcripts.

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
