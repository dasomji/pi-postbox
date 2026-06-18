# Pi Session Replacement Lifecycle

Pi Postbox treats Pi session replacement as a semantic boundary, not just a transport reconnect. A Pi `/new`, `/resume`, `/fork`, or quit explicitly shuts down the old Postbox Session and cancels its unresolved Postbox Questions with a lifecycle rationale, while `/reload` is treated as a reconnect/re-registration path that preserves pending questions for the same Pi Session. This keeps remote decision cards attached to the Pi Session that created them, avoids moving decisions across conversation boundaries, and prevents long-lived extension callbacks from touching stale Pi contexts after replacement.

## Consequences

Extension UI/status callbacks are session-scoped and disposable: shutdown deactivates the old scope before WebSocket close/reconnect events can fire. If Pi does not expose a durable session file, Postbox uses a per-session generated identity so `/new` still produces a distinct Postbox Session.
