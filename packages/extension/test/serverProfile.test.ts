import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerProfile } from "../src/serverProfile.js";

const homeDir = "/home/alice";
const stateHome = "/home/alice/.local/state";

describe("server profile resolution", () => {
  it("uses a checkout-scoped development profile when Pi loaded the package inside that checkout", () => {
    const packageRoot = "/work/pi-postbox";
    const profile = resolveServerProfile({ packageRoot, cwd: "/work/pi-postbox/packages/server", homeDir, stateHome });

    expect(profile).toMatchObject({
      kind: "development",
      origin: "local-checkout",
      packageRoot,
      id: expect.stringMatching(/^development:[a-f0-9]{16}$/),
      stateDir: expect.stringMatching(/^\/home\/alice\/\.local\/state\/pi-postbox\/dev\/[a-f0-9]{16}$/)
    });
    expect(profile.databasePath).toBe(join(profile.stateDir, "postbox.sqlite"));
    expect(profile.metadataPath).toBe(join(profile.stateDir, "active-local", "server.json"));
    expect(profile.logPath).toBe(join(profile.stateDir, "server.log"));
  });

  it("uses production for a package loaded from Pi's npm cache", () => {
    const packageRoot = "/home/alice/.pi/agent/npm/node_modules/@wienerberliner/pi-postbox";
    expect(resolveServerProfile({ packageRoot, cwd: "/work/project", homeDir, stateHome })).toEqual({
      kind: "production",
      origin: "npm",
      id: "production",
      stateDir: "/home/alice/.pi-postbox",
      configPath: "/home/alice/.pi-postbox/config.json",
      databasePath: "/home/alice/.pi-postbox/postbox.sqlite",
      metadataPath: "/home/alice/.pi-postbox/active-local/server.json",
      logPath: "/home/alice/.pi-postbox/server.log"
    });
  });

  it("uses production for a package loaded from Pi's git cache even though that package is a checkout", () => {
    const packageRoot = "/home/alice/.pi/agent/git/github.com/acme/pi-postbox";
    expect(resolveServerProfile({ packageRoot, cwd: "/work/project", homeDir, stateHome })).toMatchObject({
      kind: "production",
      origin: "git",
      id: "production",
      stateDir: "/home/alice/.pi-postbox"
    });
  });

  it("gives separate canonical checkouts stable, distinct development identities", () => {
    const first = resolveServerProfile({ packageRoot: "/work/postbox-a", cwd: "/work/postbox-a", homeDir, stateHome });
    const same = resolveServerProfile({
      packageRoot: "/work/../work/postbox-a",
      cwd: "/work/postbox-a/apps/web",
      homeDir,
      stateHome
    });
    const second = resolveServerProfile({ packageRoot: "/work/postbox-b", cwd: "/work/postbox-b", homeDir, stateHome });

    expect(same.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect(second.stateDir).not.toBe(first.stateDir);
  });

  it("does not classify an arbitrary git checkout as development outside its package root", () => {
    expect(resolveServerProfile({
      packageRoot: "/work/pi-postbox",
      cwd: "/work/unrelated-project",
      homeDir,
      stateHome
    })).toMatchObject({ kind: "production", origin: "distributed", id: "production" });
  });
});
