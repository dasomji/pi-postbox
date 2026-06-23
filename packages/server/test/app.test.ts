import { HealthResponseSchema, type ActiveLocalTargetIdentity } from "@pi-postbox/protocol";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Pi Postbox server bootstrap", () => {
  it("returns a health response that matches the shared protocol schema", async () => {
    const app = await createPostboxApp({ startedAtMs: 10_000, now: () => 12_345, databasePath: ":memory:" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    const health = HealthResponseSchema.parse(response.json());
    expect(health).toMatchObject({
      ok: true,
      service: "pi-postbox",
      protocolVersion: "0.1.0",
      uptimeMs: 2_345
    });
    expect(health.localTarget).toBeUndefined();
  });

  it("returns the current active-local identity from health after the CLI sets it", async () => {
    let localTarget: ActiveLocalTargetIdentity | undefined;
    const app = await createPostboxApp({
      databasePath: ":memory:",
      localTarget: () => localTarget
    } as Parameters<typeof createPostboxApp>[0] & { localTarget: () => ActiveLocalTargetIdentity | undefined });
    apps.push(app);

    localTarget = {
      role: "dev",
      instanceId: "33333333-3333-4333-8333-333333333333",
      url: "http://127.0.0.1:32187/"
    };

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).localTarget).toEqual(localTarget);
  });

  it("serves the built UI shell from a static dist directory", async () => {
    const uiDistDir = await mkdtemp(join(tmpdir(), "pi-postbox-ui-"));
    await writeFile(
      join(uiDistDir, "index.html"),
      '<!doctype html><html><head><title>Pi Postbox</title></head><body><div id="root">Pi Postbox UI shell</div></body></html>'
    );
    const app = await createPostboxApp({ uiDistDir, databasePath: ":memory:" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Pi Postbox UI shell");
  });

  it("accepts a relative UI dist directory like the CLI default", async () => {
    const relativeUiDistDir = "tmp/pi-postbox-relative-ui-test";
    await rm(relativeUiDistDir, { recursive: true, force: true });
    await mkdir(relativeUiDistDir, { recursive: true });
    await writeFile(join(relativeUiDistDir, "index.html"), "<html><body>Relative Pi Postbox shell</body></html>");
    const app = await createPostboxApp({ uiDistDir: relativeUiDistDir, databasePath: ":memory:" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Relative Pi Postbox shell");

    await rm(relativeUiDistDir, { recursive: true, force: true });
  });
});
