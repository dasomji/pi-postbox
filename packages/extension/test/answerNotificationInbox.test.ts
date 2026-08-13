import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAnswerNotificationInbox } from "../src/answerNotificationInbox.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("durable answer notification inbox", () => {
  it("suppresses proactive delivery after a client crash before server ack", async () => {
    const directory = await mkdtemp(join(tmpdir(), "postbox-answer-inbox-"));
    directories.push(directory);
    const env = { PI_POSTBOX_CONFIG_PATH: join(directory, "config.json") };
    const crashedClientInbox = new FileAnswerNotificationInbox(env);
    expect(await crashedClientInbox.recordIfNew("answer-crash-1")).toBe(true);

    // A fresh extension process sees the persisted marker and may ack the replay
    // without showing the owner a second notification.
    const restartedClientInbox = new FileAnswerNotificationInbox(env);
    expect(await restartedClientInbox.recordIfNew("answer-crash-1")).toBe(false);
    expect(await restartedClientInbox.recordIfNew("answer-new-2")).toBe(true);
  });
});
