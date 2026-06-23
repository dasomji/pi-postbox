import { describe, expect, it } from "vitest";

type ActiveLocalModule = {
  normalizeActiveLocalMetadataUrl: (input: string) => unknown;
  parseActiveLocalMetadataRecord: (input: string, options: Record<string, unknown>) => unknown;
  selectActiveLocalTarget: (records: unknown[], options: Record<string, unknown>) => unknown;
};

const NOW_MS = Date.parse("2026-06-23T12:00:00.000Z");
const FRESH_ISO = new Date(NOW_MS - 1_000).toISOString();
const STALE_ISO = new Date(NOW_MS - 120_000).toISOString();
const DEV_INSTANCE_ID = "550e8400-e29b-41d4-a716-446655440000";
const PROD_INSTANCE_ID = "550e8400-e29b-41d4-a716-446655440001";

async function loadActiveLocal(): Promise<ActiveLocalModule> {
  const protocol = (await import("./index.js")) as Record<string, unknown>;
  const requiredExports = [
    "normalizeActiveLocalMetadataUrl",
    "parseActiveLocalMetadataRecord",
    "selectActiveLocalTarget"
  ];

  for (const exportName of requiredExports) {
    if (typeof protocol[exportName] !== "function") {
      throw new Error(`Expected packages/protocol index to export active-local helper ${exportName}`);
    }
  }

  return protocol as ActiveLocalModule;
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    role: "production",
    url: "http://127.0.0.1:32187/",
    instanceId: PROD_INSTANCE_ID,
    updatedAt: FRESH_ISO,
    ...overrides
  };
}

async function parseRecord(record: Record<string, unknown>, expectedRole = String(record.role ?? "production")) {
  const activeLocal = await loadActiveLocal();
  const result = activeLocal.parseActiveLocalMetadataRecord(JSON.stringify(record), {
    expectedRole,
    nowMs: NOW_MS,
    ttlMs: 30_000,
    source: `/home/dev/.pi-postbox/active-local/${expectedRole}.json`
  }) as { ok: boolean; record?: unknown; diagnostics?: unknown[] };

  if (!result.ok) {
    throw new Error(`Expected metadata record to parse but got ${JSON.stringify(result.diagnostics)}`);
  }

  return result.record;
}

describe("active-local loopback URL contract", () => {
  it("accepts only safe numeric loopback HTTP(S) metadata URLs", async () => {
    const { normalizeActiveLocalMetadataUrl } = await loadActiveLocal();

    expect(normalizeActiveLocalMetadataUrl("http://127.0.0.1:32187")).toMatchObject({
      ok: true,
      url: "http://127.0.0.1:32187/",
      host: "127.0.0.1",
      port: 32187
    });
    expect(normalizeActiveLocalMetadataUrl("https://127.42.0.1:4443/")).toMatchObject({
      ok: true,
      url: "https://127.42.0.1:4443/",
      host: "127.42.0.1",
      port: 4443
    });
    expect(normalizeActiveLocalMetadataUrl("http://[::1]:32187")).toMatchObject({
      ok: true,
      url: "http://[::1]:32187/",
      host: "::1",
      port: 32187
    });
  });

  it("rejects remote, Tailscale, LAN, hostname, ambiguous, and smuggled metadata URLs", async () => {
    const { normalizeActiveLocalMetadataUrl } = await loadActiveLocal();
    const rejectedUrls = [
      "http://localhost:32187",
      "http://localhost.:32187",
      "http://postbox.local:32187",
      "https://workstation.tailnet.ts.net:32187",
      "http://workstation:32187",
      "http://0.0.0.0:32187",
      "http://192.168.1.20:32187",
      "http://10.0.0.10:32187",
      "http://172.16.0.10:32187",
      "http://100.64.0.1:32187",
      "http://[fe80::1]:32187",
      "http://[::ffff:127.0.0.1]:32187",
      "http://2130706433:32187",
      "http://0177.0.0.1:32187",
      "http://0x7f.0.0.1:32187",
      "ftp://127.0.0.1:32187",
      "http://user:password@127.0.0.1:32187",
      "http://127.0.0.1:32187/api",
      "http://127.0.0.1:32187/?token=secret",
      "http://127.0.0.1:32187/#fragment",
      "http://127.0.0.1.evil.example:32187",
      "http://127.0.0.1:32187@evil.example"
    ];

    for (const url of rejectedUrls) {
      expect(normalizeActiveLocalMetadataUrl(url), url).toMatchObject({ ok: false });
    }
  });
});

