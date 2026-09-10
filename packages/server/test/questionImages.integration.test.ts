import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPostboxApp } from "../src/app.js";
import { PostboxClient } from "../../extension/src/client/PostboxClient.js";
import { executeAskPostbox } from "../../extension/src/tools/askPostbox.js";
import { toAskPostboxInput, toQuestionUpdateRequest, normalizeWriteQuestionResult, type WriteQuestionInput } from "../../extension/src/tools/writeQuestion.js";
import { IMAGE_LIMITS, type QuestionImage } from "../../protocol/src/index.js";

let app: FastifyInstance;
let client: PostboxClient;
let directory: string;
let serverUrl: string;
let clock = Date.now();
const owner = { harness: "pi" as const, ownerId: "12345678-1234-4123-8123-123456789abc" };
const draft = { question: "Choose a design", ambiguity: "Which evidence is clearer?", options: [{ value: "yes", label: "Yes" }] };
afterEach(async () => { vi.restoreAllMocks(); client?.stop(); await app?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function start() {
  app = await createPostboxApp({ databasePath: join(directory, "questions.sqlite"), now: () => clock, expirySweepMs: 0 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  serverUrl = app.listeningOrigin;
  client = new PostboxClient({ serverUrl, reconnect: false, registration: {
    machine: { machineId: "images-machine", hostname: "test" }, project: { projectId: "images-project", name: "Images", cwd: directory },
    session: { sessionId: "images-session", cwd: directory, semanticState: "idle", owner }
  } });
  client.start();
  await expect.poll(async () => { try { await client.query("questions.get", { questionIds: ["not-created"] }); return true; } catch { return false; } }).toBe(true);
}
async function write(input: WriteQuestionInput, signal?: AbortSignal) {
  if (input.action === "create" || input.action === "create_batch") return normalizeWriteQuestionResult(input.action, await executeAskPostbox(toAskPostboxInput(input), client, "images-session", signal));
  const images = input.images === undefined ? undefined : await client.prepareImages(input.images, signal);
  return client.query("question.update", { sessionId: "images-session", ...toQuestionUpdateRequest(input, images) });
}
async function full(id: string) { return (await client.query("questions.get", { questionIds: [id], view: "full" }))[0]; }

describe("Question attachments through public write inputs, extension staging and durable server", () => {
  it("creates ordered formats, replays without local files, revises atomically, preserves history and survives restart", async () => {
    directory = await mkdtemp(join(tmpdir(), "postbox-image-contract-"));
    const paths = [];
    for (const format of ["png", "jpeg", "webp"] as const) {
      const path = join(directory, `private-original-name.${format}`);
      await writeFile(path, await sharp({ create: { width: 24, height: 12, channels: 3, background: "#4488cc" } }).toFormat(format).withMetadata({ orientation: 6 }).toBuffer());
      paths.push(path);
    }
    await start();
    const images = paths.map((path, i) => ({ path: i === 0 ? "private-original-name.png" : path, alt: `Evidence ${i + 1}`, caption: `Caption ${i + 1}` }));
    const receipt = await write({ action: "create", requestId: "gallery", ...draft, images });
    expect(receipt).toMatchObject({ questionId: "gallery", disposition: "created" });
    expect(JSON.stringify(receipt)).not.toMatch(/private-original|uploadId|imageId|images/);
    const question = await full("gallery");
    expect(question.images.map((image: QuestionImage) => image.alt)).toEqual(images.map(image => image.alt));
    expect(JSON.stringify(question)).not.toContain("private-original-name");
    for (const image of question.images as QuestionImage[]) {
      const response = await fetch(`${serverUrl}/media/images/${image.imageId}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(image.mediaType);
      expect(response.headers.get("content-length")).toBe(String(image.byteSize));
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-disposition")).toBe("inline");
      expect(response.headers.get("cache-control")).toContain("private, max-age=31536000, immutable");
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
      expect(metadata.width).toBe(image.width); expect(metadata.height).toBe(image.height);
      expect((await fetch(`${serverUrl}/media/images/${image.imageId}`, { headers: { "if-none-match": response.headers.get("etag")! } })).status).toBe(304);
    }
    await unlink(paths[0]!);
    clock += IMAGE_LIMITS.stagingMs + 1;
    expect(await write({ action: "create", requestId: "gallery", ...draft, images })).toMatchObject({ disposition: "idempotent" });
    await write({ action: "revise", questionId: "gallery", expectedRevision: 1, expectedOwnerRevision: 1, question: "Text revision", ambiguity: "Same gallery" });
    expect((await full("gallery")).images).toEqual(question.images);
    await expect(write({ action: "revise", questionId: "gallery", expectedRevision: 1, expectedOwnerRevision: 1, ...draft, images: [] })).rejects.toMatchObject({ code: "stale_revision" });
    await write({ action: "revise", questionId: "gallery", expectedRevision: 2, expectedOwnerRevision: 1, ...draft, images: [images[2]!, images[1]!] });
    expect((await full("gallery")).images.map((image: QuestionImage) => image.alt)).toEqual(["Evidence 3", "Evidence 2"]);
    await write({ action: "revise", questionId: "gallery", expectedRevision: 3, expectedOwnerRevision: 1, ...draft, images: [] });
    expect((await full("gallery")).images).toEqual([]);
    const history = await client.query("question.history.get", { questionId: "gallery", view: "full" });
    expect(history.revisions.map((revision: { images: QuestionImage[] }) => revision.images.length)).toEqual([3, 3, 2, 0]);
    const events = await client.query("question.history.get", { questionId: "gallery" });
    expect(events.revisions[0].images).toBeUndefined();
    expect(events.revisions[2].images).toEqual([]);
    client.stop(); await app.close(); await start();
    await fetch(`${serverUrl}/api/requests`); // lifecycle sweep also prunes abandoned staging
    expect((await full("gallery")).images).toEqual([]);
    expect((await fetch(`${serverUrl}/media/images/${question.images[0].imageId}`)).status).toBe(200);
    const replay = await write({ action: "create", requestId: "gallery", ...draft, images });
    expect(replay).toMatchObject({ disposition: "idempotent", revision: 4 });
  });

  it("rejects an invalid gallery as a unit, retains independent batch items and resolves parent references", async () => {
    directory = await mkdtemp(join(tmpdir(), "postbox-image-batch-"));
    await writeFile(join(directory, "evidence.png"), await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer());
    await writeFile(join(directory, "bad.png"), "not an image");
    await start();
    const image = { path: "evidence.png", alt: "Red sample" };
    await expect(write({ action: "create", requestId: "bad", ...draft, images: [image, { path: "bad.png", alt: "Bad file" }] })).rejects.toMatchObject({ code: "image_format" });
    expect(await full("bad")).toBeUndefined();
    const result = await write({ action: "create_batch", questions: [
      { localRef: "invalid", requestId: "invalid", ...draft, images: [{ path: "missing.png", alt: "Missing" }] },
      { localRef: "parent", requestId: "parent", ...draft, images: [image, image] },
      { localRef: "child", requestId: "child", parentLocalRef: "parent", ...draft, images: [image] }
    ] });
    expect(result).toMatchObject({ batchStatus: "partial", items: [{ localRef: "invalid", status: "rejected" }, { questionId: "parent" }, { questionId: "child" }] });
    const parent = await full("parent"), child = await full("child");
    expect(child.parentQuestionId).toBe("parent");
    expect(parent.images[0].imageId).toBe(parent.images[1].imageId);
    expect(child.images[0].imageId).toBe(parent.images[0].imageId);
    const aborted = new AbortController(); aborted.abort();
    await expect(write({ action: "create", requestId: "aborted", ...draft, images: [image] }, aborted.signal)).rejects.toThrow();
    expect(await full("aborted")).toBeUndefined();
    const claims = await client.prepareImages([image]);
    expect((await fetch(`${serverUrl}/media/images/${claims[0]!.uploadId}`)).status).toBe(404);
    clock += IMAGE_LIMITS.stagingMs + 1;
    await expect(client.createAsk({ requestId: "expired", sessionId: "images-session", mode: "single", question: { prompt: draft.question, ambiguity: draft.ambiguity }, options: draft.options, images: claims })).rejects.toMatchObject({ code: "image_claim_expired" });
    expect(await full("expired")).toBeUndefined();
  });

  it("rejects claims from a previous server instance and keeps Question JSON usable when stored media is missing", async () => {
    directory = await mkdtemp(join(tmpdir(), "postbox-image-recovery-"));
    await writeFile(join(directory, "evidence.png"), await sharp({ create: { width: 8, height: 4, channels: 3, background: "blue" } }).png().toBuffer());
    await start();
    const image = { path: "evidence.png", alt: "Blue evidence" };
    const claims = await client.prepareImages([image]);
    client.stop(); await app.close(); await start();
    await expect(client.createAsk({ requestId: "old-instance", sessionId: "images-session", mode: "single", question: { prompt: draft.question, ambiguity: draft.ambiguity }, options: draft.options, images: claims })).rejects.toMatchObject({ code: "image_target_changed" });
    expect(await full("old-instance")).toBeUndefined();
    await write({ action: "create", requestId: "missing-media", ...draft, images: [image] });
    const current = await full("missing-media");
    const compact = await client.query("questions.get", { questionIds: ["missing-media"] });
    expect(JSON.stringify(compact)).not.toMatch(/imageId|uploadId|Blue evidence|evidence.png/);
    await rm(join(directory, "questions.sqlite.images"), { recursive: true });
    expect((await fetch(`${serverUrl}/media/images/${current.images[0].imageId}`)).status).toBe(503);
    expect((await full("missing-media")).images).toEqual(current.images);
    const answer = await fetch(`${serverUrl}/api/requests/missing-media/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, selectedValues: ["yes"] }) });
    expect(answer.status).toBe(200);
  });

  it("enforces aggregate source limits on both sides and stops cancellation or connection changes during staging", async () => {
    directory = await mkdtemp(join(tmpdir(), "postbox-image-limits-"));
    const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    await writeFile(join(directory, "padded.png"), Buffer.concat([png, Buffer.alloc(IMAGE_LIMITS.sourceBytes - png.length)]));
    await writeFile(join(directory, "small.png"), png);
    await start();
    const large = { path: "padded.png", alt: "Padded generated sample" };
    await expect(write({ action: "create", requestId: "too-many-bytes", ...draft, images: Array(4).fill(large) })).rejects.toMatchObject({ code: "image_total_limit" });
    expect(await full("too-many-bytes")).toBeUndefined();
    const [claim] = await client.prepareImages([large]);
    await expect(client.createAsk({ requestId: "server-byte-limit", sessionId: "images-session", mode: "single", question: { prompt: draft.question, ambiguity: draft.ambiguity }, options: draft.options, images: Array(4).fill(claim) })).rejects.toMatchObject({ code: "image_total_limit" });
    expect(await full("server-byte-limit")).toBeUndefined();
    const realFetch = globalThis.fetch;
    const controller = new AbortController();
    const small = { path: "small.png", alt: "Small sample" };
    const aborting = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      if (String(input).endsWith("/api/images/stage")) controller.abort();
      return response;
    });
    await expect(write({ action: "create", requestId: "aborted-upload", ...draft, images: [small, small] }, controller.signal)).rejects.toThrow();
    aborting.mockRestore();
    expect(await full("aborted-upload")).toBeUndefined();
    const disconnected = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      if (String(input).endsWith("/api/images/stage")) client.stop();
      return response;
    });
    await expect(write({ action: "create", requestId: "disconnected-upload", ...draft, images: [small] })).rejects.toMatchObject({ code: "image_target_changed" });
    disconnected.mockRestore();
    const state = await realFetch(`${serverUrl}/api/state`).then(response => response.json()) as { requests: unknown[] };
    expect(state.requests).toEqual([]);
  });
});
