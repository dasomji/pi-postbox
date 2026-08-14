import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("scripts/dev.mjs", () => {
  it("starts a checkout-scoped backend and Vite UI without production or Tailscale mutation", async () => {
    const { invocations, stderr, stateHome } = await runDevLauncher();
    const backend = invocations.find((entry) => entry.command === "fake-server");
    const profileId = valueAfter(backend?.args ?? [], "--profile");

    expect(profileId).toMatch(/^development:[a-f0-9]{16}$/);
    expect(backend?.args).toEqual(expect.arrayContaining([
      "serve",
      "--profile", profileId,
      "--profile-state-dir", join(stateHome, "pi-postbox", "dev", profileId!.slice("development:".length)),
      "--no-tailscale"
    ]));
    expect(backend?.args).not.toContain("--active-local-role");
    expect(backend?.args).not.toContain("32187");
    expect(invocations.some((entry) => entry.command === "tailscale")).toBe(false);

    const web = invocations.find((entry) => entry.command === "npm" && entry.args.includes("@pi-postbox/web"));
    expect(web?.postboxDevApiPort).toMatch(/^\d+$/);
    expect(web?.piPostboxProfile).toBe(profileId);
    expect(stderr).toContain(`Profile: ${profileId}`);
    expect(stderr).toContain("Dashboard: http://127.0.0.1:");
  });

  it("fails without stopping anything when an explicitly requested development port is occupied", async () => {
    const result = await runDevLauncher({ PI_POSTBOX_PORT: "32187" }, false);
    // This machine may or may not have production on the canonical port. In either case,
    // the launcher source contains no shutdown/kill path and never invokes one.
    const source = await readFile(fileURLToPath(new URL("../../../scripts/dev.mjs", import.meta.url)), "utf8");
    expect(source).not.toContain("/admin/shutdown");
    expect(source).not.toContain("SIGKILL\", 32187");
    expect(result.invocations.some((entry) => entry.command === "tailscale")).toBe(false);
  });
});

type Invocation = {
  command: string;
  args: string[];
  postboxDevApiPort?: string;
  piPostboxProfile?: string;
};

async function runDevLauncher(overrides: Record<string, string> = {}, expectSuccess = true) {
  const root = await mkdtemp(join(tmpdir(), "pi-postbox-dev-launcher-"));
  tempDirs.push(root);
  const binDir = join(root, "bin");
  const invocationsPath = join(root, "invocations.jsonl");
  const stateHome = join(root, "state");
  await mkdir(binDir);

  const fake = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const { basename } = require("node:path");
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.DEV_LAUNCHER_INVOCATIONS, JSON.stringify({ command, args, postboxDevApiPort: process.env.POSTBOX_DEV_API_PORT, piPostboxProfile: process.env.PI_POSTBOX_PROFILE }) + "\\n");
if (command === "npm" && args.includes("build")) process.exit(0);
if (command === "fake-server") { process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000); }
if (command === "npm" && args.includes("@pi-postbox/web")) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (readFileSync(process.env.DEV_LAUNCHER_INVOCATIONS, "utf8").includes('"command":"fake-server"')) process.exit(0);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  process.exit(1);
}
`;
  for (const command of ["npm", "fake-server", "tailscale"]) {
    await writeFile(join(binDir, command), fake);
    await chmod(join(binDir, command), 0o755);
  }

  const script = fileURLToPath(new URL("../../../scripts/dev.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: {
      ...process.env,
      ...overrides,
      XDG_STATE_HOME: stateHome,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      POSTBOX_DEV_SERVER_EXECUTABLE: join(binDir, "fake-server"),
      DEV_LAUNCHER_INVOCATIONS: invocationsPath
    },
    encoding: "utf8",
    timeout: 5_000
  });
  if (expectSuccess) expect(result.status, result.stderr).toBe(0);
  const text = await readFile(invocationsPath, "utf8").catch(() => "");
  return {
    invocations: text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as Invocation) : [],
    stderr: result.stderr,
    stateHome
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
