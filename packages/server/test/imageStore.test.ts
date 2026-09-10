import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import sharp from "sharp";
import { openPostboxDatabase } from "../src/db/database.js";
import { ImageStore } from "../src/services/imageStore.js";
import { IMAGE_LIMITS } from "../../protocol/src/index.js";

const directory = mkdtempSync(join(tmpdir(), "postbox-image-store-"));
const db = openPostboxDatabase(":memory:");
let clock = Date.now();
const store = new ImageStore(db, directory, () => clock, "test-instance");
afterEach(() => store.prune());
import { afterAll } from "vitest";
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const png = () => sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } }).png().toBuffer();

it("rejects type mismatch, unsupported signatures, animation, oversized axes and malformed data", async () => {
  await expect(store.stage(await png(), "image/jpeg", "session")).rejects.toMatchObject({ code: "image_format" });
  await expect(store.stage(Buffer.from("<svg></svg>"), "image/png", "session")).rejects.toMatchObject({ code: "image_format" });
  await expect(store.stage(Buffer.alloc(IMAGE_LIMITS.sourceBytes + 1), "image/png", "session")).rejects.toMatchObject({ code: "image_byte_limit" });
  const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await expect(store.stage(wide, "image/png", "session")).rejects.toMatchObject({ code: "image_dimension_limit" });
  const source = await png();
  const actl = Buffer.alloc(20); actl.writeUInt32BE(8); actl.write("acTL", 4); actl.writeUInt32BE(2, 8);
  await expect(store.stage(Buffer.concat([source.subarray(0, 33), actl, source.subarray(33)]), "image/png", "session")).rejects.toMatchObject({ code: "image_animated" });
  await expect(store.stage(source.subarray(0, 40), "image/png", "session")).rejects.toMatchObject({ code: "image_invalid" });
  const animated = await sharp([await png(), await sharp({ create: { width: 8, height: 4, channels: 3, background: "blue" } }).png().toBuffer()], { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await expect(store.stage(animated, "image/webp", "session")).rejects.toMatchObject({ code: "image_animated" });
});

it("deduplicates sanitized bytes, protects live claims, prunes expired claims and hides uncommitted blobs", async () => {
  const source = await png();
  const first = await store.stage(source, "image/png", "session");
  await store.stage(source, "image/png", "session");
  const files = readdirSync(directory).filter(name => !name.endsWith(".tmp"));
  expect(files).toHaveLength(1);
  expect(store.read(first.uploadId)).toBeUndefined();
  store.prune(); expect(readdirSync(directory)).toEqual(files);
  await expect(Promise.resolve().then(() => db.transaction(() => store.commit("none", 1, "wrong-session", [{ ...first, alt: "sample" }]))())).rejects.toMatchObject({ code: "image_target_changed" });
  clock += IMAGE_LIMITS.stagingMs + 1;
  store.prune(); store.prune(); expect(readdirSync(directory)).toEqual([]);
});
