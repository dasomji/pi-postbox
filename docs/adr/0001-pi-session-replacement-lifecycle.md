# Pi Session Replacement Lifecycle

Pi Postbox treats durable decisions independently from the lifetime of a Pi turn or process. `/new`, `/resume`, `/fork`, `/clone`, quit, disconnect, and process death preserve unresolved Questions and unread Answers under their durable owner identity. `/reload` reconnects with that same owner identity and retains queue responsibility.

Before a session switch or fork, Postbox checks the current owner's active Questions and unread Answers. An interactive Pi client warns and asks for explicit confirmation; declining cancels only the navigation, so the guard is never inescapable. Ordinary shutdown marks the session offline and clears ephemeral waits and adapter resources without cancelling Questions or deleting Answers. For an ungraceful crash, the heartbeat lease first marks the owner stale and then offline; Postbox does not inspect transcripts, JSONL files, or PIDs.

## Consequences

Extension UI/status callbacks are session-scoped and disposable: shutdown deactivates the old scope before WebSocket close/reconnect events can fire. If Pi does not expose a durable session file, Postbox uses a per-session generated identity so `/new` still produces a distinct Postbox Session.

Creating an open Question does not retain an agent turn. Only the explicit `wait_for_postbox` tool blocks, publishes `waiting_for_postbox` to Postbox and parent status systems, and retains adapter capacity until it wakes or is cancelled. Local `ask_user` and Herdr waiting behavior remain independent.
