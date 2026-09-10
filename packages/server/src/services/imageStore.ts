import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { IMAGE_LIMITS, QuestionImagesSchema, StagedQuestionImagesSchema, type QuestionImage, type StagedQuestionImage } from "../protocol.js";
import type { SqliteDatabase } from "../db/database.js";

export class ImageError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}
type BlobRow = { image_id: string; digest: string; media_type: QuestionImage["mediaType"]; byte_size: number; width: number; height: number };

// These tables own references independently of the JSON snapshots, so retention
// and cleanup cannot erase media used by an earlier revision.
export class ImageStore {
  private decoding = false;
  constructor(private db: SqliteDatabase, readonly directory: string, private now: () => number, readonly instanceId: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    db.exec(`CREATE TABLE IF NOT EXISTS image_blobs (
      image_id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS image_claims (upload_id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES image_blobs(image_id),
      session_id TEXT NOT NULL, instance_id TEXT NOT NULL, source_bytes INTEGER NOT NULL, expires_at INTEGER NOT NULL, committed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS question_images (question_id TEXT NOT NULL, revision INTEGER NOT NULL, position INTEGER NOT NULL,
      image_id TEXT NOT NULL REFERENCES image_blobs(image_id), alt TEXT NOT NULL, caption TEXT,
      PRIMARY KEY(question_id, revision, position), FOREIGN KEY(question_id, revision) REFERENCES question_revisions(question_id, revision) ON DELETE CASCADE);`);
  }

