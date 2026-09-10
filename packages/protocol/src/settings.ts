import { z } from "zod";

export const CHAT_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ChatEffortSchema = z.enum(CHAT_EFFORTS);
export const ChatDefaultsSchema = z.object({
  // null deliberately delegates model selection to the chat host's Pi default.
  model: z.string().trim().min(3).max(400).regex(/^[^\s/]+\/[^\s]+$/, "Use provider/model-id").nullable(),
  effort: ChatEffortSchema
}).strict();
export const PostboxSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  chat: ChatDefaultsSchema
});
export const UpdatePostboxSettingsSchema = PostboxSettingsSchema.strict();
export type ChatDefaults = z.infer<typeof ChatDefaultsSchema>;
export type ChatEffort = z.infer<typeof ChatEffortSchema>;
export type PostboxSettings = z.infer<typeof PostboxSettingsSchema>;

export const AvailableChatModelsSchema = z.object({
  models: z.array(z.object({ id: z.string().min(3), name: z.string().min(1) }))
});
export type AvailableChatModels = z.infer<typeof AvailableChatModelsSchema>;
