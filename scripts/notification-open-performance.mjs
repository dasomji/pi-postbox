#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createPostboxApp } from "../packages/server/dist/app.js";

const COLD_BUDGET_MS = 5_000;
const WARM_BUDGET_MS = 1_000;
const DYNAMIC_JSON_BUDGET_BYTES = 100 * 1024;
const LARGE_HISTORY_COUNT = 400;
const TARGET_REQUEST_ID = "notification-performance-target";
const TARGET_PROMPT = "Which bounded notification-open rollout should we ship?";
const TARGET_OPTION_LABEL = "Ship the bounded path";
const UI_DIST_DIR = resolve("packages/server/dist/public");

if (!existsSync(resolve(UI_DIST_DIR, "index.html"))) {
  throw new Error("Production web assets are missing. Run `npm run build` before this harness.");
}

const evidence = { profile: mobileProfile(), fixtures: [] };
let chrome;
let cdp;
let targetId;
let sessionId;

async function main() {
  try {
    chrome = await launchChrome();
    cdp = await CdpConnection.open(chrome.webSocketUrl);
    ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }));
    ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }));
    await Promise.all([
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Network.enable", {}, sessionId),
      cdp.send("Runtime.enable", {}, sessionId)
    ]);
    await cdp.send("Network.emulateNetworkConditions", mobileProfile(), sessionId);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }, sessionId);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserInstrumentation(TARGET_PROMPT, TARGET_OPTION_LABEL)
    }, sessionId);

    const compact = await runFixture({ historyCount: 0, label: "compact-history", cold: true });
    const large = await runFixture({ historyCount: LARGE_HISTORY_COUNT, label: "large-history", cold: true, warm: true });
    evidence.fixtures.push(compact, large);

    const liveByteGrowth = Math.abs(large.liveStateBytes - compact.liveStateBytes);
    evidence.liveStateByteGrowth = liveByteGrowth;
    assert(liveByteGrowth <= 512, `terminal retention changed live-state JSON by ${liveByteGrowth} bytes`);

    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  } finally {
    if (cdp && targetId) await cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
    cdp?.close();
    await chrome?.close();
  }
}

async function runFixture({ historyCount, label, cold, warm = false }) {
  console.error(`[notification-performance] seeding ${label} (${historyCount} terminal records)`);
  const fixture = await startSeededServer(historyCount);
  console.error(`[notification-performance] measuring ${label}`);
  try {
    const liveResponse = await fetch(`${fixture.baseUrl}/api/state`, { headers: { "accept-encoding": "identity" } });
    const liveText = await liveResponse.text();
    const liveState = JSON.parse(liveText);
    assert(liveState.requests.length === 1, `${label}: expected one pending request in live state`);
    assert(liveState.requests[0]?.requestId === TARGET_REQUEST_ID, `${label}: wrong pending request in live state`);

    const historyResponse = await fetch(`${fixture.baseUrl}/api/history`, { headers: { "accept-encoding": "identity" } });
    const history = await historyResponse.json();
    assert(history.history.length === historyCount, `${label}: expected ${historyCount} retained History records`);

    const result = {
      label,
      historyCount,
      liveStateBytes: Buffer.byteLength(liveText),
      runs: []
    };
    if (cold) result.runs.push(await measureNotificationOpen(fixture.baseUrl, "cold", COLD_BUDGET_MS));
    if (warm) result.runs.push(await measureNotificationOpen(fixture.baseUrl, "warm", WARM_BUDGET_MS));
    return result;
  } finally {
    console.error(`[notification-performance] closing ${label}`);
    await cdp.send("Page.navigate", { url: "about:blank" }, sessionId).catch(() => undefined);
    await waitFor(() => cdp.evaluate(sessionId, "location.href === 'about:blank'")).catch(() => undefined);
    await fixture.close();
  }
}

