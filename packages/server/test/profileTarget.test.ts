import { PROTOCOL_VERSION, ServerProfileMetadataRecordSchema } from "@pi-postbox/protocol";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupProfileTarget, publishProfileTarget, refreshProfileTarget } from "../src/profileTarget.js";

const tempDirs: string[] = [];
const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_INSTANCE_ID = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("profile-scoped server metadata publication", () => {
  it("writes one identity record under the owning profile and not another profile", async () => {
    const root = await temporaryRoot();
    const developmentPath = join(root, "dev/a/active-local/server.json");
    const productionPath = join(root, "production/active-local/server.json");
    const owner = developmentOwner(developmentPath);

    const result = await publishProfileTarget(owner);

    expect(result).toMatchObject({ ok: true, path: developmentPath });
    expect(await readRecord(developmentPath)).toMatchObject({
      version: 2,
      profile: owner.profile,
      instanceId: INSTANCE_ID,
      protocolVersion: PROTOCOL_VERSION,
      buildId: "test-build",
      url: "http://127.0.0.1:43123/"
    });
    await expect(readFile(productionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let an older instance refresh or clean up a newer profile record", async () => {
    const root = await temporaryRoot();
    const metadataPath = join(root, "active-local/server.json");
    const newer = { ...developmentOwner(metadataPath), instanceId: OTHER_INSTANCE_ID, url: "http://127.0.0.1:43124/" };
    await publishProfileTarget(newer);

    const older = developmentOwner(metadataPath);
    expect(await refreshProfileTarget(older)).toMatchObject({ ok: false, reason: "not-owner" });
    await cleanupProfileTarget(older);

    expect(await readRecord(metadataPath)).toMatchObject({ instanceId: OTHER_INSTANCE_ID, url: newer.url });
  });

  it("skips a symlinked metadata path instead of writing through it", async () => {
    const root = await temporaryRoot();
    const metadataPath = join(root, "active-local/server.json");
    await mkdir(join(root, "active-local"), { recursive: true });
    const victim = join(root, "outside.json");
    await writeFile(victim, "do-not-overwrite");
    await symlink(victim, metadataPath);

    expect(await publishProfileTarget(developmentOwner(metadataPath))).toMatchObject({ ok: false });
    expect(await readFile(victim, "utf8")).toBe("do-not-overwrite");
  });

  it("rejects non-loopback publication URLs", async () => {
    const root = await temporaryRoot();
    const metadataPath = join(root, "active-local/server.json");
    expect(await publishProfileTarget({ ...developmentOwner(metadataPath), url: "http://0.0.0.0:43123" })).toEqual({
      ok: false,
      reason: "unsafe-url"
    });
  });
});

function developmentOwner(metadataPath: string) {
  return {
    profile: { kind: "development" as const, id: "development:0123456789abcdef" },
    metadataPath,
    instanceId: INSTANCE_ID,
    url: "http://127.0.0.1:43123/",
    protocolVersion: PROTOCOL_VERSION,
    buildId: "test-build"
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-postbox-profile-target-"));
  tempDirs.push(root);
  return root;
}

async function readRecord(path: string) {
  return ServerProfileMetadataRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
