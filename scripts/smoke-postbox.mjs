#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import WebSocket from "ws";

const root = resolve(new URL("..", import.meta.url).pathname);
const cliPath = join(root, "packages/server/dist/cli.js");
const serverPublicDir = join(root, "packages/server/dist/public");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  assert(address && typeof address !== "string", "Expected TCP address for smoke port");
  return address.port;
}

async function waitForHealth(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return response.json();
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for /healthz: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function normalizedUrl(url) {
  return new URL(url).toString();
}

function assertCompatibleLocalTarget(health, expectedBaseUrl) {
  const { localTarget } = health;
  if (localTarget === undefined) return;

  assert(localTarget && typeof localTarget === "object", "health localTarget must be an object when present");
  assert(localTarget.role === "production", `health localTarget role mismatch: ${localTarget.role}`);
  assert(typeof localTarget.instanceId === "string" && localTarget.instanceId.length > 0, "health localTarget instanceId missing");
  assert(localTarget.url === normalizedUrl(expectedBaseUrl), `health localTarget url mismatch: ${localTarget.url}`);
}

function nextMessage(socket, timeoutMs = 3_000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const onMessage = (raw) => {
      cleanup();
      resolvePromise(JSON.parse(raw.toString()));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function connectSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolvePromise, reject) => {
    socket.once("open", resolvePromise);
    socket.once("error", reject);
  });
  return socket;
}

class SseClient {
  constructor(url) {
    this.url = url;
    this.controller = new AbortController();
    this.buffer = "";
    this.decoder = new TextDecoder();
  }

  async open() {
    const response = await fetch(this.url, { signal: this.controller.signal });
    assert(response.status === 200, `SSE endpoint returned ${response.status}`);
    assert(response.headers.get("content-type")?.includes("text/event-stream"), "SSE endpoint did not return text/event-stream");
    assert(response.body, "SSE response had no body");
    this.reader = response.body.getReader();
  }

  close() {
    this.controller.abort();
    void this.reader?.cancel().catch(() => undefined);
  }

  async nextStateMatching(predicate, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await this.nextState(Math.max(deadline - Date.now(), 1));
      if (predicate(snapshot)) return snapshot;
    }
    throw new Error("Timed out waiting for matching SSE state");
  }

  async nextState(timeoutMs) {
    while (true) {
      const parsed = this.shiftParsedStateEvent();
      if (parsed) return parsed;
      assert(this.reader, "SSE client is not open");
      const read = await Promise.race([
        this.reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for SSE data")), timeoutMs))
      ]);
      if (read.done) throw new Error("SSE stream closed");
      this.buffer += this.decoder.decode(read.value, { stream: true });
    }
  }

  shiftParsedStateEvent() {
    const boundary = this.buffer.indexOf("\n\n");
    if (boundary === -1) return undefined;
    const rawEvent = this.buffer.slice(0, boundary);
    this.buffer = this.buffer.slice(boundary + 2);
    const lines = rawEvent.split("\n");
    const eventName = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
    const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice("data: ".length)).join("\n");
    if (eventName !== "state" || !data) return this.shiftParsedStateEvent();
    return JSON.parse(data);
  }
}

