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

function nextMessages(socket, count, timeoutMs = 3_000) {
  return new Promise((resolvePromise, reject) => {
    const messages = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${count} WebSocket messages`));
    }, timeoutMs);
    const onMessage = (raw) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.length === count) {
        cleanup();
        resolvePromise(messages);
      }
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
    socket.on("message", onMessage);
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
    return this.nextJsonMatching(predicate, "state", timeoutMs);
  }

  async nextJsonMatching(predicate, eventName, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await this.nextJson(Math.max(deadline - Date.now(), 1), eventName);
      if (predicate(value)) return value;
    }
    throw new Error("Timed out waiting for matching SSE data");
  }

  async nextJson(timeoutMs, eventName) {
    while (true) {
      const parsed = this.shiftParsedJsonEvent(eventName);
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

  shiftParsedJsonEvent(expectedEventName) {
    const boundary = this.buffer.indexOf("\n\n");
    if (boundary === -1) return undefined;
    const rawEvent = this.buffer.slice(0, boundary);
    this.buffer = this.buffer.slice(boundary + 2);
    const lines = rawEvent.split("\n");
    const eventName = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
    const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice("data: ".length)).join("\n");
    if ((expectedEventName && eventName !== expectedEventName) || !data) return this.shiftParsedJsonEvent(expectedEventName);
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
  let chatSse;
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
        session: {
          sessionId,
          title: "Smoke session",
          cwd: root,
          branch: "smoke",
          semanticState: "working",
          agentSessionPath: join(tmp, "fake-source.jsonl"),
          leafId: "smoke-source-leaf"
        }
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
        context: {
          codebaseContext: "Packaged Pi Postbox extension, server, protocol, and web assets.",
          problemContext: "Smoke verifies one remote handoff without full chat transcripts."
        },
        forkReference: { cwd: root, model: "smoke/fake-model" }
      }
    }));
    assert((await created).type === "ask.created", "Ask was not created");
    await sse.nextStateMatching((snapshot) => snapshot.requests.some((request) => request.requestId === requestId && request.status === "pending"));

    const activationResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat`, { method: "POST" });
    const activationCommand = await nextMessage(socket);
    assert(activationCommand.type === "chat.activate", "Fake extension did not receive Chat activation");
    socket.send(JSON.stringify({
      type: "chat.error",
      requestId: activationCommand.requestId,
      payload: {
        requestId,
        error: { code: "source_path_missing", message: "The packaged smoke source is intentionally unavailable." }
      }
    }));
    const exactUnavailable = await activationResponse;
    const exactUnavailableBody = await exactUnavailable.json();
    assert(
      exactUnavailable.status === 409 &&
        exactUnavailableBody.error?.code === "source_path_missing" &&
        exactUnavailableBody.error?.contextFallback?.status === "available",
      "Exact Chat failure did not disclose eligible context-only fallback"
    );

    const contextActivationResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true })
    });
    const contextActivationCommand = await nextMessage(socket);
    assert(contextActivationCommand.type === "chat.activate-context", "Fake extension did not receive explicit context-only activation");
    assert(
      contextActivationCommand.payload.source.question.prompt === "Is the release smoke path healthy?" &&
        contextActivationCommand.payload.source.context.codebaseContext.includes("Packaged Pi Postbox") &&
        contextActivationCommand.payload.source.context.problemContext.includes("Smoke verifies") &&
        contextActivationCommand.payload.source.model === "smoke/fake-model" &&
        !("agentSessionPath" in contextActivationCommand.payload.source) &&
        !("leafId" in contextActivationCommand.payload.source),
      "Context-only activation did not carry only authoritative bounded handoff context"
    );
    socket.send(JSON.stringify({
      type: "chat.ready",
      requestId: contextActivationCommand.requestId,
      payload: {
        requestId,
        state: "ready",
        forkKind: "context-only",
        model: { id: "smoke/fake-model", source: "originating" },
        sequence: 0,
        messages: []
      }
    }));
    assert((await contextActivationResponse).status === 200, "Context-only Question Chat did not activate explicitly");

    chatSse = new SseClient(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/events`);
    await chatSse.open();
    const snapshotResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat`);
    const snapshotCommand = await nextMessage(socket);
    assert(snapshotCommand.type === "chat.snapshot", "Fake extension did not receive Chat snapshot request");
    socket.send(JSON.stringify({
      type: "chat.snapshot",
      requestId: snapshotCommand.requestId,
      payload: {
        requestId,
        state: "ready",
        forkKind: "context-only",
        model: { id: "smoke/fake-model", source: "originating" },
        sequence: 0,
        messages: []
      }
    }));
    assert((await snapshotResponse).status === 200, "Question Chat snapshot did not come from the fake extension fork");

    const clientCommandId = `smoke-chat-${randomUUID()}`;
    const sendResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId, message: "Please elaborate." })
    });
    const sendCommand = await nextMessage(socket);
    assert(sendCommand.type === "chat.send" && sendCommand.payload.command.message === "Please elaborate.", "Fake runtime did not receive the first Chat prompt");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: sendCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId, mode: "prompt" } }
    }));
    const firstSend = await sendResponse;
    assert(firstSend.status === 200 && (await firstSend.json()).mode === "prompt", "First Chat send was not accepted as an ordinary prompt");
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 1, type: "lifecycle", state: "generating" } }));

    const steerCommandId = `smoke-chat-steer-${randomUUID()}`;
    const steerResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId: steerCommandId, message: "Correct that detail." })
    });
    const steerCommand = await nextMessage(socket);
    assert(steerCommand.type === "chat.send" && steerCommand.payload.command.clientCommandId === steerCommandId, "Fake runtime did not receive active Chat steering");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: steerCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId: steerCommandId, mode: "steer" } }
    }));
    const steered = await steerResponse;
    assert(steered.status === 200 && (await steered.json()).mode === "steer", "Active Chat message was not accepted as steering");

    socket.send(JSON.stringify({
      type: "chat.event",
      payload: { requestId, sequence: 2, type: "message.started", message: { id: "smoke-assistant", role: "assistant", text: "", status: "streaming" } }
    }));
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: { requestId, sequence: 3, type: "assistant.text.delta", messageId: "smoke-assistant", text: "smoke-streamed-private-fork-answer" }
    }));

    const stopCommandId = `smoke-chat-stop-${randomUUID()}`;
    const stopResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId: stopCommandId })
    });
    const stopCommand = await nextMessage(socket);
    assert(stopCommand.type === "chat.stop" && stopCommand.payload.command.clientCommandId === stopCommandId, "Fake runtime did not receive Chat Stop");
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 4, type: "lifecycle", state: "stopping" } }));
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: { requestId, sequence: 5, type: "message.finished", messageId: "smoke-assistant", text: "smoke-streamed-private-fork-answer", status: "stopped" }
    }));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 6, type: "lifecycle", state: "stopped" } }));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 7, type: "lifecycle", state: "ready" } }));
    socket.send(JSON.stringify({
      type: "chat.stop.accepted",
      requestId: stopCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId: stopCommandId } }
    }));
    assert((await stopResponse).status === 200, "Chat Stop was not accepted");
    await chatSse.nextJsonMatching(
      (event) => event.type === "message.finished" && event.status === "stopped" && event.text === "smoke-streamed-private-fork-answer",
      undefined
    );

    const continueCommandId = `smoke-chat-continue-${randomUUID()}`;
    const continueResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId: continueCommandId, message: "Continue." })
    });
    const continueCommand = await nextMessage(socket);
    assert(continueCommand.type === "chat.send" && continueCommand.payload.command.clientCommandId === continueCommandId, "Stopped Chat did not accept another prompt");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: continueCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId: continueCommandId, mode: "prompt" } }
    }));
    const continued = await continueResponse;
    assert(continued.status === 200 && (await continued.json()).mode === "prompt", "Stopped Chat did not resume with an ordinary prompt");
    chatSse.close();
    chatSse = undefined;

    const terminalMessagesPromise = nextMessages(socket, 2);
    const answerResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedValues: ["yes"], note: "Smoke answered", rationale: "All release path checks passed." })
    });
    assert(answerResponse.status === 200, `Answer returned ${answerResponse.status}`);
    const terminalMessages = await terminalMessagesPromise;
    assert(terminalMessages.some((message) => message.type === "chat.cleanup" && message.payload.requestId === requestId), "Extension did not receive terminal Chat cleanup");
    const resolvedMessage = terminalMessages.find((message) => message.type === "ask.resolved");
    assert(resolvedMessage?.type === "ask.resolved" && resolvedMessage.payload.status === "answered", "Extension did not receive answered result");
    await sse.nextStateMatching((snapshot) => snapshot.requests.some((request) => request.requestId === requestId && request.status === "answered"));

    const state = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert(state.sessions.some((session) => session.sessionId === sessionId), "State endpoint does not include registered session");
    assert(state.requests.some((request) => request.requestId === requestId && request.status === "answered"), "State endpoint does not include answered request");

    const history = await fetch(`${baseUrl}/api/history`).then((response) => response.json());
    assert(history.history.some((record) => record.request.requestId === requestId && record.request.result?.status === "answered"), "History endpoint does not include answered request");
    assert(!JSON.stringify(history).includes("smoke-streamed-private-fork-answer"), "History persisted the private Chat transcript");

    console.log("Pi Postbox smoke passed: health, UI shell, fake extension, Chat prompt/steer/stop/resume, cleanup, answer, state, and history verified.");
  } finally {
    chatSse?.close();
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
