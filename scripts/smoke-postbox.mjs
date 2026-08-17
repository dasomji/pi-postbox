#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import WebSocket from "ws";
import Database from "better-sqlite3";
import { executeAskPostbox } from "../packages/extension/dist/tools/askPostbox.js";
import { createWaitForPostboxTool } from "../packages/extension/dist/index.js";
import { PostboxClient } from "../packages/extension/dist/client/PostboxClient.js";
import { AdapterRunnableSlotLimiter, ownerFromNativeIdentity } from "../packages/extension/dist/adapterContract.js";

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
  const { profile, instance } = health;
  assert(profile?.kind === "production" && profile?.id === "production", "health production profile identity mismatch");
  assert(instance && typeof instance === "object", "health server instance identity missing");
  assert(instance.profile?.id === "production", `health instance profile mismatch: ${instance.profile?.id}`);
  assert(typeof instance.instanceId === "string" && instance.instanceId.length > 0, "health instanceId missing");
  assert(instance.url === normalizedUrl(expectedBaseUrl), `health instance URL mismatch: ${instance.url}`);
  assert(instance.protocolVersion === health.protocolVersion, "health instance protocol mismatch");
  assert(instance.buildId === health.buildId, "health instance build mismatch");
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

function expectNoMessage(
  socket,
  triggerObservedAction,
  observedAction,
  triggerBarrier,
  isBarrier,
  timeoutMs = 3_000
) {
  return new Promise((resolvePromise, reject) => {
    let observedResult;
    let barrierArmed = false;
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      cleanup();
      reject(new Error("Timed out waiting for the no-message ordering barrier"));
    }, timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!barrierArmed || !isBarrier(message)) {
        settled = true;
        cleanup();
        reject(new Error(`Received an unexpected automatic WebSocket message before the ordering barrier: ${raw.toString()}`));
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(observedResult);
    };
    const onError = (error) => {
      settled = true;
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
    triggerObservedAction();
    Promise.resolve(observedAction).then((result) => {
      if (settled) return;
      observedResult = result;
      barrierArmed = true;
      triggerBarrier();
    }, (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
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

function seedLegacyMigrationFixture(databasePath, sessionId) {
  const db = new Database(databasePath);
  try {
    const columns = db.prepare("PRAGMA table_info(ask_requests)").all();
    if (!columns.some(({ name }) => name === "urgency")) db.exec("ALTER TABLE ask_requests ADD COLUMN urgency TEXT");
    const insert = db.prepare(`INSERT OR IGNORE INTO ask_requests
      (request_id,session_id,mode,prompt,question_json,options_json,context_json,status,selected_values_json,note,rationale,
       created_at,expires_at,resolved_at,updated_at,urgency)
      VALUES (@id,@sessionId,'single',@prompt,@questionJson,'[{"value":"yes","label":"Yes"}]',@contextJson,
       @status,@selectedValues,@note,@rationale,@createdAt,@expiresAt,@resolvedAt,@updatedAt,@urgency)`);
    const createdAt = "2026-01-01T00:00:00.000Z";
    const terminalAt = "2026-01-01T00:01:00.000Z";
    const fixtures = [
      { id: "legacy-pending", status: "pending", prompt: "Pending legacy Question?" },
      { id: "legacy-answered", status: "answered", prompt: "Answered legacy Question?", selectedValues: '["yes"]' },
      { id: "legacy-cancelled", status: "cancelled", prompt: "Cancelled legacy Question?", note: "cancelled" },
      { id: "legacy-expired", status: "expired", prompt: "Expired legacy Question?", rationale: "expired" },
      { id: "legacy-rich-context", status: "answered", prompt: "Rich legacy Question?", selectedValues: '["yes"]',
        questionJson: '{"prompt":"Rich legacy Question?","context":"legacy detail"}',
        contextJson: '{"codebaseContext":"legacy code","problemContext":"legacy problem"}' },
      { id: "legacy-urgency", status: "answered", prompt: "Historical priority Question?", selectedValues: '["yes"]', urgency: "high" }
    ];
    for (const fixture of fixtures) insert.run({ sessionId, questionJson: null, contextJson: null, selectedValues: null,
      note: null, rationale: null, expiresAt: null, urgency: null, ...fixture,
      createdAt, resolvedAt: fixture.status === "pending" ? null : terminalAt, updatedAt: fixture.status === "pending" ? createdAt : terminalAt });
  } finally { db.close(); }
}

async function main() {
  assert(existsSync(cliPath), `Built CLI missing at ${cliPath}. Run npm run build first.`);
  assert(existsSync(join(serverPublicDir, "index.html")), `Packaged UI missing at ${serverPublicDir}. Run npm run build first.`);

  const tmp = await mkdtemp(join(tmpdir(), "pi-postbox-smoke-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const databasePath = join(tmp, "postbox.sqlite");
  const serverArgs = [
    cliPath,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--profile", "production",
    "--profile-state-dir", tmp,
    "--database", databasePath,
    "--ask-timeout-ms", "600000",
    "--no-tailscale"
  ];
  const serverOptions = {
    cwd: root,
    env: {
      ...process.env,
      PI_POSTBOX_CONFIG_DIR: tmp,
      PI_POSTBOX_CONFIG_PATH: join(tmp, "config.json"),
      PI_POSTBOX_TAILSCALE: "off"
    },
    stdio: ["ignore", "pipe", "pipe"]
  };

  let stderr = "";
  const launchServer = () => {
    const child = spawn(process.execPath, serverArgs, serverOptions);
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout?.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
    return child;
  };
  const stopServer = async (child) => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => child.once("exit", resolvePromise));
  };
  let server = launchServer();

  let socket;
  let claudeSocket;
  let codexSocket;
  let sse;
  let chatSse;
  try {
    const health = await waitForHealth(baseUrl);
    assert(health.ok === true && health.service === "pi-postbox", "Unexpected health response");
    assertCompatibleLocalTarget(health, baseUrl);

    const htmlResponse = await fetch(`${baseUrl}/`);
    assert(htmlResponse.status === 200 && htmlResponse.headers.get("content-type")?.includes("text/html"), "Server did not serve the packaged HTML shell");
    const html = await htmlResponse.text();
    assert(html.includes("Pi Postbox") || html.includes("root"), "Server did not serve the web shell");
    const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map((match) => match[1]);
    assert(assetPaths.some((path) => path.endsWith(".js")), "Packaged HTML did not reference a hashed JavaScript asset");
    assert(assetPaths.some((path) => path.endsWith(".css")), "Packaged HTML did not reference a hashed CSS asset");
    const assets = await Promise.all(assetPaths.map(async (path) => {
      const response = await fetch(`${baseUrl}${path}`);
      const expectedType = path.endsWith(".js") ? "javascript" : "text/css";
      assert(response.status === 200 && response.headers.get("content-type")?.includes(expectedType), `Packaged asset ${path} had the wrong status or content type`);
      return { path, text: await response.text() };
    }));
    const browserJavaScript = assets.filter(({ path }) => path.endsWith(".js")).map(({ text }) => text).join("\n");
    for (const starter of ["Elaborate", "Pro–Cons", "Teach me"]) {
      assert(browserJavaScript.includes(starter), `Packaged Question Chat UI is missing the ${starter} starter`);
    }
    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert(manifestResponse.status === 200 && manifestResponse.headers.get("content-type")?.includes("manifest"), "Packaged web manifest was unavailable");
    const manifest = await manifestResponse.json();
    const serviceWorkerResponse = await fetch(`${baseUrl}/sw.js`);
    assert(serviceWorkerResponse.status === 200 && serviceWorkerResponse.headers.get("content-type")?.includes("javascript"), "Packaged service worker was unavailable");
    const iconPaths = manifest.icons?.map((icon) => icon.src) ?? [];
    assert(iconPaths.some((path) => path.endsWith("postbox-icon-192.png")), "Packaged manifest omitted the 192px icon");
    assert(iconPaths.some((path) => path.endsWith("postbox-icon-512.png")), "Packaged manifest omitted the 512px icon");
    for (const iconPath of iconPaths) {
      const iconResponse = await fetch(new URL(iconPath, `${baseUrl}/`));
      assert(iconResponse.status === 200 && iconResponse.headers.get("content-type")?.includes("image/png"), `Packaged icon ${iconPath} was unavailable`);
    }

    sse = new SseClient(`${baseUrl}/api/state/events`);
    await sse.open();
    await sse.nextStateMatching((snapshot) => Array.isArray(snapshot.sessions) && snapshot.sessions.length === 0);

    socket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    const sessionId = `smoke-session-${randomUUID()}`;
    const requestId = `smoke-ask-${randomUUID()}`;
    const privateAssistantMessageId = `smoke-private-assistant-id-${randomUUID()}`;
    const privateAssistantText = `smoke-private-assistant-text-${randomUUID()}`;
    const privateUserMessageText = `smoke-private-user-prompt-${randomUUID()}`;
    const privateUserSteerText = `smoke-private-user-steer-${randomUUID()}`;
    const privateUserContinueText = `smoke-private-user-continue-${randomUUID()}`;
    const privateToolCallId = `smoke-private-tool-id-${randomUUID()}`;
    const privateRepositoryTarget = `src/smoke-private-target-${randomUUID()}.ts`;
    const privateRepositoryDetails = `smoke-private-repository-details-${randomUUID()}`;
    const privateMarkers = [
      privateAssistantMessageId,
      privateAssistantText,
      privateUserMessageText,
      privateUserSteerText,
      privateUserContinueText,
      privateToolCallId,
      privateRepositoryTarget,
      privateRepositoryDetails
    ];

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
          owner: { harness: "pi", ownerId: "99999999-9999-4999-8999-999999999999" },
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
    const contextReadyMessage = {
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
    };
    const noAutoTurnBarrierId = `smoke-no-auto-turn-${randomUUID()}`;
    const contextActivationResult = await expectNoMessage(
      socket,
      () => socket.send(JSON.stringify(contextReadyMessage)),
      contextActivationResponse,
      () => socket.send(JSON.stringify({
          type: "heartbeat",
          requestId: noAutoTurnBarrierId,
          payload: { sessionId, semanticState: "working" }
        })),
      (message) => message.type === "ack" && message.requestId === noAutoTurnBarrierId
    );
    assert(contextActivationResult.status === 200, "Context-only Question Chat did not activate explicitly");

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
      body: JSON.stringify({ clientCommandId, message: privateUserMessageText })
    });
    const sendCommand = await nextMessage(socket);
    assert(sendCommand.type === "chat.send" && sendCommand.payload.command.message === privateUserMessageText, "Fake runtime did not receive the first Question Chat message");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: sendCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId, mode: "turn" } }
    }));
    const firstSend = await sendResponse;
    assert(firstSend.status === 200 && (await firstSend.json()).mode === "turn", "First Chat send was not accepted as an ordinary turn");
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 1, type: "lifecycle", state: "generating" } }));
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: {
        requestId,
        sequence: 2,
        type: "tool.started",
        activity: { id: privateToolCallId, tool: "repository_read", target: privateRepositoryTarget, state: "running" }
      }
    }));
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: {
        requestId,
        sequence: 3,
        type: "tool.finished",
        activity: {
          id: privateToolCallId,
          tool: "repository_read",
          target: privateRepositoryTarget,
          state: "success",
          details: privateRepositoryDetails
        }
      }
    }));
    await chatSse.nextJsonMatching(
      (event) => event.type === "tool.finished" && event.activity?.details === privateRepositoryDetails,
      undefined
    );

    const steerCommandId = `smoke-chat-steer-${randomUUID()}`;
    const steerResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId: steerCommandId, message: privateUserSteerText })
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
      payload: { requestId, sequence: 4, type: "message.started", message: { id: privateAssistantMessageId, role: "assistant", text: "", status: "streaming" } }
    }));
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: { requestId, sequence: 5, type: "assistant.text.delta", messageId: privateAssistantMessageId, text: privateAssistantText }
    }));

    const stopCommandId = `smoke-chat-stop-${randomUUID()}`;
    const stopResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId: stopCommandId })
    });
    const stopCommand = await nextMessage(socket);
    assert(stopCommand.type === "chat.stop" && stopCommand.payload.command.clientCommandId === stopCommandId, "Fake runtime did not receive Chat Stop");
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 6, type: "lifecycle", state: "stopping" } }));
    socket.send(JSON.stringify({
      type: "chat.event",
      payload: { requestId, sequence: 7, type: "message.finished", messageId: privateAssistantMessageId, text: privateAssistantText, status: "stopped" }
    }));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 8, type: "lifecycle", state: "stopped" } }));
    socket.send(JSON.stringify({ type: "chat.event", payload: { requestId, sequence: 9, type: "lifecycle", state: "ready" } }));
    socket.send(JSON.stringify({
      type: "chat.stop.accepted",
      requestId: stopCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId: stopCommandId } }
    }));
    assert((await stopResponse).status === 200, "Chat Stop was not accepted");
    await chatSse.nextJsonMatching(
      (event) => event.type === "message.finished" && event.status === "stopped" && event.text === privateAssistantText,
      undefined
    );
    const pendingStateJson = JSON.stringify(await fetch(`${baseUrl}/api/state`).then((response) => response.json()));
    for (const privateMarker of privateMarkers) {
      assert(!pendingStateJson.includes(privateMarker), `Pending state persisted private Chat marker ${privateMarker}`);
    }

    chatSse.close();
    chatSse = undefined;
    sse.close();
    sse = undefined;
    await stopServer(server);
    socket.close();
    socket = undefined;
    // The migrated records deliberately use legacy-owner provenance rather
    // than borrowing the live Pi owner registered above.
    seedLegacyMigrationFixture(databasePath, sessionId);
    server = launchServer();
    await waitForHealth(baseUrl);

    socket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    const restartRegistered = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "session.register",
      requestId: "smoke-restart-register",
      payload: {
        machine: { machineId: "smoke-machine", hostname: "smoke-host", displayName: "Smoke Host" },
        project: { projectId: "smoke-project", name: "pi-postbox", cwd: root },
        session: { sessionId, cwd: root, semanticState: "working", owner: { harness: "pi", ownerId: "99999999-9999-4999-8999-999999999999" } }
      }
    }));
    assert((await restartRegistered).type === "registered", "Fake extension did not re-register after server restart");

    const replayCreated = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "ask.create",
      requestId: "smoke-replay-ask",
      payload: {
        requestId,
        sessionId,
        mode: "single",
        question: { prompt: "Is the release smoke path healthy?" },
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
        context: {
          codebaseContext: "Packaged Pi Postbox extension, server, protocol, and web assets.",
          problemContext: "Smoke verifies one remote handoff without full chat transcripts."
        }
      }
    }));
    assert((await replayCreated).type === "ask.created", "Pending ask did not replay after server restart");

    const recoveryDecision = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "chat.recover.offer",
      requestId: "smoke-recovery-offer",
      payload: { requestId, ownerSessionId: sessionId, forkKind: "context-only" }
    }));
    const decision = await recoveryDecision;
    assert(decision.type === "chat.reconcile" && decision.payload.action === "recover", "Server did not authorize pending Chat recovery");
    const recoveredSnapshot = {
      requestId,
      state: "ready",
      forkKind: "context-only",
      model: { id: "smoke/fake-model", source: "originating" },
      sequence: 9,
      messages: [{ id: privateAssistantMessageId, role: "assistant", text: privateAssistantText, status: "stopped" }],
      tools: [{ id: privateToolCallId, tool: "repository_read", target: privateRepositoryTarget, state: "success", details: privateRepositoryDetails }]
    };
    const recoveryAccepted = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "chat.reconciled",
      requestId: "smoke-recovery-offer",
      payload: { requestId, forkKind: "context-only", result: { status: "recovered", snapshot: recoveredSnapshot } }
    }));
    assert((await recoveryAccepted).type === "ack", "Server did not accept recovered Chat snapshot");
    socket.send(JSON.stringify({
      type: "chat.recover.complete",
      requestId: "smoke-recovery-complete",
      payload: { ownerSessionId: sessionId }
    }));

    const recoveredSnapshotResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat`);
    const recoveredSnapshotCommand = await nextMessage(socket);
    assert(recoveredSnapshotCommand.type === "chat.snapshot", "Recovered Chat did not accept a fresh snapshot request");
    socket.send(JSON.stringify({
      type: "chat.snapshot",
      requestId: recoveredSnapshotCommand.requestId,
      payload: recoveredSnapshot
    }));
    const recoveredBody = await (await recoveredSnapshotResponse).json();
    assert(recoveredBody.snapshot?.messages?.[0]?.text === privateAssistantText, "Server restart did not restore Chat from the extension fork");

    sse = new SseClient(`${baseUrl}/api/state/events`);
    await sse.open();
    await sse.nextStateMatching((snapshot) => snapshot.requests.some((request) => request.requestId === requestId && request.status === "pending"));

    const proposedState = sse.nextStateMatching((snapshot) => snapshot.requests.some((request) =>
      request.requestId === requestId && request.options.some((option) => option.provenance === "chat")
    ));
    const proposalResult = nextMessage(socket);
    socket.send(JSON.stringify({
      type: "chat.propose-answer",
      requestId: "smoke-proposal-command",
      payload: {
        requestId,
        proposal: {
          label: "Stage release first",
          description: "Verify the release with a limited cohort.",
          meaning: "Use a reversible rollout before full release."
        }
      }
    }));
    const proposal = await proposalResult;
    assert(
      proposal.type === "chat.propose-answer.result" &&
        proposal.requestId === "smoke-proposal-command" &&
        proposal.payload.requestId === requestId &&
        proposal.payload.result.status === "appended" &&
        proposal.payload.result.option.provenance === "chat",
      "Fake Question Chat could not append an authoritative answer option"
    );
    const proposedValue = proposal.payload.result.option.value;
    const proposalSnapshot = await proposedState;
    assert(
      proposalSnapshot.requests.find((request) => request.requestId === requestId)?.options.at(-1)?.value === proposedValue,
      "Chat-proposed option was not broadcast durably over state SSE"
    );

    const continueCommandId = `smoke-chat-continue-${randomUUID()}`;
    const continueResponse = fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientCommandId: continueCommandId, message: privateUserContinueText })
    });
    const continueCommand = await nextMessage(socket);
    assert(continueCommand.type === "chat.send" && continueCommand.payload.command.clientCommandId === continueCommandId, "Stopped Chat did not accept another turn");
    socket.send(JSON.stringify({
      type: "chat.send.accepted",
      requestId: continueCommand.requestId,
      payload: { requestId, response: { status: "accepted", clientCommandId: continueCommandId, mode: "turn" } }
    }));
    const continued = await continueResponse;
    assert(continued.status === 200 && (await continued.json()).mode === "turn", "Stopped Chat did not resume with an ordinary turn");

    const terminalMessagesPromise = nextMessages(socket, 1);
    const answerResponse = await fetch(`${baseUrl}/api/requests/${encodeURIComponent(requestId)}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 2, selectedValues: [proposedValue], note: "Smoke answered", rationale: "All release path checks passed." })
    });
    assert(answerResponse.status === 200, `Answer returned ${answerResponse.status}`);
    const terminalMessages = await terminalMessagesPromise;
    assert(terminalMessages.some((message) => message.type === "chat.cleanup" && message.payload.requestId === requestId), "Extension did not receive terminal Chat cleanup");
    await sse.nextStateMatching((snapshot) => !snapshot.requests.some((request) => request.requestId === requestId));

    const state = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert(state.sessions.some((session) => session.sessionId === sessionId), "State endpoint does not include registered session");
    assert(!state.requests.some((request) => request.requestId === requestId), "Live state still includes the answered request");
    const stateJson = JSON.stringify(state);
    for (const privateMarker of privateMarkers) {
      assert(!stateJson.includes(privateMarker), `State persisted private Chat marker ${privateMarker}`);
    }

    const history = await fetch(`${baseUrl}/api/history`).then((response) => response.json());
    assert(history.history.some((record) =>
      record.request.requestId === requestId &&
        record.request.result?.status === "answered" &&
        record.request.result.selectedValues?.[0] === proposedValue &&
        record.request.options.some((option) => option.value === proposedValue && option.provenance === "chat")
    ), "History endpoint does not include the answered Chat-proposed option");
    const historyJson = JSON.stringify(history);
    for (const privateMarker of privateMarkers) {
      assert(!historyJson.includes(privateMarker), `History persisted private Chat marker ${privateMarker}`);
    }

    const migrationState = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    const migratedPending = migrationState.requests.find((request) => request.requestId === "legacy-pending");
    assert(migratedPending?.status === "pending" && migratedPending.owner?.harness === "legacy",
      "Migrated pending Question did not retain offline legacy-owner provenance");
    const migratedIds = new Set(history.history.map((record) => record.request.requestId));
    for (const id of ["legacy-answered", "legacy-cancelled", "legacy-expired", "legacy-rich-context", "legacy-urgency"]) {
      assert(migratedIds.has(id), `Migrated History omitted ${id}`);
    }
    const migratedById = new Map(history.history.map((record) => [record.request.requestId, record.request]));
    assert(migratedById.get("legacy-answered")?.result?.status === "answered" &&
      migratedById.get("legacy-answered")?.result?.selectedValues?.[0] === "yes", "Migrated answered result was incomplete");
    assert(migratedById.get("legacy-cancelled")?.result?.status === "cancelled", "Migrated cancelled result was incomplete");
    assert(migratedById.get("legacy-expired")?.result?.status === "expired", "Migrated expired result was incomplete");
    assert(migratedById.get("legacy-rich-context")?.question?.context === "legacy detail" &&
      migratedById.get("legacy-rich-context")?.context?.problemContext === "legacy problem",
      "Migrated rich Question context was not preserved");
    assert([...migratedById.values()].every((request) => request.owner?.harness === "legacy" || !request.requestId.startsWith("legacy-")),
      "Legacy migration heuristically borrowed a live harness owner");
    assert(!JSON.stringify({ migrationState, history }).includes('"urgency"'), "Historical urgency leaked into owner contracts");
    const migrationDb = new Database(databasePath, { readonly: true });
    const migratedAnswer = migrationDb.prepare(`SELECT first_read_at, owner_notification_delivered_at FROM answers
      WHERE question_id='legacy-answered'`).get();
    migrationDb.close();
    assert(migratedAnswer.first_read_at && migratedAnswer.owner_notification_delivered_at,
      "Migrated terminal Answer was not retained as read and notification-suppressed");

    const registerHarness = async (target, harness, ownerId, suffix) => {
      const registration = nextMessage(target);
      target.send(JSON.stringify({ type: "session.register", requestId: `register-${suffix}`, payload: {
        machine: { machineId: "smoke-machine", hostname: "smoke-host" },
        project: { projectId: "smoke-project", name: "pi-postbox", cwd: root },
        session: { sessionId: `smoke-${suffix}`, cwd: root, semanticState: "working", owner: { harness, ownerId } }
      } }));
      assert((await registration).type === "registered", `${harness} fake adapter did not register`);
      return `smoke-${suffix}`;
    };
    claudeSocket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    codexSocket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    const claudeSessionId = await registerHarness(claudeSocket, "claude-code", "claude-smoke-owner", "claude");
    const codexSessionId = await registerHarness(codexSocket, "codex", "codex-smoke-owner", "codex");

    const sendCreate = async (target, id, ownerSessionId, parentQuestionId) => {
      const response = nextMessage(target);
      target.send(JSON.stringify({ type: "ask.create", requestId: `wire-${id}`, payload: {
        requestId: id, sessionId: ownerSessionId, mode: "single", question: { prompt: `${id}?` },
        options: [{ value: "yes", label: "Yes" }],
        context: { codebaseContext: "Packaged asynchronous acceptance.", problemContext: "Exercise the real server seam." },
        ...(parentQuestionId ? { parentQuestionId } : {})
      } }));
      const message = await response;
      assert(message.type === "ask.created", `${id} was not created asynchronously`);
    };

    // Drive the published ask_postbox batch tool through the production client
    // and its correlated batch WebSocket command.
    const parentId = `smoke-parent-${randomUUID()}`;
    const childId = `smoke-child-${randomUUID()}`;
    const batchSessionId = `batch-session-${randomUUID()}`;
    let batchConnected;
    const batchReady = new Promise((resolvePromise) => { batchConnected = resolvePromise; });
    const batchClient = new PostboxClient({ serverUrl: baseUrl, reconnect: false, onStatus: (status) => {
      if (status === "connected") batchConnected();
    }, registration: {
      machine: { machineId: "smoke-machine", hostname: "smoke-host" },
      project: { projectId: "smoke-project", name: "pi-postbox", cwd: root },
      session: { sessionId: batchSessionId, cwd: root, semanticState: "idle",
        owner: { harness: "pi", ownerId: "99999999-9999-4999-8999-999999999999" } }
    } });
    batchClient.start();
    await batchReady;
    const batchReceipt = await executeAskPostbox({
      mode: "batch",
      defaults: { context: { codebaseContext: "Packaged asynchronous acceptance.", problemContext: "Exercise the published batch tool." } },
      questions: [
      { localRef: "parent", requestId: parentId, question: `${parentId}?`, options: [{ value: "yes", label: "Yes" }] },
      { localRef: "child", requestId: childId, parent: { localRef: "parent" }, question: `${childId}?`, options: [{ value: "yes", label: "Yes" }],
        context: { codebaseContext: "Packaged asynchronous acceptance.", problemContext: "Exercise ordered localRef parenting." } }
    ] }, batchClient, batchSessionId);
    assert(batchReceipt.status === "created" && batchReceipt.items.length === 2 &&
      batchReceipt.items[1].localRef === "child" && batchReceipt.items[1].questionId === childId,
      "Published ask_postbox batch receipt did not preserve localRef ordering");
    batchClient.stop();
    const simultaneous = await sse.nextStateMatching((snapshot) =>
      snapshot.requests.some((request) => request.requestId === parentId) &&
      snapshot.requests.some((request) => request.requestId === childId));
    assert(simultaneous.requests.find((request) => request.requestId === childId)?.parentQuestionId === parentId,
      "Ordered batch child did not retain its parent reference");

    const idleAck = nextMessage(socket);
    socket.send(JSON.stringify({ type: "heartbeat", requestId: "owner-idle-for-ping", payload: { sessionId, semanticState: "idle" } }));
    assert((await idleAck).type === "ack", "Owner did not become idle for deferred Answer delivery");
    const pingPromise = nextMessage(socket);
    const parentAnswer = await fetch(`${baseUrl}/api/requests/${parentId}/answer`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, selectedValues: ["yes"] }) });
    assert(parentAnswer.status === 200, "Browser could not answer ordered parent Question");
    const ping = await pingPromise;
    const answerPings = [ping].filter((message) => message.type === "answer.available");
    const pingCount = answerPings.length;
    assert(pingCount === 1, "Owner did not receive exactly one lightweight Answer ping");
    socket.send(JSON.stringify({ type: "answer.available.ack", requestId: "parent-ping-ack", payload: { answerId: ping.payload.answerId } }));
    const explicitAnswer = nextMessage(socket);
    socket.send(JSON.stringify({ type: "answer.get", requestId: "explicit-get-answer", payload: { questionId: parentId } }));
    const explicitAnswerMessage = await explicitAnswer;
    assert(explicitAnswerMessage.type === "answer.result", `Explicit get_answer did not return the full Answer (${JSON.stringify(explicitAnswerMessage)})`);
    const duplicateWindow = nextMessage(socket);
    socket.send(JSON.stringify({ type: "heartbeat", requestId: "ping-dedupe-heartbeat", payload: { sessionId, semanticState: "idle" } }));
    assert((await duplicateWindow).type === "ack", "A second visible notification appeared during the heartbeat dedupe window");
    socket.close();
    await new Promise((resolvePromise) => socket.once("close", resolvePromise));
    socket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    // Re-register the original durable session identity, not a replacement.
    const reconnect = nextMessage(socket);
    socket.send(JSON.stringify({ type: "session.register", requestId: "ping-dedupe-reconnect", payload: {
      machine: { machineId: "smoke-machine", hostname: "smoke-host" }, project: { projectId: "smoke-project", name: "pi-postbox", cwd: root },
      session: { sessionId, cwd: root, semanticState: "idle", owner: { harness: "pi", ownerId: "99999999-9999-4999-8999-999999999999" } }
    } }));
    assert((await reconnect).type === "registered", "Pi owner did not reconnect for notification dedupe proof");
    const reconnectDuplicateWindow = nextMessage(socket);
    socket.send(JSON.stringify({ type: "heartbeat", requestId: "ping-dedupe-after-reconnect", payload: { sessionId, semanticState: "idle" } }));
    assert((await reconnectDuplicateWindow).type === "ack", "Acknowledged Answer replayed a visible notification after reconnect/restart");

    const waitResult = nextMessage(socket);
    socket.send(JSON.stringify({ type: "postbox.wait", requestId: "wait.start", payload: { sessionId } }));
    const childAnswer = await fetch(`${baseUrl}/api/requests/${childId}/answer`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, selectedValues: ["yes"] }) });
    assert(childAnswer.status === 200, "Browser could not wake explicit wait");
    const waited = await waitResult;
    assert(waited.type === "postbox.wait.result" && waited.payload.type === "answer", "wait.result did not wake with the full Answer");

    const raceId = `smoke-race-${randomUUID()}`;
    await sendCreate(codexSocket, raceId, codexSessionId);
    const racePayload = { expectedRevision: 1, selectedValues: ["yes"] };
    const [firstBrowser, secondBrowser] = await Promise.all([
      fetch(`${baseUrl}/api/requests/${raceId}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(racePayload) }),
      fetch(`${baseUrl}/api/requests/${raceId}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(racePayload) })
    ]);
    const firstAnswerWins = [firstBrowser.status, secondBrowser.status].sort().join(",");
    assert(firstAnswerWins === "200,409", `First-answer-wins race returned ${firstAnswerWins}`);
    const revisionId = `smoke-revision-${randomUUID()}`;
    await sendCreate(codexSocket, revisionId, codexSessionId);
    const revisionState = sse.nextStateMatching((snapshot) => snapshot.requests.some((request) => request.requestId === revisionId && request.revision === 2));
    const revised = nextMessage(codexSocket);
    codexSocket.send(JSON.stringify({ type: "question.update", requestId: "authoritative-browser-update", payload: {
      sessionId: codexSessionId, questionId: revisionId,
      update: { action: "revise", expectedRevision: 1, expectedOwnerRevision: 1, question: { prompt: "Authoritative browser revision?" } }
    } }));
    assert((await revised).type === "query.result", "Authoritative revision was rejected");
    await revisionState;
    const stale = await fetch(`${baseUrl}/api/requests/${revisionId}/answer`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, selectedValues: ["yes"] }) });
    const staleBody = await stale.json();
    assert(stale.status >= 400 && (staleBody.error?.code === "stale_revision" || staleBody.error === "stale_revision" || staleBody.code === "stale_revision"),
      `stale_revision was not invalidated (${JSON.stringify(staleBody)})`);

    const takeoverId = `smoke-takeover-${randomUUID()}`;
    await sendCreate(claudeSocket, takeoverId, claudeSessionId);
    const onlineTakeover = nextMessage(codexSocket);
    codexSocket.send(JSON.stringify({ type: "question.update", requestId: "online-takeover-rejected", payload: {
      sessionId: codexSessionId, questionId: takeoverId, update: { action: "takeover", expectedRevision: 1, expectedOwnerRevision: 1,
        expectedOwner: { harness: "claude-code", ownerId: "claude-smoke-owner" } }
    } }));
    assert((await onlineTakeover).type === "error", "owner_not_offline takeover was accepted while Claude Code was live");
    claudeSocket.close();
    await new Promise((resolvePromise) => claudeSocket.once("close", resolvePromise));
    claudeSocket = undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const presence = nextMessage(codexSocket);
      codexSocket.send(JSON.stringify({ type: "owner.status.get", requestId: `claude-offline-${attempt}`,
        payload: { owners: [{ harness: "claude-code", ownerId: "claude-smoke-owner" }] } }));
      const status = await presence;
      if (status.type === "query.result" && Array.isArray(status.payload) && status.payload[0]?.presence === "offline") break;
      if (attempt === 19) throw new Error("Claude Code owner did not become offline before takeover");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    const takeover = nextMessage(codexSocket);
    codexSocket.send(JSON.stringify({ type: "question.update", requestId: "offline-takeover", payload: {
      sessionId: codexSessionId, questionId: takeoverId, update: { action: "takeover", expectedRevision: 1, expectedOwnerRevision: 1,
        expectedOwner: { harness: "claude-code", ownerId: "claude-smoke-owner" } }
    } }));
    assert((await takeover).type === "query.result", "Codex could not take over the offline Claude Code owner");
    const questionHistory = nextMessage(codexSocket);
    codexSocket.send(JSON.stringify({ type: "question.history.get", requestId: "takeover-history", payload: { questionId: takeoverId } }));
    assert((await questionHistory).type === "query.result", "question.history.get did not retain takeover audit History");

    claudeSocket = await connectSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
    await registerHarness(claudeSocket, "claude-code", "claude-smoke-owner", "claude");
    const raceRead = nextMessage(codexSocket);
    codexSocket.send(JSON.stringify({ type: "answer.get", requestId: "race-read-before-capacity", payload: { questionId: raceId } }));
    assert((await raceRead).type === "answer.result", "Codex race Answer was not explicitly consumed before capacity test");
    const capacityPi = `capacity-pi-${randomUUID()}`;
    const capacityClaude = `capacity-claude-${randomUUID()}`;
    const capacityCodex = `capacity-codex-${randomUUID()}`;
    await sendCreate(socket, capacityPi, sessionId);
    await sendCreate(claudeSocket, capacityClaude, claudeSessionId);
    await sendCreate(codexSocket, capacityCodex, codexSessionId);

    // Invoke the production wait_for_postbox tool under the fake adapter's
    // actual runnable-slot limiter for Pi, Claude Code, and Codex.
    const limiter = new AdapterRunnableSlotLimiter(2);
    const runHarnessWait = (harness, target, harnessSessionId, signal) => {
      const waitRequestId = `capacity-wait-${harness}`;
      const tool = createWaitForPostboxTool((toolSignal) => new Promise((resolvePromise, reject) => {
        const response = nextMessage(target, 10_000);
        target.send(JSON.stringify({ type: "postbox.wait", requestId: waitRequestId, payload: { sessionId: harnessSessionId } }));
        const onAbort = () => {
          target.send(JSON.stringify({ type: "postbox.wait.cancel", requestId: `cancel-${harness}`,
            payload: { sessionId: harnessSessionId, waitRequestId } }));
          reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
        };
        toolSignal?.addEventListener("abort", onAbort, { once: true });
        void response.then((message) => resolvePromise(message.payload), reject);
      }));
      return limiter.run(() => tool.execute(`wait-${harness}`, {}, signal));
    };
    assert(ownerFromNativeIdentity({ harness: "pi", sessionUuid: "pi-native-session" }).ownerId === "pi-native-session" &&
      ownerFromNativeIdentity({ harness: "claude-code", agentId: "claude-native-agent", sessionId: "broader-run" }).ownerId === "claude-native-agent" &&
      ownerFromNativeIdentity({ harness: "codex", threadId: "codex-native-thread", sessionId: "broader-run" }).ownerId === "codex-native-thread",
    "Harness adapter identity mapping did not preserve native authority identifiers");
    const piController = new AbortController();
    const claudeController = new AbortController();
    const piWait = runHarnessWait("pi", socket, sessionId, piController.signal);
    const claudeWait = runHarnessWait("claude-code", claudeSocket, claudeSessionId, claudeController.signal);
    let capacityBlocked = false;
    try { runHarnessWait("codex", codexSocket, codexSessionId, new AbortController().signal); }
    catch (error) { capacityBlocked = error instanceof Error && error.message === "runnable capacity exhausted"; }
    assert(capacityBlocked, "Third harness did not retain configured wait_for_postbox capacity");
    const wakePi = await fetch(`${baseUrl}/api/requests/${capacityPi}/answer`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, selectedValues: ["yes"] }) });
    assert(wakePi.status === 200 && (await piWait).details.type === "answer", "wakeFreesSlot did not wake Pi and release capacity");
    const codexController = new AbortController();
    const codexWait = runHarnessWait("codex", codexSocket, codexSessionId, codexController.signal);
    claudeController.abort();
    await claudeWait.catch((error) => assert(error.name === "AbortError", "cancelFreesSlot returned the wrong error"));
    const wakeCodex = await fetch(`${baseUrl}/api/requests/${capacityCodex}/answer`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, selectedValues: ["yes"] }) });
    assert(wakeCodex.status === 200 && (await codexWait).details.type === "answer" && limiter.occupiedSlots === 0,
      "Codex wait did not wake or release retained capacity");

    console.log("Pi Postbox smoke passed: health, UI shell, fake extension, async owner single/ordered batch, browser races, ping/get_answer/wait, offline takeover, migration, capacity, Question Chat, restart, and History verified.");
  } finally {
    chatSse?.close();
    sse?.close();
    socket?.close();
    claudeSocket?.close();
    codexSocket?.close();
    await stopServer(server);
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
