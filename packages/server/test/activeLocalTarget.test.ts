import {
  ACTIVE_LOCAL_METADATA_DIRECTORY,
  ACTIVE_LOCAL_METADATA_FILENAMES,
  ActiveLocalMetadataRecordSchema
} from "@pi-postbox/protocol";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type FsPromises = typeof import("node:fs/promises");

const fsInterleaving = vi.hoisted(() => ({
  beforeRename: undefined as ((from: string, to: string) => Promise<void>) | undefined,
  beforeUnlink: undefined as ((path: string) => Promise<void>) | undefined
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<FsPromises>();
  return {
    ...actual,
    rename: async (...args: Parameters<FsPromises["rename"]>) => {
      await fsInterleaving.beforeRename?.(String(args[0]), String(args[1]));
      return actual.rename(...args);
    },
    unlink: async (...args: Parameters<FsPromises["unlink"]>) => {
      await fsInterleaving.beforeUnlink?.(String(args[0]));
      return actual.unlink(...args);
    }
  };
});

import {
  cleanupActiveLocalTarget,
  publishActiveLocalTarget,
  refreshActiveLocalTarget
} from "../src/activeLocalTarget.js";

const tempDirs: string[] = [];
const PRODUCTION_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const NEWER_INSTANCE_ID = "22222222-2222-4222-8222-222222222222";
const INTERLEAVING_WAIT_MS = 250;

async function makeConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-postbox-active-local-"));
  tempDirs.push(dir);
  return dir;
}

function metadataPath(configDir: string, role: "dev" | "production"): string {
  return join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY, ACTIVE_LOCAL_METADATA_FILENAMES[role]);
}

