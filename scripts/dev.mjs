#!/usr/bin/env node
// Dev orchestrator for Pi Postbox: runs the backend API/WebSocket server plus the
// web UI dev server (Vite, live HMR) together. Vite proxies /api + /healthz to the
// backend, so the dashboard has live data while you edit source.
//
// Run directly with `npm run dev`. When Tailscale is available, this script
// best-effort exposes the actual Vite UI port through Tailnet-private
// Tailscale Serve without changing the backend API URL used by Pi extensions.
//
// The backend binds the CANONICAL port (PI_POSTBOX_PORT, else 32187) — the same
// endpoint the extension's serverUrl points at — so live Pi sessions talk to THIS
// dev server. If a production pi-postbox server already holds that port, we offer to
// stop it: interactively (a prompt) when run from a terminal, or via --force /
// POSTBOX_DEV_FORCE=1 when run non-interactively (e.g. by an agent). A non-pi-postbox
// process on the port is never touched.
//
// Each child runs in its own process group (detached) so a single shutdown reliably
// tears down the whole tree — important because Vite uses strictPort and an orphan
// holding :5173 would break the next run.
import { execFile, spawn } from "node:child_process";
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_PORT = Number(process.env.PI_POSTBOX_PORT) || 32187;
const PREFERRED_WEB_PORT = 5173;
const TAILSCALE_ENABLED = !["off", "0", "false", "no"].includes((process.env.PI_POSTBOX_TAILSCALE ?? "").toLowerCase());
const FORCE =
  process.argv.slice(2).includes("--force") ||
  ["1", "true", "yes"].includes((process.env.POSTBOX_DEV_FORCE ?? "").toLowerCase());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tcpInUse(port) {
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function isPostboxServer(port) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: ctrl.signal });
    const body = await res.json();
    return body?.service === "pi-postbox";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function findListenerPids(port) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    const pids = stdout.split(/\s+/).map(Number).filter(Boolean);
    if (pids.length) return [...new Set(pids)];
  } catch {
    // lsof missing or no match; fall through to ss.
  }
  try {
    const { stdout } = await execFileAsync("ss", ["-ltnpH", `sport = :${port}`]);
    return [...new Set([...stdout.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
  } catch {
    return [];
  }
}

async function waitForPortFree(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (!(await tcpInUse(port))) return true;
    await delay(100);
  }
  return false;
}

async function chooseWebPort() {
  if (!(await tcpInUse(PREFERRED_WEB_PORT))) return PREFERRED_WEB_PORT;
  for (let port = PREFERRED_WEB_PORT + 1; port <= 65535; port++) {
    if (!(await tcpInUse(port))) return port;
  }
  throw new Error("could not find a free Vite UI port");
}

function proxyForHttpsPort(status, port) {
  const web = status?.Web;
  if (!web || typeof web !== "object") return undefined;
  for (const [key, value] of Object.entries(web)) {
    if (!key.endsWith(`:${port}`)) continue;
    const handlers = value?.Handlers;
    if (!handlers || typeof handlers !== "object") return undefined;
    for (const handler of Object.values(handlers)) {
      if (typeof handler?.Proxy === "string") return handler.Proxy.replace(/\/$/, "");
    }
  }
  return undefined;
}

async function exposeDevUiWithTailscale(webPort) {
  if (!TAILSCALE_ENABLED) {
    console.error("[dev] Tailscale Serve disabled by PI_POSTBOX_TAILSCALE=off");
    return;
  }

  const target = `http://127.0.0.1:${webPort}`;
  try {
    const { stdout } = await execFileAsync("tailscale", ["serve", "status", "--json"]);
    const existingProxy = proxyForHttpsPort(JSON.parse(stdout || "{}"), webPort);
    if (existingProxy && existingProxy !== target) {
      console.error(`[dev] Tailscale Serve conflict on :${webPort}; leaving existing mapping unchanged. Run tailscale serve status to inspect it.`);
      return;
    }
    if (!existingProxy) {
      await execFileAsync("tailscale", ["serve", "--bg", "--https", String(webPort), target]);
    }
    const status = await execFileAsync("tailscale", ["status", "--json"]).catch(() => undefined);
    const parsed = status ? JSON.parse(status.stdout || "{}") : undefined;
    const host = parsed?.Self?.DNSName?.replace(/\.$/, "") ?? parsed?.Self?.TailscaleIPs?.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    if (host) console.error(`[dev] Tailnet UI: https://${host}:${webPort}`);
  } catch (error) {
    console.error(`[dev] Tailscale Serve unavailable; continuing locally (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function requestGracefulShutdown(port) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/shutdown`, { method: "POST", signal: ctrl.signal });
    return res.ok || res.status === 202;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function stopServerOnPort(port) {
  // Preferred path: ask the server to stop itself (cross-platform, graceful, no PID hunting).
  if (await requestGracefulShutdown(port)) {
    if (await waitForPortFree(port)) {
      console.error(`[dev] stopped the production server on :${port}`);
      return;
    }
  }

  // Fallback: older server without /admin/shutdown, or it didn't release the port.
  const pids = await findListenerPids(port);
  if (pids.length === 0) {
    console.error(`[dev] couldn't identify the process on :${port} to stop it. Aborting.`);
    process.exit(1);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 50; i++) {
    if (!(await tcpInUse(port))) {
      console.error(`[dev] stopped the production server on :${port}`);
      return;
    }
    await delay(100);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  await delay(300);
  if (await tcpInUse(port)) {
    console.error(`[dev] failed to free :${port}.`);
    process.exit(1);
  }
  console.error(`[dev] stopped the production server on :${port} (forced)`);
}

async function ensurePortAvailable() {
  if (!(await tcpInUse(API_PORT))) return;

  if (!(await isPostboxServer(API_PORT))) {
    console.error(
      `[dev] port :${API_PORT} is in use by a non-pi-postbox process. ` +
        `Free it, or set PI_POSTBOX_PORT to a free port (and point the extension's serverUrl there).`
    );
    process.exit(1);
  }

  console.error(`[dev] a production pi-postbox server is already running on :${API_PORT}.`);
  let proceed = FORCE;
  if (proceed) {
    console.error("[dev] --force set; stopping it.");
  } else if (process.stdin.isTTY) {
    proceed = await confirm(`[dev] Stop it and start the dev server on :${API_PORT}? [y/N] `);
  } else {
    console.error("[dev] refusing to stop it automatically. Re-run with --force (or POSTBOX_DEV_FORCE=1).");
    process.exit(1);
  }
  if (!proceed) {
    console.error("[dev] aborted; leaving the production server running.");
    process.exit(1);
  }
  await stopServerOnPort(API_PORT);
}

const procs = [];
let shuttingDown = false;

function start(name, command, args, env) {
  const child = spawn(command, args, { stdio: "inherit", detached: true, env: { ...process.env, ...env } });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev] ${name} exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Stopping the rest.`);
    shutdown(typeof code === "number" ? code : 1);
  });
  procs.push({ name, child });
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal); // negative pid = the child's whole process group
  } catch {
    /* already gone */
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  let pending = 0;
  for (const { child } of procs) {
    const stillRunning = child.exitCode === null && child.signalCode === null;
    if (stillRunning) {
      pending++;
      child.once("exit", () => {
        if (--pending === 0) process.exit(code);
      });
    }
  }

  for (const { child } of procs) signalGroup(child, "SIGTERM");
  if (pending === 0) {
    process.exit(code);
    return;
  }

  // Hard backstop: if something ignores SIGTERM, force-kill and exit anyway.
  setTimeout(() => {
    for (const { child } of procs) signalGroup(child, "SIGKILL");
    process.exit(code);
  }, 3000);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(0));
}

await ensurePortAvailable();
const WEB_PORT = await chooseWebPort();
await exposeDevUiWithTailscale(WEB_PORT);

console.error(`[dev] backend API on :${API_PORT}, web UI on :${WEB_PORT} (proxying /api -> :${API_PORT})`);
start("server", "pi-postbox-server", [
  "--host",
  "127.0.0.1",
  "--port",
  String(API_PORT),
  "--active-local-role",
  "dev",
  "--no-tailscale"
]);
start(
  "web",
  "npm",
  ["run", "dev", "-w", "@pi-postbox/web", "--", "--host", "127.0.0.1", "--port", String(WEB_PORT)],
  { POSTBOX_DEV_API_PORT: String(API_PORT), POSTBOX_DEV_WEB_PORT: String(WEB_PORT) }
);
