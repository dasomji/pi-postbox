import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function packagePath(value: unknown): string {
  expect(value, "expected package metadata path to be a string").toEqual(expect.any(String));
  return String(value).replace(/^\.\//, "");
}

type NpmPackDryRun = Array<{
  filename?: string;
  files?: Array<{ path?: string }>;
}>;

function parseNpmPackDryRun(stdout: string): NpmPackDryRun {
  const trimmed = stdout.trim();

  try {
    return JSON.parse(trimmed) as NpmPackDryRun;
  } catch {
    const jsonStart = trimmed.lastIndexOf("\n[");
    const candidate = jsonStart >= 0 ? trimmed.slice(jsonStart + 1) : trimmed;
    return JSON.parse(candidate) as NpmPackDryRun;
  }
}

async function readDryRunPackPaths(): Promise<string[]> {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000
  });
  const [pack] = parseNpmPackDryRun(String(stdout));
  return (pack.files ?? []).map((file) => String(file.path)).sort();
}

async function packToDirectory(packDestination: string): Promise<string> {
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000
  });
  const [pack] = parseNpmPackDryRun(String(stdout));
  expect(pack.filename, "npm pack should report the tarball filename").toEqual(expect.any(String));
  return join(packDestination, String(pack.filename));
}

function expectConcepts(text: string, concepts: string[]): void {
  for (const concept of concepts) {
    expect(text, `expected docs/script to mention ${concept}`).toContain(concept);
  }
}

