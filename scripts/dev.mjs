#!/usr/bin/env node
// Checkout-scoped Postbox development launcher. The package root is the
// environment boundary: every clone/worktree receives its own profile, state,
// database, metadata, backend port, and Vite UI.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const packageRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const checkoutId = createHash("sha256").update(packageRoot).digest("hex").slice(0, 16);
const profileId = `development:${checkoutId}`;
const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
const profileStateDir = process.env.PI_POSTBOX_PROFILE_STATE_DIR ?? join(stateHome, "pi-postbox", "dev", checkoutId);
const databasePath = join(profileStateDir, "postbox.sqlite");
const portsPath = join(profileStateDir, "dev-ports.json");
const serverCli = join(packageRoot, "packages", "server", "dist", "cli.js");
const serverExecutable = process.env.POSTBOX_DEV_SERVER_EXECUTABLE ?? process.execPath;
const serverPrefixArgs = process.env.POSTBOX_DEV_SERVER_EXECUTABLE ? [] : [serverCli];
const CANONICAL_DEV_API_PORT = 45795;
const skipPortAvailabilityCheck = process.env.POSTBOX_DEV_TEST_SKIP_PORT_CHECK === "1"
  && process.env.POSTBOX_DEV_SERVER_EXECUTABLE !== undefined;

async function choosePort(preferred, explicitName) {
  if (preferred !== undefined) {
    const parsed = Number(preferred);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`Invalid ${explicitName ?? "persisted development port"}: ${preferred}`);
    if (skipPortAvailabilityCheck || await portAvailable(parsed)) return parsed;
    if (explicitName) throw new Error(`Development port ${parsed} is already in use. Choose another ${explicitName}; production was left untouched.`);
  }
  return await reserveEphemeralPort();
}

async function readPersistedPorts() {
  try {
    const parsed = JSON.parse(await readFile(portsPath, "utf8"));
    if (parsed?.version !== 1) return undefined;
    if (![parsed.apiPort, parsed.webPort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65535)) return undefined;
    return { apiPort: parsed.apiPort, webPort: parsed.webPort };
  } catch {
    return undefined;
  }
}

async function persistPorts(apiPort, webPort) {
  await mkdir(profileStateDir, { recursive: true, mode: 0o700 });
  const temporary = join(profileStateDir, `.dev-ports.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, apiPort, webPort }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, portsPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function portAvailable(port) {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    server.once("error", () => resolveAvailable(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveAvailable(true)));
  });
}

function reserveEphemeralPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to allocate a development port."));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function buildBackend() {
  for (const workspace of ["@pi-postbox/protocol", "@pi-postbox/server"]) {
    const result = spawnSync("npm", ["run", "build", "-w", workspace], {
      cwd: packageRoot,
      stdio: "inherit",
      env: process.env
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Failed to build ${workspace}.`);
  }
}

const children = [];
let shuttingDown = false;

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    detached: true,
    env: { ...process.env, ...env }
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev] ${name} exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
    shutdown(typeof code === "number" ? code : 1);
  });
  children.push(child);
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The child already exited.
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) signalGroup(child, "SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) signalGroup(child, "SIGKILL");
    process.exit(code);
  }, 3_000);
  timer.unref?.();
  Promise.all(children.map((child) => new Promise((resolveExit) => child.once("exit", resolveExit))))
    .finally(() => process.exit(code));
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(0));

buildBackend();
const persistedPorts = await readPersistedPorts();
const configuredApiPort = process.env.PI_POSTBOX_PORT ?? CANONICAL_DEV_API_PORT;
const configuredApiPortName = process.env.PI_POSTBOX_PORT !== undefined
  ? "PI_POSTBOX_PORT"
  : "canonical development API port";
const apiPort = await choosePort(configuredApiPort, configuredApiPortName);
let webPort = await choosePort(
  process.env.POSTBOX_DEV_WEB_PORT ?? persistedPorts?.webPort,
  process.env.POSTBOX_DEV_WEB_PORT === undefined ? undefined : "POSTBOX_DEV_WEB_PORT"
);
if (webPort === apiPort) {
  if (process.env.POSTBOX_DEV_WEB_PORT !== undefined) {
    throw new Error("POSTBOX_DEV_WEB_PORT must differ from PI_POSTBOX_PORT.");
  }
  do { webPort = await reserveEphemeralPort(); } while (webPort === apiPort);
}
await persistPorts(apiPort, webPort);
const dashboardUrl = `http://127.0.0.1:${webPort}/`;

console.error(`[dev] Profile: ${profileId}`);
console.error(`[dev] State: ${profileStateDir}`);
console.error(`[dev] Dashboard: ${dashboardUrl}`);
console.error(`[dev] API: http://127.0.0.1:${apiPort}/`);
console.error("[dev] Tailscale exposure is enabled when the CLI is installed, logged in, and non-conflicting.");

start("server", serverExecutable, [
  ...serverPrefixArgs,
  "serve",
  "--host", "127.0.0.1",
  "--port", String(apiPort),
  "--profile", profileId,
  "--profile-state-dir", profileStateDir,
  "--database", databasePath
]);
start(
  "web",
  "npm",
  ["run", "dev", "-w", "@pi-postbox/web", "--", "--host", "127.0.0.1", "--port", String(webPort)],
  {
    POSTBOX_DEV_API_PORT: String(apiPort),
    POSTBOX_DEV_WEB_PORT: String(webPort),
    PI_POSTBOX_PROFILE: profileId
  }
);
