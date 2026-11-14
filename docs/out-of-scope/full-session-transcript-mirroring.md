# Full Pi Session transcript mirroring

Postbox tracks presence and structured human decisions. It does not stream or
store the originating Pi Session transcript as a general coding dashboard. That
would expand stored private material and couple decision delivery to harness
transcript formats/retention without helping the bounded handoff.

Question Chat has a distinct private runtime on the extension host. The server
relays temporary normalized messages but does not persist a transcript in SQLite,
state or History. Human-selected Answers and proposed options remain durable
Question data. [ADR 0004](../adr/0004-fresh-question-chat-settings.md) further removes
source-transcript inheritance by seeding fresh chats only from the selected Question.

Sources: [original product boundary](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/prd/pi-postbox.md#out-of-scope),
[Question Chat non-goals](https://github.com/dasomji/pi-postbox/blob/1529347528fda310869ed6221af2c136e589260d/docs/prd/postbox-question-chat.md#out-of-scope),
[privacy regressions](../../packages/server/test/questionChat.test.ts).
This does not prohibit extension-host recovery of its own private Chat session.
