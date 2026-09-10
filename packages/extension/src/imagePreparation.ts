import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, resolve } from "node:path";
import { IMAGE_LIMITS, LocalQuestionImageSchema, type LocalQuestionImage, type StagedQuestionImage } from "./protocol.js";

export class ImagePreparationError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}

export async function prepareLocalImages(images: LocalQuestionImage[], cwd: string, upload: (bytes: Buffer, mediaType: string) => Promise<{ uploadId: string }>, signal?: AbortSignal): Promise<StagedQuestionImage[]> {
  if (images.length > IMAGE_LIMITS.count) throw new ImagePreparationError("image_count_limit", "A gallery accepts at most 8 images");
  const result: StagedQuestionImage[] = [];
  let total = 0;
  for (const [index, input] of images.entries()) {
    signal?.throwIfAborted();
    const parsed = LocalQuestionImageSchema.safeParse(input);
    if (!parsed.success) throw new ImagePreparationError("image_description", `Image ${index + 1} requires a local path and nonblank alt text; descriptions allow at most 2000 characters`);
    const { path, alt, caption } = parsed.data;
    const mediaType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[extname(path).toLowerCase()];
    if (!mediaType) throw new ImagePreparationError("image_format", `Image ${index + 1} must be JPEG, PNG or static WebP`);
    let bytes: Buffer;
    try {
      const file = await open(resolve(cwd, path), constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new ImagePreparationError("image_not_regular", `Image ${index + 1} must be a readable regular file`);
        if (stat.size > IMAGE_LIMITS.sourceBytes) throw new ImagePreparationError("image_byte_limit", `Image ${index + 1} exceeds 8 MiB`);
        total += stat.size;
        if (total > IMAGE_LIMITS.totalSourceBytes) throw new ImagePreparationError("image_total_limit", "Gallery source bytes exceed 24 MiB");
        // A bounded read also protects against a file growing after stat.
        const buffer = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < buffer.length) {
          signal?.throwIfAborted();
          const read = await file.read(buffer, length, buffer.length - length, length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length !== stat.size) throw new ImagePreparationError("image_file_changed", `Image ${index + 1} changed while reading; retry`, true);
        bytes = buffer.subarray(0, length);
      } finally { await file.close(); }
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      if (error instanceof ImagePreparationError) throw error;
      throw new ImagePreparationError("image_unreadable", `Image ${index + 1} must be a readable regular file`);
    }
    signal?.throwIfAborted();
    const { uploadId } = await upload(bytes, mediaType);
    result.push({ uploadId, alt, ...(caption === undefined ? {} : { caption }) });
  }
  signal?.throwIfAborted();
  return result;
}
