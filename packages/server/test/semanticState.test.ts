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
      session: { sessionId: "session-1", title: "Semantic state", cwd: "/repo", branch: "main", semanticState: "idle" }
    }
  };
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
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
    if (!response.body) throw new Error("Expected SSE body");
    this.reader = response.body.getReader();
  }

  async nextStateMatching(predicate: (snapshot: StateSnapshot) => boolean, timeoutMs = 1_500): Promise<StateSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await this.nextState(deadline - Date.now());
      if (predicate(snapshot)) return snapshot;
    }
    throw new Error("Timed out waiting for matching state");
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
    const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice("data: ".length)).join("\n");
    if (eventName !== "state" || !data) return this.shiftParsedStateEvent();
    return StateSnapshotSchema.parse(JSON.parse(data));
  }
}

describe("semantic session state updates", () => {
  it("accepts extension semantic state updates and broadcasts visible working, blocked, and idle state", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 5_000 });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = listenerPort(app);
    const client = await openSseClient(port);
    const socket = await connectAndRegister(port);

    await expect(client.nextStateMatching((snapshot) => snapshot.sessions.some((session) => session.semanticState === "idle"))).resolves.toMatchObject({
      sessions: [expect.objectContaining({ sessionId: "session-1", semanticState: "idle", presence: "live" })]
    });

    for (const semanticState of ["working", "blocked", "idle"] as const) {
      const ack = nextMessage(socket);
      socket.send(
        JSON.stringify({
          type: "session.update",
          requestId: `state-${semanticState}`,
          payload: { sessionId: "session-1", semanticState }
        } satisfies ExtensionClientMessage)
      );
      await expect(ack).resolves.toMatchObject({ type: "ack", payload: { type: "session.update" } });
      await expect(
        client.nextStateMatching((snapshot) => snapshot.sessions.some((session) => session.semanticState === semanticState))
      ).resolves.toMatchObject({
        sessions: [expect.objectContaining({ sessionId: "session-1", semanticState, presence: "live" })]
      });
    }
  });

  it("marks session shutdown as offline in visible state", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", now: () => 5_000 });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = listenerPort(app);
    const socket = await connectAndRegister(port);

    const ack = nextMessage(socket);
    socket.send(JSON.stringify({ type: "session.shutdown", payload: { sessionId: "session-1" } } satisfies ExtensionClientMessage));
    await expect(ack).resolves.toMatchObject({ type: "ack", payload: { type: "session.shutdown" } });

    const snapshot = StateSnapshotSchema.parse((await app.inject({ method: "GET", url: "/api/state" })).json());
    expect(snapshot.sessions[0]).toMatchObject({ sessionId: "session-1", presence: "offline" });
  });
});