describe("active-local metadata parsing", () => {
  it("parses a bounded, fresh role-scoped metadata record", async () => {
    const { parseActiveLocalMetadataRecord } = await loadActiveLocal();

    expect(
      parseActiveLocalMetadataRecord(JSON.stringify(metadata()), {
        expectedRole: "production",
        nowMs: NOW_MS,
        ttlMs: 30_000,
        source: "/home/dev/.pi-postbox/active-local/production.json"
      })
    ).toMatchObject({
      ok: true,
      record: {
        version: 1,
        role: "production",
        url: "http://127.0.0.1:32187/",
        instanceId: PROD_INSTANCE_ID,
        updatedAt: FRESH_ISO
      }
    });
  });

  it("rejects too-large and malformed records without exposing raw metadata", async () => {
    const { parseActiveLocalMetadataRecord } = await loadActiveLocal();
    const tooLarge = `${"{"}${"x".repeat(2_048)}`;

    const result = parseActiveLocalMetadataRecord(tooLarge, {
      expectedRole: "dev",
      nowMs: NOW_MS,
      ttlMs: 30_000,
      maxBytes: 1_024,
      source: "/home/dev/.pi-postbox/active-local/dev.json"
    }) as { ok: boolean; diagnostics?: unknown[] };

    expect(result).toMatchObject({ ok: false });
    const diagnostics = JSON.stringify(result.diagnostics ?? []);
    expect(diagnostics).toMatch(/too-large|too_large|size/i);
    expect(diagnostics).not.toContain(tooLarge.slice(0, 128));
    expect(diagnostics).not.toContain("/home/dev/.pi-postbox");
  });

  it("rejects malformed role, timestamp, instance id, and unsafe URL fields", async () => {
    const { parseActiveLocalMetadataRecord } = await loadActiveLocal();
    const invalidRecords = [
      metadata({ role: "staging" }),
      metadata({ role: "dev" }),
      metadata({ updatedAt: "not-a-date" }),
      metadata({ updatedAt: new Date(NOW_MS + 5_000).toISOString() }),
      metadata({ instanceId: "not-generated" }),
      metadata({ instanceId: undefined }),
      metadata({ url: "https://workstation.tailnet.ts.net:32187" }),
      metadata({ url: "http://127.0.0.1:32187/?token=secret#fragment" })
    ];

    for (const record of invalidRecords) {
      const result = parseActiveLocalMetadataRecord(JSON.stringify(record), {
        expectedRole: "production",
        nowMs: NOW_MS,
        ttlMs: 30_000,
        source: "/home/dev/.pi-postbox/active-local/production.json"
      });
      expect(result, JSON.stringify(record)).toMatchObject({ ok: false });
    }
  });

  it("returns sanitized diagnostics for rejected metadata", async () => {
    const { parseActiveLocalMetadataRecord } = await loadActiveLocal();
    const rawMetadata = JSON.stringify(
      metadata({
        url: "http://user:super-secret@127.0.0.1:32187/?token=abc123#frag",
        extra: "raw metadata should not be echoed"
      })
    );

    const result = parseActiveLocalMetadataRecord(rawMetadata, {
      expectedRole: "production",
      nowMs: NOW_MS,
      ttlMs: 30_000,
      source: "/home/dev/.pi-postbox/active-local/production.json"
    }) as { ok: boolean; diagnostics?: unknown[] };

    expect(result).toMatchObject({ ok: false });
    const diagnostics = JSON.stringify(result.diagnostics ?? []);
    expect(diagnostics).toContain("production");
    expect(diagnostics).not.toContain("/home/dev/.pi-postbox");
    expect(diagnostics).not.toContain("super-secret");
    expect(diagnostics).not.toContain("abc123");
    expect(diagnostics).not.toContain("#frag");
    expect(diagnostics).not.toContain("raw metadata should not be echoed");
    expect(diagnostics).not.toContain(rawMetadata);
  });
});

describe("active-local deterministic role selection", () => {
  it("prefers fresh dev over fresh production", async () => {
    const { selectActiveLocalTarget } = await loadActiveLocal();
    const dev = await parseRecord(metadata({ role: "dev", url: "http://127.0.0.1:3500/", instanceId: DEV_INSTANCE_ID }), "dev");
    const production = await parseRecord(metadata(), "production");

    expect(selectActiveLocalTarget([production, dev], { nowMs: NOW_MS, ttlMs: 30_000 })).toMatchObject({
      target: { role: "dev", url: "http://127.0.0.1:3500/", instanceId: DEV_INSTANCE_ID }
    });
  });

  it("selects fresh production when dev is stale", async () => {
    const { selectActiveLocalTarget } = await loadActiveLocal();
    const staleDev = await parseRecord(
      metadata({ role: "dev", url: "http://127.0.0.1:3500/", instanceId: DEV_INSTANCE_ID, updatedAt: STALE_ISO }),
      "dev"
    );
    const production = await parseRecord(metadata(), "production");

    expect(selectActiveLocalTarget([staleDev, production], { nowMs: NOW_MS, ttlMs: 30_000 })).toMatchObject({
      target: { role: "production", url: "http://127.0.0.1:32187/", instanceId: PROD_INSTANCE_ID },
      diagnostics: expect.arrayContaining([expect.objectContaining({ role: "dev" })])
    });
  });

  it("returns no selected target and sanitized stale diagnostics when all records are stale", async () => {
    const { selectActiveLocalTarget } = await loadActiveLocal();
    const staleDev = await parseRecord(
      metadata({ role: "dev", url: "http://127.0.0.1:3500/", instanceId: DEV_INSTANCE_ID, updatedAt: STALE_ISO }),
      "dev"
    );
    const staleProduction = await parseRecord(metadata({ updatedAt: STALE_ISO }), "production");

    const result = selectActiveLocalTarget([staleProduction, staleDev], { nowMs: NOW_MS, ttlMs: 30_000 }) as {
      target?: unknown;
      diagnostics?: unknown[];
    };

    expect(result).toMatchObject({ target: undefined });
    const diagnostics = JSON.stringify(result.diagnostics ?? []);
    expect(diagnostics).toMatch(/stale/i);
    expect(diagnostics).toContain("dev");
    expect(diagnostics).toContain("production");
    expect(diagnostics).not.toContain("/home/dev");
  });
});
