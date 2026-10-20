import { z } from "zod";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  layoutIllustrationPreparationSchema,
} from "@fl-copilot/domain";
export const copilotHistoryQuerySchema = z
  .object({
    recordType: z.literal("LAYOUT_ILLUSTRATIONS").optional(),
    conversationId: z.string().uuid().optional(),
    beforeCreatedAt: z
      .string()
      .datetime()
      .transform((v) => new Date(v).toISOString())
      .optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .refine(
    (q) => Boolean(q.beforeCreatedAt) === Boolean(q.beforeId),
    "Both cursor fields required",
  )
  .refine(
    (q) => !q.recordType || !q.conversationId,
    "Illustration restoration is owner-scoped",
  );
export const copilotHistoryPageSchema = z.object({
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  conversations: z.array(copilotConversationSchema),
  messages: z.array(copilotMessageSchema),
  layoutIllustrations: z
    .array(layoutIllustrationPreparationSchema)
    .max(50)
    .optional(),
  hasMore: z.boolean(),
  before: z
    .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
    .nullable(),
});

export type CopilotHistoryPage = z.infer<typeof copilotHistoryPageSchema>;
