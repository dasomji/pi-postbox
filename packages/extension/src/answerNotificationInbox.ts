import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defaultConfigPath } from "./config.js";

export type AnswerNotificationState = "new" | "pending" | "delivered";
export interface AnswerNotificationInbox {
  begin(answerId: string): Promise<AnswerNotificationState>;
  markDelivered(answerId: string): Promise<void>;
}

const InboxSchema = z.object({
  version: z.literal(1),
  notifications: z.record(z.enum(["pending", "delivered"]))
}).strict();
type InboxData = z.infer<typeof InboxSchema>;

export class FileAnswerNotificationInbox implements AnswerNotificationInbox {
  private readonly path: string;
  private readonly backupPath: string;
  private readonly lockPath: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const directory = dirname(defaultConfigPath(env));
    this.path = join(directory, "answer-notification-inbox.json");
    this.backupPath = `${this.path}.backup`;
    this.lockPath = `${this.path}.lock`;
  }

  async begin(answerId: string): Promise<AnswerNotificationState> {
    return this.withLock(() => {
      const data = this.read();
      const existing = data.notifications[answerId];
      if (existing) return existing;
      data.notifications[answerId] = "pending";
      this.write(data);
      return "new";
    });
  }

  async markDelivered(answerId: string): Promise<void> {
    await this.withLock(() => {
      const data = this.read();
      data.notifications[answerId] = "delivered";
      this.write(data);
    });
  }

  private async withLock<T>(operation: () => T): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    for (;;) {
      try {
        mkdirSync(this.lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if (!isExists(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    try {
      return operation();
    } finally {
      rmSync(this.lockPath, { recursive: true, force: true });
    }
  }

  private read(): InboxData {
    for (const path of [this.path, this.backupPath]) {
      try {
        return InboxSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      } catch {
        // Try the independently fsynced backup before starting empty.
      }
    }
    return { version: 1, notifications: {} };
  }

  private write(data: InboxData): void {
    const serialized = `${JSON.stringify(InboxSchema.parse(data))}\n`;
    this.atomicWrite(this.backupPath, serialized);
    this.atomicWrite(this.path, serialized);
  }

  private atomicWrite(path: string, contents: string): void {
    const temporary = `${path}.next-${process.pid}-${randomUUID()}`;
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const file = openSync(temporary, "r");
    try { fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}

export class MemoryAnswerNotificationInbox implements AnswerNotificationInbox {
  private readonly states = new Map<string, "pending" | "delivered">();
  async begin(answerId: string): Promise<AnswerNotificationState> {
    const state = this.states.get(answerId);
    if (state) return state;
    this.states.set(answerId, "pending");
    return "new";
  }
  async markDelivered(answerId: string): Promise<void> { this.states.set(answerId, "delivered"); }
}

function isExists(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST";
}