async function readMetadataRecord(configDir: string, role: "dev" | "production") {
  return ActiveLocalMetadataRecordSchema.parse(JSON.parse(await readFile(metadataPath(configDir, role), "utf8")));
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

afterEach(async () => {
  fsInterleaving.beforeRename = undefined;
  fsInterleaving.beforeUnlink = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("active-local server metadata publication", () => {
  it("writes a fixed role metadata record under the existing Postbox config base", async () => {
    const configDir = await makeConfigDir();
    const before = Date.now();

    await publishActiveLocalTarget({
      role: "production",
      url: "http://127.0.0.1:32187",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    });

    const record = await readMetadataRecord(configDir, "production");
    expect(record).toMatchObject({
      version: 1,
      role: "production",
      instanceId: PRODUCTION_INSTANCE_ID,
      url: "http://127.0.0.1:32187/"
    });
    expect(Date.parse(record.updatedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(record.updatedAt)).toBeLessThanOrEqual(Date.now() + 1_000);
    await expect(readFile(metadataPath(configDir, "dev"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prefers PI_POSTBOX_CONFIG_DIR over PI_POSTBOX_CONFIG_PATH for the active-local metadata base", async () => {
    const configDir = await makeConfigDir();
    const configPathBase = await makeConfigDir();

    const result = await publishActiveLocalTarget({
      role: "production",
      url: "http://127.0.0.1:32187",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: {
        PI_POSTBOX_CONFIG_DIR: configDir,
        PI_POSTBOX_CONFIG_PATH: join(configPathBase, "config.json")
      }
    });

    expect(result).toMatchObject({ ok: true, path: metadataPath(configDir, "production") });
    expect(await readMetadataRecord(configDir, "production")).toMatchObject({
      role: "production",
      instanceId: PRODUCTION_INSTANCE_ID,
      url: "http://127.0.0.1:32187/"
    });
    await expect(readFile(metadataPath(configPathBase, "production"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips non-loopback targets without publishing a role file", async () => {
    const configDir = await makeConfigDir();

    await publishActiveLocalTarget({
      role: "production",
      url: "http://0.0.0.0:32187",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    });

    await expect(readFile(metadataPath(configDir, "production"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let an older same-role owner refresh or clean up a newer record", async () => {
    const configDir = await makeConfigDir();
    const activeLocalDir = join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY);
    await mkdir(activeLocalDir, { recursive: true });
    const newerRecord = {
      version: 1,
      role: "production",
      instanceId: NEWER_INSTANCE_ID,
      url: "http://127.0.0.1:32188/",
      updatedAt: new Date("2026-06-23T12:00:00.000Z").toISOString()
    };
    await writeFile(metadataPath(configDir, "production"), JSON.stringify(newerRecord), { mode: 0o600 });

    const olderOwner = {
      role: "production" as const,
      url: "http://127.0.0.1:32187/",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    };

    await refreshActiveLocalTarget(olderOwner);
    expect(await readMetadataRecord(configDir, "production")).toEqual(newerRecord);

    await cleanupActiveLocalTarget(olderOwner);
    expect(await readMetadataRecord(configDir, "production")).toEqual(newerRecord);
  });

  it("does not let an older refresh reclaim the role when a newer publish interleaves after ownership read", async () => {
    const configDir = await makeConfigDir();
    const activeLocalDir = join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY);
    const path = metadataPath(configDir, "production");
    await mkdir(activeLocalDir, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        role: "production",
        instanceId: PRODUCTION_INSTANCE_ID,
        url: "http://127.0.0.1:32187/",
        updatedAt: new Date("2026-06-23T12:00:00.000Z").toISOString()
      }),
      { mode: 0o600 }
    );

    const olderOwner = {
      role: "production" as const,
      url: "http://127.0.0.1:32187/",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir },
      now: () => Date.parse("2026-06-23T12:01:00.000Z")
    };
    const newerOwner = {
      role: "production" as const,
      url: "http://127.0.0.1:32188/",
      instanceId: NEWER_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir },
      now: () => Date.parse("2026-06-23T12:02:00.000Z")
    };

    let triggered = false;
    let newerPublish: ReturnType<typeof publishActiveLocalTarget> | undefined;
    fsInterleaving.beforeRename = async (_from, to) => {
      if (to !== path || triggered) return;
      triggered = true;
      newerPublish = publishActiveLocalTarget(newerOwner);
      await Promise.race([newerPublish.then(() => undefined), wait(INTERLEAVING_WAIT_MS)]);
      fsInterleaving.beforeRename = undefined;
    };

    await refreshActiveLocalTarget(olderOwner);
    expect(triggered).toBe(true);
    if (!newerPublish) throw new Error("newer publish did not start");
    await newerPublish;

    expect(await readMetadataRecord(configDir, "production")).toMatchObject({
      role: "production",
      instanceId: NEWER_INSTANCE_ID,
      url: "http://127.0.0.1:32188/",
      updatedAt: "2026-06-23T12:02:00.000Z"
    });
  });

  it("does not let an older cleanup delete the role when a newer publish interleaves after ownership read", async () => {
    const configDir = await makeConfigDir();
    const activeLocalDir = join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY);
    const path = metadataPath(configDir, "production");
    await mkdir(activeLocalDir, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        role: "production",
        instanceId: PRODUCTION_INSTANCE_ID,
        url: "http://127.0.0.1:32187/",
        updatedAt: new Date("2026-06-23T12:00:00.000Z").toISOString()
      }),
      { mode: 0o600 }
    );

    const olderOwner = {
      role: "production" as const,
      url: "http://127.0.0.1:32187/",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    };
    const newerOwner = {
      role: "production" as const,
      url: "http://127.0.0.1:32188/",
      instanceId: NEWER_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir },
      now: () => Date.parse("2026-06-23T12:02:00.000Z")
    };

    let triggered = false;
    let newerPublish: ReturnType<typeof publishActiveLocalTarget> | undefined;
    fsInterleaving.beforeUnlink = async (unlinkPath) => {
      if (unlinkPath !== path || triggered) return;
      triggered = true;
      newerPublish = publishActiveLocalTarget(newerOwner);
      await Promise.race([newerPublish.then(() => undefined), wait(INTERLEAVING_WAIT_MS)]);
      fsInterleaving.beforeUnlink = undefined;
    };

    await cleanupActiveLocalTarget(olderOwner);
    expect(triggered).toBe(true);
    if (!newerPublish) throw new Error("newer publish did not start");
    await newerPublish;

    expect(await readMetadataRecord(configDir, "production")).toMatchObject({
      role: "production",
      instanceId: NEWER_INSTANCE_ID,
      url: "http://127.0.0.1:32188/",
      updatedAt: "2026-06-23T12:02:00.000Z"
    });
  });

  it("skips symlinked role metadata paths instead of writing through them", async () => {
    const configDir = await makeConfigDir();
    const activeLocalDir = join(configDir, ACTIVE_LOCAL_METADATA_DIRECTORY);
    await mkdir(activeLocalDir, { recursive: true });
    const victimPath = join(configDir, "outside-production.json");
    await writeFile(victimPath, "do-not-overwrite");
    await symlink(victimPath, metadataPath(configDir, "production"));

    await publishActiveLocalTarget({
      role: "production",
      url: "http://127.0.0.1:32187",
      instanceId: PRODUCTION_INSTANCE_ID,
      env: { PI_POSTBOX_CONFIG_DIR: configDir }
    });

    expect(await readFile(victimPath, "utf8")).toBe("do-not-overwrite");
  });
});