describe("release packaging and operator docs", () => {
  it("exposes the combined public Pi package and shell CLI metadata", async () => {
    const root = await readJson("package.json");

    expect(root.scripts).toMatchObject({ smoke: expect.any(String) });
    expect(String((root.scripts as Record<string, unknown>).build)).toContain("copy-web-to-server.mjs");

    expect(root.name).toBe("@wienerberliner/pi-postbox");
    expect(root.private, "the public package must not be marked private").not.toBe(true);
    expect(root.keywords, "Pi package discovery uses the pi-package keyword").toEqual(
      expect.arrayContaining(["pi-package"])
    );
    expect(root.publishConfig, "the scoped package must publish publicly").toMatchObject({ access: "public" });

    const pi = root.pi as { extensions?: unknown[] } | undefined;
    expect(pi?.extensions?.map(packagePath)).toEqual(["packages/extension/src/index.ts"]);

    const bin = root.bin as Record<string, unknown> | undefined;
    expect(packagePath(bin?.["pi-postbox-server"])).toBe("packages/server/dist/cli.js");
    expect(root.dependencies).toMatchObject({ typebox: expect.any(String) });
  });

  it("packs the combined runtime without local Pi/cache/secret files", async () => {
    const paths = await readDryRunPackPaths();
    const requiredRuntimeFiles = [
      "README.md",
      "package.json",
      "packages/extension/package.json",
      "packages/extension/src/index.ts",
      "packages/protocol/package.json",
      "packages/protocol/dist/index.js",
      "node_modules/@pi-postbox/protocol/package.json",
      "node_modules/@pi-postbox/protocol/dist/index.js",
      "packages/server/package.json",
      "packages/server/dist/cli.js"
    ];
    const missingRequiredFiles = requiredRuntimeFiles.filter((path) => !paths.includes(path));
    const hasServerWebAssets = paths.some((path) => path.startsWith("packages/server/dist/public/"));
    const allowedBundledRuntimePrefixes = ["node_modules/@pi-postbox/protocol/", "node_modules/zod/"];
    const forbiddenFiles = paths.filter(
      (path) =>
        path.startsWith(".pi/") ||
        (path.startsWith("node_modules/") &&
          !allowedBundledRuntimePrefixes.some((prefix) => path.startsWith(prefix))) ||
        path.startsWith("tmp/") ||
        path === ".env" ||
        path.endsWith("/.env") ||
        path.endsWith("/.DS_Store")
    );

    expect(missingRequiredFiles).toEqual([]);
    expect(hasServerWebAssets, "server dashboard assets must be bundled beside the server CLI").toBe(true);
    expect(forbiddenFiles).toEqual([]);
  }, 120_000);

  it("resolves protocol imports and the CLI from a packed global install", async () => {
    const packDir = await mkdtemp(join(tmpdir(), "pi-postbox-pack-"));
    const installPrefix = await mkdtemp(join(tmpdir(), "pi-postbox-install-"));

    try {
      const tarballPath = await packToDirectory(packDir);
      await execFileAsync("npm", ["install", "--global", "--prefix", installPrefix, tarballPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          npm_config_audit: "false",
          npm_config_fund: "false"
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000
      });

      const packageRoot = join(installPrefix, "lib", "node_modules", "@wienerberliner", "pi-postbox");
      const cliPath = join(packageRoot, "packages", "server", "dist", "cli.js");
      const resolverPath = join(packageRoot, "packages", "server", "dist", "resolve-protocol-from-cli.mjs");
      const extensionDependencyResolverPath = join(packageRoot, "packages", "extension", "src", "resolve-typebox.mjs");
      await writeFile(
        resolverPath,
        'import { SERVICE_NAME } from "@pi-postbox/protocol";\nconsole.log(SERVICE_NAME);\n'
      );
      await writeFile(
        extensionDependencyResolverPath,
        'import { Type } from "typebox";\nconsole.log(typeof Type.Object);\n'
      );

      const { stdout: protocolStdout } = await execFileAsync(process.execPath, [resolverPath], { timeout: 30_000 });
      const { stdout: typeboxStdout } = await execFileAsync(process.execPath, [extensionDependencyResolverPath], { timeout: 30_000 });
      const binPath = join(installPrefix, "bin", "pi-postbox-server");
      const { stdout: binTargetStdout } = await execFileAsync(
        process.execPath,
        ["-e", "const fs = require('node:fs'); console.log(fs.realpathSync(process.argv[1]));", binPath],
        { timeout: 30_000 }
      );
      const { stdout: statusStdout } = await execFileAsync(binPath, ["status", "--json"], {
        env: {
          ...process.env,
          PI_POSTBOX_CONFIG_DIR: join(installPrefix, "config"),
          PI_POSTBOX_TAILSCALE: "off"
        },
        maxBuffer: 1024 * 1024,
        timeout: 30_000
      });

      expect(protocolStdout.trim()).toBe("pi-postbox");
      expect(typeboxStdout.trim()).toBe("function");
      expect(binTargetStdout.trim()).toBe(cliPath);
      expect(JSON.parse(statusStdout) as Record<string, unknown>).toMatchObject({ availability: "unavailable" });
    } finally {
      await rm(packDir, { recursive: true, force: true });
      await rm(installPrefix, { recursive: true, force: true });
    }
  }, 240_000);

  it("documents Pi package install separately from global shell CLI install", async () => {
    const docs = await readText("README.md");

    expect(docs).toContain("pi install npm:@wienerberliner/pi-postbox");
    expect(docs).toContain("npm install -g @wienerberliner/pi-postbox");
    expect(docs).toContain("pi-postbox-server");
    expect(docs, "Pi install docs must not promise a shell pi-postbox-server on PATH").not.toMatch(
      /pi install[^\n]*(pi-postbox-server|PATH)|(?:after|once|when)[^\n]*pi install[^\n]*(pi-postbox-server|PATH|shell)|pi-postbox-server[^\n]*(available|on PATH)[^\n]*pi install/i
    );
  });

  it("documents the combined package install shape without stale split-package guidance", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md")),
      readText(join("docs", "adr", "0003-combined-npm-package-and-package-local-autostart.md"))
    ]).then((parts) => parts.join("\n"));

    expect.soft(docs).toContain("pi install npm:@wienerberliner/pi-postbox");
    expect.soft(docs).toContain("npm install -g @wienerberliner/pi-postbox");
    expect.soft(
      docs,
      "Pi package install docs should say the public package installs Pi resources plus bundled/package-local autostart support"
    ).toMatch(/pi install npm:@wienerberliner\/pi-postbox[\s\S]{0,360}(Pi resources|extension resources)[\s\S]{0,360}(bundled|package-local|autostart)/i);
    expect.soft(
      docs,
      "manual shell CLI docs should keep npm global install distinct from pi install"
    ).toMatch(/npm install -g @wienerberliner\/pi-postbox[\s\S]{0,240}(manual shell|shell command|PATH|pi-postbox-server)/i);
    expect.soft(docs, "docs should no longer point users at the old internal extension package").not.toContain(
      "pi install npm:@pi-postbox/extension"
    );
    expect.soft(docs, "docs should no longer point users at the old internal server package").not.toContain(
      "npx @pi-postbox/server"
    );
  });

  it("documents autostart controls, default timeout, and preferred-server fallback stickiness", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md")),
      readText(join("docs", "protocol.md")),
      readText(join("docs", "adr", "0003-combined-npm-package-and-package-local-autostart.md"))
    ]).then((parts) => parts.join("\n"));

    expect.soft(docs).toContain("PI_POSTBOX_AUTOSTART=off");
    expect.soft(docs).toContain("PI_POSTBOX_AUTOSTART_TIMEOUT_MS");
    expect.soft(docs, "operator docs should state the default autostart wait is 10 seconds/10000ms").toMatch(
      /PI_POSTBOX_AUTOSTART_TIMEOUT_MS[\s\S]{0,220}(10\s*(?:seconds|secs|s)|10,?000|10000)/i
    );
    expect.soft(
      docs,
      "a configured Postbox URL should be documented as a preferred server that can fall back to package-local autostart when unreachable"
    ).toMatch(/preferred (?:Postbox )?server[\s\S]{0,360}(unreachable|unavailable|fails?)[\s\S]{0,360}(fallback|autostart|package-local)/i);
    expect.soft(
      docs,
      "docs should describe session stickiness after registering with a fallback/autostarted server"
    ).toMatch(/session[\s\S]{0,240}(sticky|stickiness|remains attached|stays attached)[\s\S]{0,240}(reload|restart)/i);
    expect.soft(
      docs,
      "old absolute-authority wording contradicts the preferred-server fallback contract"
    ).not.toMatch(/explicit non-loopback[\s\S]{0,360}(authoritative|disables local recovery|not local recovery candidates)/i);
  });

  it("documents status surfaces, /postbox browser opening, and privacy boundaries", async () => {
    const docs = await Promise.all([
      readText("README.md"),
      readText(join("docs", "configuration.md")),
      readText(join("docs", "deployment.md")),
      readText(join("docs", "protocol.md"))
    ]).then((parts) => parts.join("\n"));

    expect.soft(docs).toContain("/postbox-status");
    expect.soft(docs).toContain("postbox_status");
    expect.soft(docs, "postbox_status should be documented as read-only/privacy-preserving status, not a question dump").toMatch(
      /postbox_status[\s\S]{0,320}(read-only|read only|privacy-preserving|open-question count|pending question contents)/i
    );
    expect.soft(docs, "operator docs should document the exact user-only /postbox command").toMatch(
      /(?:^|[\s`])\/postbox(?:[\s`]|$)/
    );
    expect.soft(docs, "/postbox should be described as opening the dashboard/browser for the user").toMatch(
      /(?:^|[\s`])\/postbox(?:[\s`]|$)[\s\S]{0,280}(open|browser|dashboard)/i
    );
    expect.soft(
      docs,
      "docs should state browser-opening is user-only/manual and not exposed as an LLM/tool side effect"
    ).toMatch(/(?:^|[\s`])\/postbox(?:[\s`]|$)[\s\S]{0,420}(user-only|manual|not available to tools|not exposed to tools|LLM|agent|browser-opening)/i);
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
