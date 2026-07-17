import { StateSnapshotSchema, type ExtensionClientMessage, type StateSnapshot } from "@pi-postbox/protocol";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPostboxApp } from "../src/app.js";

const apps: Array<{ close: () => Promise<void> }> = [];
const sockets: WebSocket[] = [];
const sseClients: SseClient[] = [];

afterEach(async () => {
  for (const client of sseClients.splice(0)) client.close();
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function listenerPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function registrationMessage(): ExtensionClientMessage {
  return {
    type: "session.register",
    requestId: "register-1",
    payload: {
      machine: { machineId: "machine-1", hostname: "workstation" },
      project: { projectId: "project-1", name: "pi-postbox", cwd: "/repo", branch: "main" },
      session: { sessionId: "session-1", title: "Reactive answer loop", cwd: "/repo", branch: "main", semanticState: "working" }
    }
  };
}

async function connectAndRegister(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/extension/ws`);
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const registered = nextMessage(socket);
  socket.send(JSON.stringify(registrationMessage()));
  await expect(registered).resolves.toMatchObject({ type: "registered" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
}

async function openSseClient(port: number): Promise<SseClient> {
  const client = new SseClient(`http://127.0.0.1:${port}/api/state/events`);
  await client.open();
  sseClients.push(client);
  return client;
}

class SseClient {
  private readonly controller = new AbortController();
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private buffer = "";
  private readonly decoder = new TextDecoder();

  constructor(private readonly url: string) {}

  async open(): Promise<void> {
    const response = await fetch(this.url, { signal: this.controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    if (!response.body) throw new Error("Expected SSE response body");
    this.reader = response.body.getReader();
  }

  async nextStateMatching(predicate: (snapshot: StateSnapshot) => boolean, timeoutMs = 1_500): Promise<StateSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await this.nextState(deadline - Date.now());
      if (predicate(snapshot)) return snapshot;
    }
    throw new Error("Timed out waiting for matching SSE state snapshot");
  }

  close(): void {
    this.controller.abort();
    void this.reader?.cancel().catch(() => undefined);
  }

  private async nextState(timeoutMs: number): Promise<StateSnapshot> {
    while (true) {
      const parsed = this.shiftParsedStateEvent();
      if (parsed) return parsed;

      if (!this.reader) throw new Error("SSE client is not open");
      const read = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for SSE data")), Math.max(timeoutMs, 1))
        )
      ]);
      if (read.done) throw new Error("SSE stream closed");
      this.buffer += this.decoder.decode(read.value, { stream: true });
    }
  }

  private shiftParsedStateEvent(): StateSnapshot | undefined {
    const boundary = this.buffer.indexOf("\n\n");
    if (boundary === -1) return undefined;

    const rawEvent = this.buffer.slice(0, boundary);
    this.buffer = this.buffer.slice(boundary + 2);

    const lines = rawEvent.split("\n");
    const eventName = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
    const data = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n");

    if (eventName !== "state" || !data) return this.shiftParsedStateEvent();
    return StateSnapshotSchema.parse(JSON.parse(data));
  }
}

describe("browser state SSE reactivity", () => {
  it("broadcasts pending and resolved request state to two clients while first answer wins", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 5_000 });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = listenerPort(app);

    const clientA = await openSseClient(port);
    const clientB = await openSseClient(port);

    await expect(clientA.nextStateMatching((snapshot) => snapshot.sessions.length === 0)).resolves.toMatchObject({ requests: [] });
    await expect(clientB.nextStateMatching((snapshot) => snapshot.sessions.length === 0)).resolves.toMatchObject({ requests: [] });

    const socket = await connectAndRegister(port);
    await expect(clientA.nextStateMatching((snapshot) => snapshot.sessions.some((session) => session.sessionId === "session-1"))).resolves.toMatchObject({
      sessions: [expect.objectContaining({ sessionId: "session-1", presence: "live" })]
    });
    await expect(clientB.nextStateMatching((snapshot) => snapshot.sessions.some((session) => session.sessionId === "session-1"))).resolves.toMatchObject({
      sessions: [expect.objectContaining({ sessionId: "session-1", presence: "live" })]
    });

    const created = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "ask.create",
        requestId: "wire-reactive-ask",
        payload: {
          requestId: "ask-reactive",
          sessionId: "session-1",
          mode: "single",
          question: { prompt: "Which client wins?" },
          options: [
            { value: "first", label: "First browser" },
            { value: "second", label: "Second browser" }
          ],
          context: {
            codebaseContext: "Fastify state broadcaster with browser SSE clients.",
            problemContext: "Broadcast one pending decision consistently to connected clients."
          }
        }
      } satisfies ExtensionClientMessage)
    );
    await expect(created).resolves.toMatchObject({ type: "ask.created", payload: { requestId: "ask-reactive" } });

    const pendingA = await clientA.nextStateMatching((snapshot) =>
      snapshot.requests.some((request) => request.requestId === "ask-reactive" && request.status === "pending")
    );
    const pendingB = await clientB.nextStateMatching((snapshot) =>
      snapshot.requests.some((request) => request.requestId === "ask-reactive" && request.status === "pending")
    );
    expect(pendingA.requests[0]).toMatchObject({ requestId: "ask-reactive", status: "pending" });
    expect(pendingB.requests[0]).toMatchObject({ requestId: "ask-reactive", status: "pending" });

    const resolvedA = clientA.nextStateMatching((snapshot) =>
      snapshot.requests.some((request) => request.requestId === "ask-reactive" && request.status === "answered")
    );
    const resolvedB = clientB.nextStateMatching((snapshot) =>
      snapshot.requests.some((request) => request.requestId === "ask-reactive" && request.status === "answered")
    );
    const answerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-reactive/answer",
      payload: { selectedValues: ["first"], note: "Client A got there first" }
    });
    expect(answerResponse.statusCode).toBe(200);

    await expect(resolvedA).resolves.toMatchObject({
      requests: [expect.objectContaining({ requestId: "ask-reactive", status: "answered" })]
    });
    await expect(resolvedB).resolves.toMatchObject({
      requests: [expect.objectContaining({ requestId: "ask-reactive", status: "answered" })]
    });

    const lateAnswerResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-reactive/answer",
      payload: { selectedValues: ["second"], note: "Too late" }
    });
    expect(lateAnswerResponse.statusCode).toBe(409);
    expect(lateAnswerResponse.json()).toMatchObject({ error: "request_already_resolved" });

    const lateCancelResponse = await app.inject({
      method: "POST",
      url: "/api/requests/ask-reactive/cancel",
      payload: { note: "Also too late" }
    });
    expect(lateCancelResponse.statusCode).toBe(409);
    expect(lateCancelResponse.json()).toMatchObject({ error: "request_already_resolved" });
  });
});
