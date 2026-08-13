import { readExtensionConfig, writeExtensionConfig } from "./config.js";

export interface AnswerNotificationInbox {
  recordIfNew(answerId: string): Promise<boolean>;
}

export class FileAnswerNotificationInbox implements AnswerNotificationInbox {
  private operation = Promise.resolve();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  recordIfNew(answerId: string): Promise<boolean> {
    let result = false;
    this.operation = this.operation.then(async () => {
      const config = await readExtensionConfig(this.env);
      if (config.deliveredAnswerIds.includes(answerId)) return;
      await writeExtensionConfig({ ...config, deliveredAnswerIds: [...config.deliveredAnswerIds, answerId] }, this.env);
      result = true;
    });
    return this.operation.then(() => result);
  }
}

export class MemoryAnswerNotificationInbox implements AnswerNotificationInbox {
  private readonly delivered = new Set<string>();
  async recordIfNew(answerId: string): Promise<boolean> {
    if (this.delivered.has(answerId)) return false;
    this.delivered.add(answerId);
    return true;
  }
}