async function main() {
  assert(existsSync(cliPath), `Built CLI missing at ${cliPath}. Run npm run build first.`);
  assert(existsSync(join(serverPublicDir, "index.html")), `Packaged UI missing at ${serverPublicDir}. Run npm run build first.`);

  const tmp = await mkdtemp(join(tmpdir(), "pi-postbox-smoke-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const databasePath = join(tmp, "postbox.sqlite");
  const server = spawn(process.execPath, [
    cliPath,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--database", databasePath,
    "--ask-timeout-ms", "600000",
    "--history-retention-max-records", "100",
    "--no-tailscale"
  ], {
    cwd: root,
    env: {
      ...process.env,
      PI_POSTBOX_CONFIG_DIR: tmp,
      PI_POSTBOX_CONFIG_PATH: join(tmp, "config.json"),
      PI_POSTBOX_ACTIVE_LOCAL_ROLE: "production",
      PI_POSTBOX_TAILSCALE: "off"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  server.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  server.stdout?.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));

  let socket;
  let sse;
  try {
    const health = await waitForHealth(baseUrl);
    assert(health.ok === true && health.service === "pi-postbox", "Unexpected health response");
    assertCompatibleLocalTarget(health, baseUrl);

    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert(html.includes("Pi Postbox") || html.includes("root"), "Server did not serve the web shell");

    sse = new SseClient(`${baseUrl}/api/state/events`);
    await sse.open();
    await sse.nextStateMatching((snapshot) => Array.isArray(snapshot.sessions) && snapshot.sessions.length === 0);

    socket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    const sessionId = `smoke-session-${randomUUID()}`;
    const requestId = `smoke-ask-${randomUUID()}`;

    const registered = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "session.register",
      requestId: "smoke-register",
      payload: {
        machine: { machineId: "smoke-machine", hostname: "smoke-host", displayName: "Smoke Host" },
        project: {
          projectId: "smoke-project",
          name: "pi-postbox",
          displayName: "Pi Postbox Smoke",
          cwd: root,
          repoName: "pi-postbox",
          branch: "smoke",
          worktreePath: root
        },
        session: { sessionId, title: "Smoke session", cwd: root, branch: "smoke", semanticState: "working" }
      }
    }));
    assert((await registered).type === "registered", "Fake extension did not register");
    await sse.nextStateMatching((snapshot) => snapshot.sessions.some((session) => session.sessionId === sessionId && session.presence === "live"));

    const created = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "ask.create",
      requestId: "smoke-wire-ask",
      payload: {
        requestId,
        sessionId,
        mode: "single",
        question: {
          prompt: "Is the release smoke path healthy?",
          relevance: "The release smoke should verify the operator path.",
          decisionImpact: "A failure here blocks manual testing."
        },
        options: [
          { value: "yes", label: "Yes", meaning: "The server, SSE, answer, and history path work." },
          { value: "no", label: "No" }
        ],
        context: { problemContext: "Smoke verifies one remote handoff without full chat transcripts." }
      }
    }));
    assert((await created).type === "ask.created", "Ask was not created");
    await sse.nextStateMatching((snapshot) => snapshot.requests.some((request) => request.requestId === requestId && request.status === "pending"));

    const resolved = nextMessage(socket);
    const answerResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedValues: ["yes"], note: "Smoke answered", rationale: "All release path checks passed." })
    });
    assert(answerResponse.status === 200, `Answer returned ${answerResponse.status}`);
    const resolvedMessage = await resolved;
    assert(resolvedMessage.type === "ask.resolved" && resolvedMessage.payload.status === "answered", "Extension did not receive answered result");
    await sse.nextStateMatching((snapshot) => snapshot.requests.some((request) => request.requestId === requestId && request.status === "answered"));

    const state = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert(state.sessions.some((session) => session.sessionId === sessionId), "State endpoint does not include registered session");
    assert(state.requests.some((request) => request.requestId === requestId && request.status === "answered"), "State endpoint does not include answered request");

    const history = await fetch(`${baseUrl}/api/history`).then((response) => response.json());
    assert(history.history.some((record) => record.request.requestId === requestId && record.request.result?.status === "answered"), "History endpoint does not include answered request");

    console.log("Pi Postbox smoke passed: health, UI shell, fake extension registration, SSE, answer, state, and history verified.");
  } finally {
    sse?.close();
    socket?.close();
    server.kill("SIGTERM");
    await new Promise((resolvePromise) => server.once("exit", resolvePromise));
    if (server.exitCode && server.exitCode !== 0 && server.exitCode !== null) {
      console.error(stderr);
    }
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