  async stage(bytes: Buffer, declaredType: string, sessionId: string): Promise<{ uploadId: string }> {
    if (!bytes.length || bytes.length > IMAGE_LIMITS.sourceBytes) throw new ImageError("image_byte_limit", "Image source must be at most 8 MiB");
    if (this.decoding) throw new ImageError("image_busy", "Image decoder is busy; retry staging", true);
    this.decoding = true;
    try {
      const format = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpeg"
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : undefined;
      if (!format || declaredType !== `image/${format}`) throw new ImageError("image_format", "Expected matching JPEG, PNG or static WebP content");
      // APNG is not recognised as animated by all libvips builds. Walk chunks.
      if (format === "png") {
        for (let offset = 8; offset + 12 <= bytes.length;) {
          const length = bytes.readUInt32BE(offset);
          if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") throw new ImageError("image_animated", "Animated images are unsupported");
          if (length > bytes.length - offset - 12) throw new ImageError("image_invalid", "Malformed PNG");
          offset += length + 12;
        }
      }
      const decoder = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.pixels, failOn: "warning", sequentialRead: true });
      const metadata = await decoder.metadata();
      if ((metadata.pages ?? 1) !== 1) throw new ImageError("image_animated", "Animated images are unsupported");
      if (!metadata.width || !metadata.height || metadata.width > IMAGE_LIMITS.axis || metadata.height > IMAGE_LIMITS.axis || metadata.width * metadata.height > IMAGE_LIMITS.pixels) throw new ImageError("image_dimension_limit", "Image exceeds 8192 pixels per axis or 25 megapixels");
      if (metadata.format !== format) throw new ImageError("image_format", "Decoded image type mismatch");
      // Re-encoding without keepMetadata strips EXIF, GPS, XMP and original names.
      const { data, info } = await decoder.rotate().toFormat(format).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
      const digest = createHash("sha256").update(data).digest("hex");
      return this.db.transaction(() => {
      const destination = join(this.directory, digest);
      const temporary = join(this.directory, `${randomUUID()}.tmp`);
      try {
        const fd = openSync(temporary, "wx", 0o600);
        try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temporary, destination);
        const directoryFd = openSync(this.directory, "r");
        try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      } finally { try { unlinkSync(temporary); } catch {} }
        this.db.prepare("INSERT OR IGNORE INTO image_blobs VALUES (?,?,?,?,?,?)").run(randomUUID(), digest, `image/${format}`, data.length, info.width, info.height);
        const row = this.db.prepare("SELECT image_id FROM image_blobs WHERE digest=?").get(digest) as { image_id: string };
        const uploadId = randomUUID();
        this.db.prepare("INSERT INTO image_claims VALUES (?,?,?,?,?,?,0)").run(uploadId, row.image_id, sessionId, this.instanceId, bytes.length, this.now() + IMAGE_LIMITS.stagingMs);
        return { uploadId };
      }).immediate();
    } catch (error) {
      if (error instanceof ImageError) throw error;
      if (error instanceof Error && /pixel limit/i.test(error.message)) throw new ImageError("image_dimension_limit", "Image exceeds 25 megapixels");
      throw new ImageError("image_invalid", "Image could not be decoded or stored within resource limits");
    } finally { this.decoding = false; }
  }

  commit(questionId: string, revision: number, sessionId: string, images: StagedQuestionImage[]): void {
    const parsed = StagedQuestionImagesSchema.parse(images);
    let total = 0;
    const claims = parsed.map(image => {
      const row = this.db.prepare("SELECT * FROM image_claims WHERE upload_id=?").get(image.uploadId) as { image_id: string; session_id: string; instance_id: string; source_bytes: number; expires_at: number; committed: number } | undefined;
      if (!row || row.committed || row.expires_at <= this.now()) throw new ImageError("image_claim_expired", "Image staging claim is unavailable; restage the gallery", true);
      if (row.session_id !== sessionId || row.instance_id !== this.instanceId) throw new ImageError("image_target_changed", "Image staging target or session changed; restage the gallery", true);
      total += row.source_bytes;
      return row;
    });
    if (total > IMAGE_LIMITS.totalSourceBytes) throw new ImageError("image_total_limit", "Gallery source bytes exceed 24 MiB");
    parsed.forEach((image, position) => {
      this.db.prepare("INSERT INTO question_images VALUES (?,?,?,?,?,?)").run(questionId, revision, position, claims[position]!.image_id, image.alt, image.caption ?? null);
      this.db.prepare("UPDATE image_claims SET committed=1 WHERE upload_id=?").run(image.uploadId);
    });
  }
  copy(questionId: string, from: number, to: number): void {
    this.db.prepare("INSERT INTO question_images SELECT question_id,?,position,image_id,alt,caption FROM question_images WHERE question_id=? AND revision=?").run(to, questionId, from);
  }
  gallery(questionId: string, revision: number): QuestionImage[] {
    const rows = this.db.prepare("SELECT b.*, r.alt, r.caption FROM question_images r JOIN image_blobs b USING(image_id) WHERE question_id=? AND revision=? ORDER BY position").all(questionId, revision) as Array<BlobRow & { alt: string; caption: string | null }>;
    return QuestionImagesSchema.parse(rows.map(row => ({ imageId: row.image_id, mediaType: row.media_type, byteSize: row.byte_size, width: row.width, height: row.height, alt: row.alt, ...(row.caption === null ? {} : { caption: row.caption }) })));
  }
  read(imageId: string): { bytes: Buffer; mediaType: string; etag: string } | undefined {
    return this.db.transaction(() => {
    const row = this.db.prepare("SELECT * FROM image_blobs WHERE image_id=? AND EXISTS (SELECT 1 FROM question_images WHERE image_id=image_blobs.image_id)").get(imageId) as BlobRow | undefined;
    if (!row) return undefined;
    try {
      const path = join(this.directory, row.digest);
      if (statSync(path).size !== row.byte_size) throw new Error();
      const bytes = readFileSync(path);
      if (createHash("sha256").update(bytes).digest("hex") !== row.digest) throw new Error();
      return { bytes, mediaType: row.media_type, etag: `"${imageId}"` };
    } catch { throw new ImageError("image_storage_unavailable", "Stored image is missing or corrupt"); }
    }).immediate();
  }
  prune(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM image_claims WHERE expires_at <= ? OR committed=1").run(this.now());
      const orphans = this.db.prepare("SELECT * FROM image_blobs b WHERE NOT EXISTS (SELECT 1 FROM question_images WHERE image_id=b.image_id) AND NOT EXISTS (SELECT 1 FROM image_claims WHERE image_id=b.image_id)").all() as BlobRow[];
      for (const blob of orphans) {
        try { unlinkSync(join(this.directory, blob.digest)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue; }
        this.db.prepare("DELETE FROM image_blobs WHERE image_id=?").run(blob.image_id);
      }
      for (const file of readdirSync(this.directory)) {
        if (!/^(?:[0-9a-f-]{36}\.tmp|[0-9a-f]{64})$/.test(file)) continue;
        if (this.db.prepare("SELECT 1 FROM image_blobs WHERE digest=?").get(file)) continue;
        const path = join(this.directory, file);
        if (statSync(path).mtimeMs < this.now() - IMAGE_LIMITS.stagingMs) unlinkSync(path);
      }
    }).immediate();
  }
}
