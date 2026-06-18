import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("POST /admin/shutdown", () => {
  it("accepts a loopback request and fires the shutdown callback", async () => {
    let shutdownCalls = 0;
    const app = await createPostboxApp({ databasePath: ":memory:", onShutdownRequest: () => (shutdownCalls += 1) });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/admin/shutdown" });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "shutting_down" });

    // The callback is scheduled on the next tick so the 202 flushes first.
    await new Promise((resolve) => setImmediate(resolve));
    expect(shutdownCalls).toBe(1);
  });

  it("rejects requests that arrived through a reverse proxy", async () => {
    let shutdownCalls = 0;
    const app = await createPostboxApp({ databasePath: ":memory:", onShutdownRequest: () => (shutdownCalls += 1) });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/admin/shutdown",
      headers: { "x-forwarded-for": "100.64.0.1" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "forbidden_remote" });
    expect(shutdownCalls).toBe(0);
  });

  it("reports 501 when the server was started without shutdown support", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:" });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/admin/shutdown" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({ error: "shutdown_unavailable" });
  });
});
