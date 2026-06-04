import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
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

    expect(docs).toContain("PI_POSTBOX_URL");
    expect(docs).toContain("~/.pi-postbox/config.json");
    expect(docs).toContain("generated machine id");
    expect(docs).toContain("Tailscale-only");
    expect(docs).toContain("no app-level authentication");
    expect(docs).toContain("lizardtail");
    expect(docs).toContain("lizardtail postbox");
    expect(docs).toContain("/healthz");
    expect(docs).toContain("/api/state/events");
    expect(docs).toContain("npm run smoke");
    expect(docs).toContain("pi-postbox-server");
    expect(docs).toContain("pi install");
  });
});
