import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const fixedPortServers: Server[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function getFreeLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!address || typeof address === "string") throw new Error("failed to allocate local port");
  return address.port;
}

async function occupyPortIfFree(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve();
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      fixedPortServers.push(server);
      resolve();
    });
  });
}

type Invocation = { command: string; args: string[]; postboxDevApiPort?: string; postboxDevWebPort?: string };

function findArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function devWebPort(invocation: Invocation | undefined): number | undefined {
  const portText = invocation?.postboxDevWebPort ?? findArgValue(invocation?.args ?? [], "--port");
  return portText ? Number(portText) : undefined;
}

async function runDevLauncher(envOverrides: Record<string, string> = {}): Promise<Invocation[]> {
  const tempDir = await makeTempDir("pi-postbox-dev-launcher-");
  const binDir = join(tempDir, "bin");
  const invocationsPath = join(tempDir, "invocations.jsonl");
  await mkdir(binDir);

  const fakeCommand = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const { basename } = require("node:path");
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.DEV_LAUNCHER_INVOCATIONS, JSON.stringify({
  command,
  args,
  postboxDevApiPort: process.env.POSTBOX_DEV_API_PORT,
  postboxDevWebPort: process.env.POSTBOX_DEV_WEB_PORT
}) + "\\n");
if (command === "tailscale") {
  if (args.join(" ") === "serve status --json") {
    process.stdout.write(JSON.stringify({ Web: {} }));
    process.exit(0);
  }
  if (args.join(" ") === "status --json") {
    process.stdout.write(JSON.stringify({ Self: { DNSName: "postbox-dev.tailnet.example.", TailscaleIPs: ["100.64.0.11"] } }));
    process.exit(0);
  }
  if (args[0] === "serve" && args.includes("--bg")) process.exit(0);
  process.stderr.write("unexpected tailscale args: " + args.join(" "));
  process.exit(1);
}
if (command === "pi-postbox-server") {
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1000);
}
if (command === "npm") {
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const invocations = readFileSync(process.env.DEV_LAUNCHER_INVOCATIONS, "utf8");
    if (invocations.includes('"command":"pi-postbox-server"')) process.exit(0);
    sleep(20);
  }
  process.stderr.write("timed out waiting for backend invocation before web exit");
  process.exit(1);
}
`;

  for (const command of ["pi-postbox-server", "npm", "tailscale"]) {
    const commandPath = join(binDir, command);
    await writeFile(commandPath, fakeCommand);
    await chmod(commandPath, 0o755);
  }

  const { PI_POSTBOX_PORT: _piPostboxPort, ...baseEnv } = process.env;
  const devScriptPath = fileURLToPath(new URL("../../../scripts/dev.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [devScriptPath], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: {
      ...baseEnv,
      ...envOverrides,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      DEV_LAUNCHER_INVOCATIONS: invocationsPath
    },
    encoding: "utf8",
    timeout: 5_000
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);

  return (await readFile(invocationsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Invocation);
}

afterEach(async () => {
  await Promise.all(
    fixedPortServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("scripts/dev.mjs", () => {
  it("starts the backend as the active-local dev target while preserving API port and web proxy env", async () => {
    const apiPort = await getFreeLocalPort();
    const invocations = await runDevLauncher({ PI_POSTBOX_PORT: String(apiPort) });

    const backend = invocations.find((invocation) => invocation.command === "pi-postbox-server");
    expect(backend?.args).toEqual([
      "--host",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--active-local-role",
      "dev",
      "--no-tailscale"
    ]);

    const web = invocations.find((invocation) => invocation.command === "npm");
    expect(web?.args.slice(0, 4)).toEqual(["run", "dev", "-w", "@pi-postbox/web"]);
    expect(web).toMatchObject({ postboxDevApiPort: String(apiPort) });
  });

  it("selects and exposes the actual Vite UI port when 5173 is busy", async () => {
    await occupyPortIfFree(5173);
    const apiPort = await getFreeLocalPort();
    const invocations = await runDevLauncher({ PI_POSTBOX_PORT: String(apiPort) });

    const backend = invocations.find((invocation) => invocation.command === "pi-postbox-server");
    expect(backend?.args).toContain("--active-local-role");
    expect(backend?.args).toContain("dev");
    expect(backend?.args).toContain(String(apiPort));

    const web = invocations.find((invocation) => invocation.command === "npm");
    const actualWebPort = devWebPort(web);
    expect(actualWebPort).toBeDefined();
    expect(actualWebPort).not.toBe(5173);

    const serveMutation = invocations.find(
      (invocation) => invocation.command === "tailscale" && invocation.args[0] === "serve" && invocation.args.includes("--bg")
    );
    expect(serveMutation?.args).toEqual([
      "serve",
      "--bg",
      "--https",
      String(actualWebPort),
      `http://127.0.0.1:${actualWebPort}`
    ]);
  });

  it("skips dev Tailscale Serve mutation when PI_POSTBOX_TAILSCALE=off", async () => {
    const apiPort = await getFreeLocalPort();
    const invocations = await runDevLauncher({ PI_POSTBOX_PORT: String(apiPort), PI_POSTBOX_TAILSCALE: "off" });

    expect(invocations.some((invocation) => invocation.command === "tailscale" && invocation.args[0] === "serve")).toBe(false);
  });

  it("uses the documented canonical API port when PI_POSTBOX_PORT is unset", async () => {
    const devScriptPath = fileURLToPath(new URL("../../../scripts/dev.mjs", import.meta.url));
    const source = await readFile(devScriptPath, "utf8");

    expect(source).toMatch(/\bAPI_PORT\s*=\s*Number\(process\.env\.PI_POSTBOX_PORT\)\s*\|\|\s*32187\b/);
  });
});
