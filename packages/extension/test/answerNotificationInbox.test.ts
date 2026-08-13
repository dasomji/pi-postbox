import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAnswerNotificationInbox } from "../src/answerNotificationInbox.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("durable answer notification inbox", () => {
  it("models pending callback work separately from durable delivery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-inbox-"));
    directories.push(directory);
    const env = { PI_POSTBOX_CONFIG_PATH: join(directory, "config.json") };
    const crashedClientInbox = new FileAnswerNotificationInbox(env);
    expect(await crashedClientInbox.begin("answer-crash-1")).toBe("new");
    expect(await new FileAnswerNotificationInbox(env).begin("answer-crash-1")).toBe("pending");
    await crashedClientInbox.markDelivered("answer-crash-1");

    // A fresh extension process sees the persisted marker and may ack the replay
    // without showing the owner a second notification.
    const restartedClientInbox = new FileAnswerNotificationInbox(env);
    expect(await restartedClientInbox.begin("answer-crash-1")).toBe("delivered");
    expect(await restartedClientInbox.begin("answer-new-2")).toBe("new");
  });

  it("recovers from a truncated primary using its atomic backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-inbox-corrupt-"));
    directories.push(directory);
    const env = { PI_POSTBOX_CONFIG_PATH: join(directory, "config.json") };
    const inbox = new FileAnswerNotificationInbox(env);
    await inbox.begin("answer-safe");
    await inbox.markDelivered("answer-safe");
    await writeFile(join(directory, "answer-notification-inbox.json"), "{truncated");
    expect(await new FileAnswerNotificationInbox(env).begin("answer-safe")).toBe("delivered");
  });

  it("serializes concurrent inbox writers without clobbering extension config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-inbox-concurrent-"));
    directories.push(directory);
    const configPath = join(directory, "config.json");
    const env = { PI_POSTBOX_CONFIG_PATH: configPath };
    await writeFile(configPath, JSON.stringify({ machineId: "machine-safe", serverUrl: "http://postbox.local" }));
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const inbox = new FileAnswerNotificationInbox(env);
      const id = `answer-${index}`;
      await inbox.begin(id);
      await inbox.markDelivered(id);
    }));
    for (let index = 0; index < 20; index += 1) {
      expect(await new FileAnswerNotificationInbox(env).begin(`answer-${index}`)).toBe("delivered");
    }
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ machineId: "machine-safe", serverUrl: "http://postbox.local" });
  });

  it("reclaims a dead-owner lock but never steals a live-owner lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-inbox-lock-"));
    directories.push(directory);
    const env = { PI_POSTBOX_CONFIG_PATH: join(directory, "config.json") };
    const lockPath = join(directory, "answer-notification-inbox.json.lock");
    await writeFile(lockPath, JSON.stringify({ pid: 999_999_999, nonce: randomUUID(), createdAt: new Date().toISOString() }));
    expect(await new FileAnswerNotificationInbox(env, 100).begin("answer-dead-lock")).toBe("new");

    const liveLock = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
    await writeFile(lockPath, JSON.stringify(liveLock));
    await expect(new FileAnswerNotificationInbox(env, 25).begin("answer-live-lock")).rejects.toThrow("Timed out");
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(liveLock);
  });

  it("selects the newest valid generation across primary and backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-inbox-generations-"));
    directories.push(directory);
    const env = { PI_POSTBOX_CONFIG_PATH: join(directory, "config.json") };
    const record = (generation: number, state: "pending" | "delivered") => {
      const notifications = { "answer-generation": state };
      const checksum = createHash("sha256").update(JSON.stringify({ generation, notifications })).digest("hex");
      return JSON.stringify({ version: 2, generation, checksum, notifications });
    };
    await writeFile(join(directory, "answer-notification-inbox.json"), record(2, "pending"));
    await writeFile(join(directory, "answer-notification-inbox.json.backup"), record(3, "delivered"));
    expect(await new FileAnswerNotificationInbox(env).begin("answer-generation")).toBe("delivered");
  });
});
