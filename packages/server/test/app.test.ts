import { HealthResponseSchema, PROTOCOL_VERSION, type ServerInstanceIdentity } from "@pi-postbox/protocol";
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
      protocolVersion: PROTOCOL_VERSION,
      uptimeMs: 2_345
    });
    expect(health.profile).toEqual({ kind: "production", id: "production" });
    expect(health.instance).toBeUndefined();
    expect(response.headers["x-postbox-protocol-version"]).toBe(PROTOCOL_VERSION);
  });

  it("versions Android-facing API responses and rejects a foreign client before routing", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const current = await app.inject({ method: "GET", url: "/api/state" });
    expect(current.headers["x-postbox-protocol-version"]).toBe(PROTOCOL_VERSION);
    expect(current.json()).toMatchObject({ protocolVersion: PROTOCOL_VERSION });

    const incompatible = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { "x-postbox-client-protocol-version": "0.0.1" }
    });
    expect(incompatible.statusCode).toBe(426);
    expect(incompatible.headers["x-postbox-protocol-version"]).toBe(PROTOCOL_VERSION);
    expect(incompatible.json()).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      error: "incompatible_protocol",
      supportedProtocolVersion: PROTOCOL_VERSION,
      receivedProtocolVersion: "0.0.1"
    });
  });

  it("returns the current profile-scoped server identity after the CLI sets it", async () => {
    let serverInstance: ServerInstanceIdentity | undefined;
    const profile = { kind: "development" as const, id: "development:0123456789abcdef" };
    const app = await createPostboxApp({
      databasePath: ":memory:",
      profile,
      buildId: "test-build",
      serverInstance: () => serverInstance
    });
    apps.push(app);

    serverInstance = {
      profile,
      instanceId: "33333333-3333-4333-8333-333333333333",
      url: "http://127.0.0.1:32187/",
      protocolVersion: PROTOCOL_VERSION,
      buildId: "test-build"
    };

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).instance).toEqual(serverInstance);
  });

  it("prevents browsers and intermediaries from storing dynamic API responses", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const state = await app.inject({ method: "GET", url: "/api/state" });
    const history = await app.inject({ method: "GET", url: "/api/history" });

    expect(state.headers["cache-control"]).toBe("no-store");
    expect(history.headers["cache-control"]).toBe("no-store");
  });

  it("negotiates compression for eligible dynamic JSON responses", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", compressionThresholdBytes: 0 });
    apps.push(app);

    const compressed = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { "accept-encoding": "gzip" }
    });
    const identity = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { "accept-encoding": "identity" }
    });

    expect(compressed.headers["content-encoding"]).toBe("gzip");
    expect(identity.headers["content-encoding"]).toBeUndefined();
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
