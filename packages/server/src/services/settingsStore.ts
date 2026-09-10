import { PostboxSettingsSchema, type PostboxSettings } from "../protocol.js";
import type { SqliteDatabase } from "../db/database.js";

/** One user's Postbox installation: all devices share the same durable defaults. */
export class SettingsStore {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS postbox_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, chat_json TEXT NOT NULL
    ); INSERT OR IGNORE INTO postbox_settings VALUES (1, 0, '{"model":null,"effort":"medium"}');`);
  }

  get(): PostboxSettings {
    const row = this.db.prepare("SELECT revision, chat_json FROM postbox_settings WHERE id = 1").get() as { revision: number; chat_json: string };
    return PostboxSettingsSchema.parse({ revision: row.revision, chat: JSON.parse(row.chat_json) });
  }

  update(input: PostboxSettings): PostboxSettings | undefined {
    return this.db.transaction(() => {
      const result = this.db.prepare("UPDATE postbox_settings SET revision = revision + 1, chat_json = ? WHERE id = 1 AND revision = ?")
        .run(JSON.stringify(input.chat), input.revision);
      return result.changes ? this.get() : undefined;
    })();
  }
}
