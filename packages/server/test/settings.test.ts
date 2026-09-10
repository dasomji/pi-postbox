import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

it("shares saved defaults between devices, rejects stale writes, and survives restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "postbox-settings-"));
  const options = { databasePath: join(directory, "db.sqlite"), expirySweepMs: 0 };
  let app = await createPostboxApp(options);
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(initial).toMatchObject({ revision: 0, chat: { model: null, effort: "medium" } });
    const saved = await app.inject({ method: "PUT", url: "/api/settings", payload: {
      revision: 0, chat: { model: "test/model", effort: "high" }
    } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/settings" })).json()).toEqual(saved.json());
    expect((await app.inject({ method: "PUT", url: "/api/settings", payload: {
      revision: 0, chat: { model: null, effort: "off" }
    } })).statusCode).toBe(409);
    await app.close();
    app = await createPostboxApp(options);
    expect((await app.inject({ method: "GET", url: "/api/settings" })).json()).toEqual(saved.json());
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("validates settings and rejects cross-origin mutations without changing defaults", async () => {
  const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
  try {
    for (const chat of [{model: "not-a-model-id", effort: "high"}, {model: null, effort: "invented"}]) {
      expect((await app.inject({ method: "PUT", url: "/api/settings", payload: {revision: 0, chat} })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url: "/api/settings", headers: { origin: "https://elsewhere.example" },
      payload: {revision: 0, chat: {model: null, effort: "low"}} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/settings" })).json().revision).toBe(0);
  } finally { await app.close(); }
});

it("reloads Pi's available model catalog for each settings-page request", async () => {
  let models = [{id: "test/current", name: "Current"}];
  let fail = false;
  const app = await createPostboxApp({databasePath: ":memory:", expirySweepMs: 0,
    loadChatModels: async () => { if (fail) throw new Error("private credential detail"); return {models}; }});
  try {
    const first = await app.inject({method: "GET", url: "/api/settings/models"});
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json().models).toEqual(models);
    models = [];
    expect((await app.inject({method: "GET", url: "/api/settings/models"})).json().models).toEqual([]);
    fail = true;
    const unavailable = await app.inject({method: "GET", url: "/api/settings/models"});
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("private credential detail");
  } finally { await app.close(); }
});
