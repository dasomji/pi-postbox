import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defaultConfigPath } from "./config.js";

export type AnswerNotificationState = "new" | "pending" | "delivered";
export interface AnswerNotificationInbox {
  begin(answerId: string): Promise<AnswerNotificationState>;
  markDelivered(answerId: string): Promise<void>;
}

const InboxSchema = z.object({
  version: z.literal(2),
  generation: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  notifications: z.record(z.enum(["pending", "delivered"]))
}).strict();
type InboxData = z.infer<typeof InboxSchema>;
const LockSchema = z.object({ pid: z.number().int().positive(), nonce: z.string().uuid(), createdAt: z.string().datetime() }).strict();

export class FileAnswerNotificationInbox implements AnswerNotificationInbox {
  private readonly path: string;
  private readonly backupPath: string;
  private readonly lockPath: string;

  constructor(env: NodeJS.ProcessEnv = process.env, private readonly lockTimeoutMs = 5_000) {
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
      this.writeNext(data);
      return "new";
    });
  }

  async markDelivered(answerId: string): Promise<void> {
    await this.withLock(() => {
      const data = this.read();
      data.notifications[answerId] = "delivered";
      this.writeNext(data);
    });
  }

  private async withLock<T>(operation: () => T): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + this.lockTimeoutMs;
    const lock = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
    for (;;) {
      try {
        const descriptor = openSync(this.lockPath, "wx", 0o600);
        try {
          writeFileSync(descriptor, `${JSON.stringify(lock)}\n`);
          fsyncSync(descriptor);
        } finally { closeSync(descriptor); }
        break;
      } catch (error) {
        if (!isExists(error)) throw error;
        if (this.lockIsReclaimable()) {
          rmSync(this.lockPath, { force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new Error("Timed out waiting for answer notification inbox lock");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    try {
      return operation();
    } finally {
      try {
        const current = LockSchema.parse(JSON.parse(readFileSync(this.lockPath, "utf8")));
        if (current.nonce === lock.nonce) rmSync(this.lockPath, { force: true });
      } catch { /* Never remove a lock now owned by somebody else. */ }
    }
  }

  private read(): InboxData {
    const candidates: InboxData[] = [];
    for (const path of [this.path, this.backupPath]) {
      try {
        const parsed = InboxSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        if (parsed.checksum === checksum(parsed.generation, parsed.notifications)) candidates.push(parsed);
      } catch {
        // Ignore partial/corrupt copies when another valid generation exists.
      }
    }
    return candidates.sort((a, b) => b.generation - a.generation)[0]
      ?? withChecksum(0, {});
  }

  private writeNext(data: InboxData): void {
    const next = withChecksum(data.generation + 1, data.notifications);
    const serialized = `${JSON.stringify(next)}\n`;
    this.atomicWrite(this.backupPath, serialized);
    this.atomicWrite(this.path, serialized);
  }

  private lockIsReclaimable(): boolean {
    try {
      const lock = LockSchema.parse(JSON.parse(readFileSync(this.lockPath, "utf8")));
      try { process.kill(lock.pid, 0); return false; }
      catch (error) { return !!error && typeof error === "object" && "code" in error && error.code === "ESRCH"; }
    } catch {
      try { return Date.now() - statSync(this.lockPath).mtimeMs > 1_000; }
      catch { return true; }
    }
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

function checksum(generation: number, notifications: Record<string, "pending" | "delivered">): string {
  return createHash("sha256").update(JSON.stringify({ generation, notifications })).digest("hex");
}

function withChecksum(generation: number, notifications: Record<string, "pending" | "delivered">): InboxData {
  return { version: 2, generation, notifications: { ...notifications }, checksum: checksum(generation, notifications) };
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