async function startSeededServer(historyCount) {
  const app = await createPostboxApp({
    databasePath: ":memory:",
    uiDistDir: UI_DIST_DIR,
    expirySweepMs: 0
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(`${baseUrl.replace("http:", "ws:")}/api/extension/ws`);
  await websocketOpen(socket);
  await websocketExchange(socket, registrationMessage(), (message) => message.type === "registered");

  for (let index = 0; index < historyCount; index += 1) {
    if (index > 0 && index % 100 === 0) console.error(`[notification-performance] seeded ${index}/${historyCount}`);
    const requestId = `retained-terminal-${String(index).padStart(3, "0")}`;
    await createQuestion(socket, requestId, `Retained decision ${index}`);
    const answer = await app.inject({
      method: "POST",
      url: `/api/requests/${requestId}/answer`,
      payload: { selectedValues: ["ship"] }
    });
    assert(answer.statusCode === 200, `Could not resolve fixture request ${requestId}: ${answer.body}`);
  }
  await createQuestion(socket, TARGET_REQUEST_ID, TARGET_PROMPT);

  return {
    baseUrl,
    async close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        const closed = new Promise((resolvePromise) => socket.addEventListener("close", resolvePromise, { once: true }));
        socket.close();
        await Promise.race([closed, delay(2_000)]);
      }
      app.server.closeAllConnections?.();
      await app.close();
    }
  };
}

function registrationMessage() {
  return {
    type: "session.register",
    requestId: "register-performance-session",
    payload: {
      machine: {
        machineId: "machine-performance",
        hostname: "performance.local",
        displayName: "Performance fixture"
      },
      project: {
        projectId: "project-performance",
        name: "pi-postbox",
        displayName: "Notification performance",
        cwd: "/fixtures/pi-postbox",
        gitRoot: "/fixtures/pi-postbox",
        repoName: "pi-postbox",
        branch: "main",
        isDirty: false
      },
      session: {
        sessionId: "session-performance",
        title: "Notification performance fixture",
        cwd: "/fixtures/pi-postbox",
        branch: "main",
        semanticState: "blocked"
      }
    }
  };
}

function questionMessage(requestId, prompt) {
  return {
    type: "ask.create",
    requestId: `wire-${requestId}`,
    payload: {
      requestId,
      sessionId: "session-performance",
      mode: "single",
      urgency: "normal",
      question: {
        prompt,
        context: "A normal-sized pending question used by the notification-open acceptance harness.",
        relevance: "The browser journey must stay fast as retained History grows.",
        decisionImpact: "This validates the bounded live-state contract."
      },
      options: [
        { value: "ship", label: TARGET_OPTION_LABEL, description: "Use the bounded pending-only path." },
        { value: "hold", label: "Hold for more evidence", description: "Do not ship this path yet." }
      ],
      context: {
        codebaseContext: "A production Pi Postbox web build is served by the real Fastify application.",
        problemContext: "The notification-open journey is measured under deterministic mobile throttling."
      }
    }
  };
}

async function createQuestion(socket, requestId, prompt) {
  await websocketExchange(
    socket,
    questionMessage(requestId, prompt),
    (message) => message.type === "ask.created" && message.payload?.requestId === requestId
  );
}

