import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function expectConcepts(text: string, concepts: string[]): void {
  for (const concept of concepts) {
    expect(text, `expected docs/script to mention ${concept}`).toContain(concept);
  }
}

describe("release packaging and operator docs", () => {
  it("exposes documented server and Pi extension package metadata", async () => {
    const root = await readJson("package.json");
    const server = await readJson("packages/server/package.json");
    const extension = await readJson("packages/extension/package.json");

    expect(root.scripts).toMatchObject({ smoke: expect.any(String) });
    expect(String((root.scripts as Record<string, unknown>).build)).toContain("copy-web-to-server.mjs");
    expect(root.pi).toMatchObject({ extensions: ["./packages/extension/src/index.ts"] });

    expect(server).toMatchObject({
      name: "@pi-postbox/server",
      bin: { "pi-postbox-server": "dist/cli.js" },
      files: expect.arrayContaining(["dist", "package.json"]),
      engines: { node: ">=22" }
    });

    expect(extension).toMatchObject({
      name: "@pi-postbox/extension",
      pi: { extensions: ["./src/index.ts"] },
      files: expect.arrayContaining(["src", "dist", "package.json"]),
      engines: { node: ">=22" }
    });
  });

  it("documents configuration, deployment boundary, endpoints, and manual smoke testing", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md")),
      readText(join("docs", "protocol.md"))
    ]).then((parts) => parts.join("\n"));

    expectConcepts(docs, [
      "PI_POSTBOX_URL",
      "~/.pi-postbox/config.json",
      "generated machine id",
      "Tailscale-only",
      "no app-level authentication",
      "lizardtail",
      "/healthz",
      "/api/state/events",
      "npm run smoke",
      "pi-postbox-server",
      "pi install"
    ]);
  });

  it("documents active-local routing, role configuration, and local diagnostics for operators", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md"))
    ]).then((parts) => parts.join("\n"));

    expectConcepts(docs, [
      "32187",
      "--active-local-role",
      "PI_POSTBOX_ACTIVE_LOCAL_ROLE",
      "active-local/dev.json",
      "active-local/production.json",
      "PI_POSTBOX_CONFIG_DIR",
      "PI_POSTBOX_CONFIG_PATH",
      "~/.pi-postbox",
      "dev over production",
      "production fallback",
      "stale",
      "unhealthy",
      "unsafe",
      "health mismatch",
      "no broad discovery",
      "port scanning"
    ]);
    expect(docs, "operator docs should not still describe 3000 as the preferred/default Postbox port").not.toMatch(
      /preferred default `3000`|preferred `3000`|prefers port `3000`|port `3000` by default/
    );
  });

  it("documents automatic Tailnet-private Serve exposure, safe opt-out, status, and explicit remote setup", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md"))
    ]).then((parts) => parts.join("\n"));

    expectConcepts(docs, [
      "automatic Tailnet-private",
      "Tailscale Serve",
      "--no-tailscale",
      "PI_POSTBOX_TAILSCALE=off",
      "non-clobbering",
      "conflict",
      "pi-postbox-server status",
      "status --json",
      "export PI_POSTBOX_URL=",
      "tailscale serve --bg --https"
    ]);
    expect(docs, "Postbox docs must not advertise an automatic public/Funnel command path").not.toMatch(
      /pi-postbox-server[^\n]*(--funnel|--public)|tailscale\s+funnel\s+--bg/i
    );
  });

  it("documents explicit remote authority plus live retargeting and origin affinity", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md")),
      readText(join("docs", "protocol.md"))
    ]).then((parts) => parts.join("\n"));

    expectConcepts(docs, [
      "explicit non-loopback",
      "PI_POSTBOX_URL",
      "Tailscale",
      "hosted",
      "authoritative",
      "not local recovery candidates",
      "live retargeting",
      "sent asks",
      "local fallback",
      "pin their origin",
      "bounded",
      "deferred switching"
    ]);
  });

  it("documents optional health local target identity and exact metadata matching", async () => {
    const protocol = await readText(join("docs", "protocol.md"));

    expectConcepts(protocol, ["/healthz", "localTarget", "optional", "active-local", "exact", "identity"]);
  });

  it("keeps the release smoke isolated from operator config and compatible with active-local health", async () => {
    const smoke = await readText(join("scripts", "smoke-postbox.mjs"));

    expect(smoke, "smoke must force active-local/config/machine-id writes into its temp directory").toContain("PI_POSTBOX_CONFIG_DIR");
    expect(smoke, "smoke should set PI_POSTBOX_CONFIG_DIR to its mkdtemp directory").toMatch(/PI_POSTBOX_CONFIG_DIR[\s\S]{0,120}tmp/);
    expect(smoke, "smoke must not mutate real operator Tailscale Serve state").toContain("--no-tailscale");
    expect(smoke, "smoke child environment must force Tailscale off").toMatch(/PI_POSTBOX_TAILSCALE[\s\S]{0,40}["']off["']/);
    expectConcepts(smoke, ["localTarget", "instanceId", "role", "url"]);
  });
});
