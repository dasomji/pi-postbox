import {
  PROTOCOL_VERSION,
  SERVER_PROFILE_METADATA_VERSION,
  createHealthResponse,
  type ServerInstanceIdentity,
  type ServerProfileIdentity
} from "@pi-postbox/protocol";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveServerTarget } from "../src/serverTargetResolver.js";
import { resolveServerProfile } from "../src/serverProfile.js";

const tempDirs: string[] = [];
const NOW_MS = Date.parse("2026-08-14T15:00:00.000Z");
const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("profile-scoped extension target resolver", () => {
  it("selects an explicit PI_POSTBOX_URL after compatibility verification", async () => {
    const fixture = await profileFixture("development");
    const remoteProfile = { kind: "production" as const, id: "production" as const };
    const health = healthFetch({
      "https://postbox.example.test/healthz": createHealthResponse({
        startedAtMs: NOW_MS - 1_000,
        nowMs: NOW_MS,
        profile: remoteProfile,
        buildId: "remote-build"
      })
    });

    const result = await resolveServerTarget({
      ...fixture.options,
      env: { ...fixture.options.env, PI_POSTBOX_URL: "https://postbox.example.test" },
      fetch: health,
      nowMs: NOW_MS
    });

    expect(result).toMatchObject({
      status: "selected",
      target: {
        source: "explicit-override",
        url: "https://postbox.example.test",
        profile: remoteProfile,
        profilePollingEnabled: false
      }
    });
  });

  it("reads only the active checkout profile metadata and never production metadata", async () => {
    const fixture = await profileFixture("development");
    const developmentInstance = await writeMetadata(fixture.profile, 43123);
    const production = resolveServerProfile({
      packageRoot: join(fixture.homeDir, ".pi/agent/npm/node_modules/@wienerberliner/pi-postbox"),
      cwd: "/work/outside",
      homeDir: fixture.homeDir,
      stateHome: fixture.stateHome
    });
    await writeMetadata(production, 32187);
    const health = healthFetch({
      [new URL("healthz", developmentInstance.url).toString()]: createHealthResponse({
        startedAtMs: NOW_MS - 1_000,
        nowMs: NOW_MS,
        profile: developmentInstance.profile,
        buildId: developmentInstance.buildId,
        instance: developmentInstance
      })
    });

    const result = await resolveServerTarget({ ...fixture.options, fetch: health, nowMs: NOW_MS });

    expect(result).toMatchObject({
      status: "selected",
      target: {
        source: "profile-metadata",
        profile: developmentInstance.profile,
        instanceId: INSTANCE_ID,
        url: developmentInstance.url
      }
    });
    expect(health).toHaveBeenCalledTimes(1);
  });

  it("ignores a production loopback serverUrl when resolving a checkout profile", async () => {
    const fixture = await profileFixture("development");
    const productionConfig = join(fixture.homeDir, ".pi-postbox", "config.json");
    await mkdir(dirname(productionConfig), { recursive: true });
    await writeFile(productionConfig, '{"serverUrl":"http://127.0.0.1:32187"}\n');

    const result = await resolveServerTarget({
      ...fixture.options,
      fetch: healthFetch({}),
      nowMs: NOW_MS
    });

    expect(result).toMatchObject({ status: "unavailable", profile: fixture.profileIdentity });
  });

  it("rejects metadata whose health identity or protocol does not match", async () => {
    const fixture = await profileFixture("development");
    const instance = await writeMetadata(fixture.profile, 43123);
    const wrongInstance = { ...instance, instanceId: "22222222-2222-4222-8222-222222222222" };
    const health = healthFetch({
      [new URL("healthz", instance.url).toString()]: createHealthResponse({
        startedAtMs: NOW_MS - 1_000,
        nowMs: NOW_MS,
        profile: wrongInstance.profile,
        buildId: wrongInstance.buildId,
        instance: wrongInstance
      })
    });

    const result = await resolveServerTarget({ ...fixture.options, fetch: health, nowMs: NOW_MS });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "health-identity-mismatch" }));
  });

  it("rejects a symlinked profile metadata file without reading through it", async () => {
    const fixture = await profileFixture("development");
    await mkdir(dirname(fixture.profile.metadataPath), { recursive: true });
    const victim = join(fixture.root, "outside.json");
    await writeFile(victim, '{"secret":"do-not-read"}');
    await symlink(victim, fixture.profile.metadataPath);

    const result = await resolveServerTarget({ ...fixture.options, fetch: healthFetch({}), nowMs: NOW_MS });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(result.diagnostics).toContainEqual({ code: "symlink", source: "server.json" });
    expect(JSON.stringify(result)).not.toContain("do-not-read");
  });
});

async function profileFixture(kind: "production" | "development") {
  const root = await mkdtemp(join(tmpdir(), "pi-postbox-profile-resolver-"));
  tempDirs.push(root);
  const homeDir = join(root, "home");
  const stateHome = join(root, "state");
  const packageRoot = kind === "development"
    ? join(root, "checkout")
    : join(homeDir, ".pi/agent/npm/node_modules/@wienerberliner/pi-postbox");
  const cwd = kind === "development" ? join(packageRoot, "packages/extension") : join(root, "project");
  const env = { XDG_STATE_HOME: stateHome };
  const profile = resolveServerProfile({ packageRoot, cwd, homeDir, stateHome, env });
  const profileIdentity = { kind: profile.kind, id: profile.id } as ServerProfileIdentity;
  return {
    root,
    homeDir,
    stateHome,
    profile,
    profileIdentity,
    options: { packageRoot, cwd, homeDir, stateHome, env }
  };
}

async function writeMetadata(profile: ReturnType<typeof resolveServerProfile>, port: number): Promise<ServerInstanceIdentity> {
  const profileIdentity = { kind: profile.kind, id: profile.id } as ServerProfileIdentity;
  const instance: ServerInstanceIdentity = {
    profile: profileIdentity,
    instanceId: INSTANCE_ID,
    url: `http://127.0.0.1:${port}/`,
    protocolVersion: PROTOCOL_VERSION,
    buildId: "test-build"
  };
  await mkdir(dirname(profile.metadataPath), { recursive: true });
  await writeFile(profile.metadataPath, JSON.stringify({
    version: SERVER_PROFILE_METADATA_VERSION,
    ...instance,
    updatedAt: new Date(NOW_MS).toISOString()
  }));
  return instance;
}

function healthFetch(responses: Record<string, unknown | Error>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const value = responses[url];
    if (value === undefined) throw new Error(`Unexpected health probe ${url}`);
    if (value instanceof Error) throw value;
    return Response.json(value);
  });
}
