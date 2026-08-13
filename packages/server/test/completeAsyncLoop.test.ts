import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { PostboxClient } from "../../extension/src/client/PostboxClient.js";
import { createPostboxApp } from "../src/app.js";

const apps: FastifyInstance[] = [];
const clients: PostboxClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("complete asynchronous adapter/browser/API loop", () => {
  it("persists a Question, exposes authoritative browser state, notifies Pi, and returns the full Answer", async () => {
    const app = await createPostboxApp({ databasePath: ":memory:", expirySweepMs: 0 });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP listener");
    const serverUrl = `http://127.0.0.1:${address.port}`;
    let connected!: () => void;
    const connection = new Promise<void>((resolve) => { connected = resolve; });
    let notify!: (value: { questionId: string; question: string; answerId: string }) => void;
    const notification = new Promise<{ questionId: string; question: string; answerId: string }>((resolve) => { notify = resolve; });
    const client = new PostboxClient({
      serverUrl,
      reconnect: false,
      registration: {
        machine: { machineId: "machine-complete", hostname: "workstation" },
        project: { projectId: "project-complete", name: "postbox", cwd: "/repo" },
        session: { sessionId: "session-complete", cwd: "/repo", semanticState: "idle",
          owner: { harness: "pi", ownerId: "12345678-1234-4123-8123-123456789abc" } }
      },
      onStatus: (status) => { if (status === "connected") connected(); },
      onAnswerAvailable: notify
    });
    clients.push(client);
    client.start();
    await connection;

    await expect(client.createAsk({
      requestId: "question-complete", sessionId: "session-complete", mode: "single",
      question: { prompt: "Ship the complete loop?" }, options: [{ value: "ship", label: "Ship" }],
      context: { codebaseContext: "Real extension client and Fastify server.", problemContext: "Prove the asynchronous loop." }
    })).resolves.toMatchObject({ questionId: "question-complete", revision: 1, status: "pending" });

    const browserState = await fetch(`${serverUrl}/api/state`).then((response) => response.json()) as { requests: unknown[] };
    expect(browserState.requests).toEqual([expect.objectContaining({ requestId: "question-complete", status: "pending" })]);

    const answerResponse = await fetch(`${serverUrl}/api/requests/question-complete/answer`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, selectedValues: ["ship"], note: "Proceed", rationale: "The loop is complete" })
    });
    expect(answerResponse.status).toBe(200);
    await expect(notification).resolves.toMatchObject({
      questionId: "question-complete", question: "Ship the complete loop?", answerId: expect.any(String)
    });

    await expect(client.getAnswer("question-complete")).resolves.toMatchObject({
      alreadyRead: false,
      question: { questionId: "question-complete", question: { prompt: "Ship the complete loop?" } },
      answer: { status: "answered", selectedValues: ["ship"], note: "Proceed", rationale: "The loop is complete" },
      firstRead: { reader: { harness: "pi", ownerId: "12345678-1234-4123-8123-123456789abc" } }
    });
  });
});
