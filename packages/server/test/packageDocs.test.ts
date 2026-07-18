import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
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

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(entry.name.endsWith(".ts") ? [path] : []);
  }));
  return nested.flat().sort();
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
  it("routes every packed extension protocol import through the published package entrypoint", async () => {
    const files = await sourceFiles(join("packages", "extension", "src"));
    const sources = await Promise.all(files.map(async (path) => ({ path, text: await readText(path) })));
    const workspaceRelativeImports = sources.filter(({ text }) => /(?:\.\.\/)+protocol\/src\//.test(text));

    expect(workspaceRelativeImports.map(({ path }) => path)).toEqual([]);
    expect(sources.some(({ text }) => text.includes('from "@pi-postbox/protocol"'))).toBe(true);
  });

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
    expect(root.dependencies).toMatchObject({
      "@earendil-works/pi-coding-agent": "0.80.10",
      "@pi-postbox/protocol": "file:packages/protocol",
      typebox: expect.any(String)
    });
  });

  it("packs the combined runtime without local Pi/cache/secret files", async () => {
    const paths = await readDryRunPackPaths();
    const requiredRuntimeFiles = [
      "README.md",
      "package.json",
      "packages/extension/package.json",
      "packages/extension/src/index.ts",
      "packages/extension/src/questionChatRuntime.ts",
      "packages/extension/src/repositoryEvidenceTools.ts",
      "packages/extension/src/proposeAnswerTool.ts",
      "packages/protocol/package.json",
      "packages/protocol/dist/index.js",
      "packages/protocol/dist/chat.js",
      "packages/protocol/dist/ws.js",
      "packages/server/package.json",
      "packages/server/dist/cli.js",
      "packages/server/dist/routes/requestRoutes.js",
      "packages/server/dist/services/questionChatRelay.js",
      "packages/server/dist/public/index.html",
      "packages/server/dist/public/manifest.webmanifest",
      "packages/server/dist/public/sw.js",
      "packages/server/dist/public/icons/postbox-icon-192.png",
      "packages/server/dist/public/icons/postbox-icon-512.png"
    ];
    const missingRequiredFiles = requiredRuntimeFiles.filter((path) => !paths.includes(path));
    const hasServerWebAssets = paths.some((path) => path.startsWith("packages/server/dist/public/"));
    const hasBuiltQuestionChatJavaScript = paths.some((path) => /^packages\/server\/dist\/public\/assets\/[^/]+\.js$/.test(path));
    const hasBuiltQuestionChatCss = paths.some((path) => /^packages\/server\/dist\/public\/assets\/[^/]+\.css$/.test(path));
    const forbiddenFiles = paths.filter(
      (path) =>
        path.startsWith(".pi/") ||
        path.startsWith("node_modules/") ||
        path.startsWith("tmp/") ||
        path === ".env" ||
        path.endsWith("/.env") ||
        path.endsWith("/.DS_Store")
    );

    expect(missingRequiredFiles).toEqual([]);
    expect(hasServerWebAssets, "server dashboard assets must be bundled beside the server CLI").toBe(true);
    expect(hasBuiltQuestionChatJavaScript, "the packed dashboard must include its hashed JavaScript asset").toBe(true);
    expect(hasBuiltQuestionChatCss, "the packed dashboard must include its hashed CSS asset").toBe(true);
    expect(forbiddenFiles).toEqual([]);
  }, 120_000);

  it("resolves protocol imports and the CLI from a packed global install", async () => {
    const packDir = await mkdtemp(join(tmpdir(), "pi-postbox-pack-"));
    const installPrefix = await mkdtemp(join(tmpdir(), "pi-postbox-install-"));

    try {
      const tarballPath = await packToDirectory(packDir);
      await execFileAsync("npm", ["install", "--global", "--prefix", installPrefix, tarballPath], {
        cwd: installPrefix,
        env: {
          ...process.env,
          NODE_PATH: undefined,
          npm_config_audit: "false",
          npm_config_fund: "false"
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000
      });

      const packageRoot = join(installPrefix, "lib", "node_modules", "@wienerberliner", "pi-postbox");
      expect(await realpath(join(packageRoot, "node_modules", "@pi-postbox", "protocol"))).toBe(
        await realpath(join(packageRoot, "packages", "protocol"))
      );
      const cliPath = join(packageRoot, "packages", "server", "dist", "cli.js");
      const resolverPath = join(packageRoot, "packages", "server", "dist", "resolve-protocol-from-cli.mjs");
      const extensionDependencyResolverPath = join(packageRoot, "packages", "extension", "src", "resolve-question-chat-runtime.mjs");
      await writeFile(
        resolverPath,
        'import { SERVICE_NAME } from "@pi-postbox/protocol";\nconsole.log(SERVICE_NAME);\n'
      );
      await writeFile(
        extensionDependencyResolverPath,
        [
          'import { DefaultResourceLoader, SessionManager, SettingsManager, createAgentSession, defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";',
          'import { QuestionChatSnapshotSchema } from "@pi-postbox/protocol";',
          'import { Type } from "typebox";',
          'const session = SessionManager.inMemory("/tmp/packed-question-chat");',
          'const settings = SettingsManager.inMemory();',
          'const loader = new DefaultResourceLoader({ cwd: session.getCwd(), agentDir: getAgentDir(), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });',
          'const tool = defineTool({ name: "packed_probe", label: "Packed probe", description: "Packed probe", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "ok" }] }; } });',
          'const snapshot = QuestionChatSnapshotSchema.parse({ requestId: "packed-chat", state: "ready", forkKind: "exact", model: { id: "test/model", source: "originating" }, sequence: 0, messages: [], tools: [] });',
          'console.log(JSON.stringify({ cwd: session.getCwd(), settings: settings.isProjectTrusted(), loader: loader.constructor.name, createAgentSession: typeof createAgentSession, tool: tool.name, requestId: snapshot.requestId }));',
          ""
        ].join("\n")
      );

      const { stdout: protocolStdout } = await execFileAsync(process.execPath, [resolverPath], { timeout: 30_000 });
      const { stdout: runtimeStdout } = await execFileAsync(process.execPath, [extensionDependencyResolverPath], {
        env: { ...process.env, NODE_PATH: undefined },
        timeout: 30_000
      });
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
      expect(JSON.parse(runtimeStdout) as Record<string, unknown>).toEqual({
        cwd: "/tmp/packed-question-chat",
        settings: true,
        loader: "DefaultResourceLoader",
        createAgentSession: "function",
        tool: "packed_probe",
        requestId: "packed-chat"
      });
      expect(binTargetStdout.trim()).toBe(cliPath);
      expect(JSON.parse(statusStdout) as Record<string, unknown>).toMatchObject({ availability: "unavailable" });

      const publicRoot = join(packageRoot, "packages", "server", "dist", "public");
      const html = await readText(join(publicRoot, "index.html"));
      const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]!);
      expect(assetPaths.some((path) => path.endsWith(".js"))).toBe(true);
      expect(assetPaths.some((path) => path.endsWith(".css"))).toBe(true);
      const assets = await Promise.all(assetPaths.map((path) => readText(join(publicRoot, path.slice(1)))));
      const browserJavaScript = assets.find((_, index) => assetPaths[index]!.endsWith(".js")) ?? "";
      expect(browserJavaScript).toContain("Elaborate");
      expect(browserJavaScript).toContain("Pro–Cons");
      expect(browserJavaScript).toContain("Teach me");
      expect(await readText(join(publicRoot, "manifest.webmanifest"))).toContain("Pi Postbox");
      expect(await readText(join(publicRoot, "sw.js"))).toContain("fetch");
      expect((await readFile(join(publicRoot, "icons", "postbox-icon-192.png"))).byteLength).toBeGreaterThan(0);
      expect((await readFile(join(publicRoot, "icons", "postbox-icon-512.png"))).byteLength).toBeGreaterThan(0);
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

  it("documents the complete user-facing Question Chat workflow and lifecycle", async () => {
    const readme = await readText("README.md");

    expect(readme).toContain("## Question Chat");
    expectConcepts(readme, [
      "Elaborate",
      "Pro–Cons",
      "Teach me",
      "freeform",
      "exact fork",
      "context-only",
      "Suggested in Chat",
      "Retry",
      "Stop",
      "/reload",
      "/new",
      "/resume",
      "/fork",
      "repository_read",
      "repository_grep",
      "repository_find",
      "repository_list"
    ]);
    expect.soft(readme, "Chat must be described as an explicit user action with no automatic model turn").toMatch(
      /Question Chat[\s\S]{0,900}(explicit|click|choose)[\s\S]{0,420}(does not|without|no)(?: start (?:an? )?)?automatic (?:model )?(?:prompt|turn|response)/i
    );
    expect.soft(readme, "terminal answer/cancel/expiry and Pi Session replacement must delete the private transcript").toMatch(
      /(answer|answered)[\s\S]{0,300}cancel[\s\S]{0,300}expir[\s\S]{0,420}(replacement|\/new|\/resume|\/fork)[\s\S]{0,420}(delete|remove)/i
    );
    expect.soft(readme, "resolved History must retain proposed options but not the Chat transcript").toMatch(
      /History[\s\S]{0,420}(Suggested in Chat|proposed option)[\s\S]{0,420}(no|not|without)[\s\S]{0,160}(Chat transcript|conversation)/i
    );
  });

  it("documents the public Question Chat browser, SSE, and extension relay protocol", async () => {
    const protocol = await readText(join("docs", "protocol.md"));

    expectConcepts(protocol, [
      "POST /api/requests/:requestId/chat",
      "POST /api/requests/:requestId/chat/context",
      "GET /api/requests/:requestId/chat",
      "POST /api/requests/:requestId/chat/messages",
      "POST /api/requests/:requestId/chat/stop",
      "GET /api/requests/:requestId/chat/events",
      "clientCommandId",
      "requestId",
      "chat.activate",
      "chat.activate-context",
      "chat.ready",
      "chat.snapshot",
      "chat.send",
      "chat.send.accepted",
      "chat.stop",
      "chat.stop.accepted",
      "chat.cleanup",
      "chat.error",
      "chat.event",
      "chat.propose-answer",
      "chat.propose-answer.result",
      "chat.recover.offer",
      "chat.reconcile",
      "chat.reconciled",
      "chat.recover.complete",
      "forbidden_origin",
      "rate_limited",
      "duplicate_command",
      "wrong_owner",
      "request_not_pending",
      "extension_offline",
      "command_timeout",
      "codebaseContext",
      "problemContext",
      "provenance: \"chat\""
    ]);
    expect.soft(protocol, "the SSE contract should distinguish the initial snapshot from incremental Chat events").toMatch(
      /(initial|normalized) snapshot[\s\S]{0,500}chat\/events[\s\S]{0,300}(event|incremental)/i
    );
    expect.soft(protocol, "relay results and errors must document request-id correlation").toMatch(
      /requestId[\s\S]{0,500}(correlat|matching)[\s\S]{0,500}(result|accepted|error)/i
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

  it("documents the Question Chat security consequence of Tailnet access", async () => {
    const deployment = await readText(join("docs", "deployment.md"));

    expectConcepts(deployment, [
      "Tailscale-only",
      "no app-level authentication",
      "model spend",
      "scoped read-only repository evidence",
      "bounded custom read/grep/find/list tools",
      "no shell or mutation tools"
    ]);
    expect(deployment, "Tailnet reachability must be described as permission to use the bounded Chat capability").toMatch(
      /Tailnet reachability[\s\S]{0,240}(permission|trusted)[\s\S]{0,240}(bounded|repository|model)/i
    );
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

  it("makes the release smoke exercise packaged Question Chat UI and privacy invariants", async () => {
    const smoke = await readText(join("scripts", "smoke-postbox.mjs"));

    expectConcepts(smoke, [
      "expectNoMessage",
      "manifest.webmanifest",
      "postbox-icon-192.png",
      "Elaborate",
      "Pro–Cons",
      "Teach me",
      "privateAssistantText",
      "privateRepositoryTarget",
      "privateRepositoryDetails",
      "privateToolCallId",
      "privateMarkers"
    ]);
    expect.soft(smoke, "the smoke should discover built hashed assets from the served HTML").toMatch(
      /html[\s\S]{0,1000}matchAll[\s\S]{0,500}assets[\s\S]{0,200}js\|css/
    );
    expect.soft(smoke, "the smoke should prove Chat activation alone emits no automatic runtime command").toMatch(
      /chat\.ready[\s\S]{0,700}expectNoMessage/
    );
    expect.soft(smoke, "every private marker should be rejected from both state and history").toMatch(
      /privateMarkers[\s\S]{0,500}(state|stateJson)[\s\S]{0,1000}(history|historyJson)/
    );
  });
});
