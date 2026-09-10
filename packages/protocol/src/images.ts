import { z } from "zod";

export const IMAGE_LIMITS = { count: 8, sourceBytes: 8 * 1024 * 1024, totalSourceBytes: 24 * 1024 * 1024, axis: 8192, pixels: 25_000_000, text: 2000, stagingMs: 3_600_000 } as const;
export const IMAGE_ERROR_CODES = ["image_count_limit", "image_description", "image_format", "image_animated", "image_invalid", "image_dimension_limit", "image_byte_limit", "image_total_limit", "image_busy", "image_not_regular", "image_unreadable", "image_file_changed", "image_upload_failed", "image_target_unavailable", "image_target_changed", "image_claim_expired", "image_storage_unavailable", "image_unavailable"] as const;
export const ImageMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const description = { alt: z.string().max(IMAGE_LIMITS.text).refine(v => v.trim().length > 0, "Image alt text must not be blank"), caption: z.string().max(IMAGE_LIMITS.text).optional() };
export const LocalQuestionImageSchema = z.object({ path: z.string().min(1).max(4000), ...description }).strict();
export const StagedQuestionImageSchema = z.object({ uploadId: z.string().uuid(), ...description }).strict();
export const StagedQuestionImagesSchema = z.array(StagedQuestionImageSchema).max(IMAGE_LIMITS.count);
export const QuestionImageSchema = z.object({
  imageId: z.string().uuid(), mediaType: ImageMediaTypeSchema,
  byteSize: z.number().int().positive().max(128 * 1024 * 1024),
  width: z.number().int().positive().max(IMAGE_LIMITS.axis), height: z.number().int().positive().max(IMAGE_LIMITS.axis), ...description
}).strict().refine(v => v.width * v.height <= IMAGE_LIMITS.pixels, "Image pixel limit exceeded");
export const QuestionImagesSchema = z.array(QuestionImageSchema).max(IMAGE_LIMITS.count);
export type LocalQuestionImage = z.infer<typeof LocalQuestionImageSchema>;
export type StagedQuestionImage = z.infer<typeof StagedQuestionImageSchema>;
export type QuestionImage = z.infer<typeof QuestionImageSchema>;
export function questionImagePath(imageId: string): string {
  return `/media/images/${z.string().uuid().parse(imageId)}`;
}