async function measureNotificationOpen(baseUrl, cacheMode, budgetMs) {
  await cdp.send("Page.navigate", { url: "about:blank" }, sessionId);
  await waitFor(() => cdp.evaluate(sessionId, "location.href === 'about:blank'"));

  if (cacheMode === "cold") {
    await cdp.send("Network.clearBrowserCache", {}, sessionId);
    await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" }, sessionId);
  }

  const requests = [];
  const stopListening = cdp.on("Network.requestWillBeSent", (event, eventSessionId) => {
    if (eventSessionId !== sessionId) return;
    if (!event.request.url.startsWith(baseUrl)) return;
    requests.push({ url: event.request.url, type: event.type, method: event.request.method });
  });

  const url = `${baseUrl}/?notificationRequestId=${encodeURIComponent(TARGET_REQUEST_ID)}&performanceRun=${cacheMode}-${Date.now()}`;
  try {
    await cdp.send("Page.navigate", { url }, sessionId);
    await waitFor(
      () => cdp.evaluate(sessionId, "Boolean(window.__postboxPerformance?.questionVisibleAtMs)"),
      Math.max(15_000, budgetMs * 3)
    );
    await delay(250);

    const browser = await cdp.evaluate(sessionId, `(() => ({
      diagnostic: window.__postboxPerformance,
      bodyText: document.body?.innerText?.slice(0, 500) ?? "",
      href: location.href
    }))()`);
    const paths = requests.map((request) => new URL(request.url).pathname);
    const stateHttpCount = paths.filter((path) => path === "/api/state").length;
    const stateStreamCount = paths.filter((path) => path === "/api/state/events").length;
    const historyCount = paths.filter((path) => path === "/api/history").length;
    const diagnostic = browser.diagnostic;
    const run = {
      cacheMode,
      questionVisibleAtMs: Math.round(diagnostic.questionVisibleAtMs),
      dynamicJsonBytesBeforeRender: diagnostic.dynamicJsonBytesBeforeRender,
      fetchPathsBeforeRender: diagnostic.fetchesBeforeRender.map((entry) => entry.path),
      stateEventsBeforeRender: diagnostic.stateEventsBeforeRender,
      stateEventBytesBeforeRender: diagnostic.stateEventBytesBeforeRender,
      stateHttpCount,
      stateStreamCount,
      historyCount,
      originRequestPaths: paths
    };

    assert(run.questionVisibleAtMs <= budgetMs, `${cacheMode}: question rendered in ${run.questionVisibleAtMs}ms (budget ${budgetMs}ms)`);
    assert(stateHttpCount + stateStreamCount === 1, `${cacheMode}: expected one initial live-state retrieval, got HTTP=${stateHttpCount}, SSE=${stateStreamCount}`);
    assert(stateStreamCount === 1, `${cacheMode}: expected the event stream to be the initial snapshot authority`);
    assert(run.stateEventsBeforeRender === 1, `${cacheMode}: expected one initial state event before render, got ${run.stateEventsBeforeRender}`);
    assert(historyCount === 0, `${cacheMode}: History was requested before the target rendered`);
    assert(
      run.dynamicJsonBytesBeforeRender <= DYNAMIC_JSON_BUDGET_BYTES,
      `${cacheMode}: pre-render dynamic JSON was ${run.dynamicJsonBytesBeforeRender} bytes (budget ${DYNAMIC_JSON_BUDGET_BYTES})`
    );
    assert(browser.bodyText.includes(TARGET_PROMPT), `${cacheMode}: target prompt was not rendered`);
    return run;
  } catch (error) {
    const diagnostic = await cdp.evaluate(sessionId, "window.__postboxPerformance ?? null").catch(() => null);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; evidence=${JSON.stringify({ requests, diagnostic })}`);
  } finally {
    stopListening();
  }
}

function browserInstrumentation(targetPrompt, targetOptionLabel) {
  return `(() => {
    const encoder = new TextEncoder();
    const diagnostic = window.__postboxPerformance = {
      questionVisibleAtMs: null,
      dynamicJsonBytesBeforeRender: 0,
      stateEventsBeforeRender: 0,
      stateEventBytesBeforeRender: 0,
      fetchesBeforeRender: []
    };
    const isRenderedAndAnswerable = () => {
      if (diagnostic.questionVisibleAtMs !== null || !document.body) return;
      const text = document.body.innerText;
      const buttons = [...document.querySelectorAll("button")];
      const hasSubmit = buttons.some((button) => button.textContent?.trim().includes("Submit"));
      const hasOption = buttons.some((button) => button.textContent?.includes(${JSON.stringify(targetOptionLabel)}));
      if (text.includes(${JSON.stringify(targetPrompt)}) && hasSubmit && hasOption) {
        diagnostic.questionVisibleAtMs = performance.now();
      }
    };
    new MutationObserver(isRenderedAndAnswerable).observe(document, {
      subtree: true,
      childList: true,
      characterData: true
    });

    const NativeEventSource = window.EventSource;
    function MeasuredEventSource(url, options) {
      const source = new NativeEventSource(url, options);
      if (new URL(String(url), location.href).pathname === "/api/state/events") {
        source.addEventListener("state", (event) => {
          if (diagnostic.questionVisibleAtMs === null) {
            const bytes = encoder.encode(event.data).byteLength;
            diagnostic.stateEventsBeforeRender += 1;
            diagnostic.stateEventBytesBeforeRender += bytes;
            diagnostic.dynamicJsonBytesBeforeRender += bytes;
          }
        });
      }
      return source;
    }
    MeasuredEventSource.prototype = NativeEventSource.prototype;
    Object.defineProperties(MeasuredEventSource, {
      CONNECTING: { value: NativeEventSource.CONNECTING },
      OPEN: { value: NativeEventSource.OPEN },
      CLOSED: { value: NativeEventSource.CLOSED }
    });
    window.EventSource = MeasuredEventSource;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const path = new URL(url, location.href).pathname;
      const beganBeforeRender = diagnostic.questionVisibleAtMs === null;
      const response = await nativeFetch(...args);
      if (beganBeforeRender && (path === "/healthz" || path.startsWith("/api/"))) {
        const entry = { path, bodyBytes: 0 };
        diagnostic.fetchesBeforeRender.push(entry);
        response.clone().text().then((body) => {
          entry.bodyBytes = encoder.encode(body).byteLength;
          diagnostic.dynamicJsonBytesBeforeRender += entry.bodyBytes;
        }).catch(() => {});
      }
      return response;
    };
  })()`;
}

function mobileProfile() {
  return {
    offline: false,
    latency: 100,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
    connectionType: "cellular4g"
  };
}

async function launchChrome() {
  const userDataDir = await mkdtemp(resolve(tmpdir(), "pi-postbox-performance-chrome-"));
  const executable = process.env.CHROME_BIN ?? "google-chrome";
  const child = spawn(executable, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-gpu",
    "--no-sandbox",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const webSocketUrl = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools")), 10_000);
    const lines = createInterface({ input: child.stderr });
    const fail = (error) => {
      clearTimeout(timeout);
      lines.close();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Chrome exited before DevTools was ready (${code})`)));
    lines.on("line", (line) => {
      const match = line.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timeout);
      lines.close();
      resolvePromise(match[1]);
    });
  });

  return {
    webSocketUrl,
    async close() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolvePromise) => child.once("exit", resolvePromise)),
          delay(2_000)
        ]);
      }
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise((resolvePromise) => child.once("exit", resolvePromise));
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(userDataDir, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 4) throw error;
          await delay(100);
        }
      }
    }
  };
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("Chrome DevTools connection closed"));
      this.pending.clear();
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await websocketOpen(socket);
    return new CdpConnection(socket);
  }

  send(method, params = {}, session) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }

  async evaluate(session, expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    return result.result.value;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }

  handleMessage(raw) {
    const message = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result);
      return;
    }
    if (!message.method) return;
    for (const listener of this.listeners.get(message.method) ?? []) {
      listener(message.params, message.sessionId);
    }
  }
}

async function websocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out opening WebSocket")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolvePromise();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connection failed"));
    }, { once: true });
  });
}

async function websocketExchange(socket, outgoing, predicate) {
  const response = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${outgoing.type} response`));
    }, 10_000);
    const onMessage = (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolvePromise(message);
    };
    socket.addEventListener("message", onMessage);
  });
  socket.send(JSON.stringify(outgoing));
  return response;
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw lastError ?? new Error(`Timed out after ${timeoutMs}ms`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

await main();
