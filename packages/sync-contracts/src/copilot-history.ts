import { z } from "zod";
import {
  copilotConversationSchema,
  copilotMessageSchema,
} from "@fl-copilot/domain";
export const copilotHistoryQuerySchema = z
  .object({
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
  );
export const copilotHistoryPageSchema = z.object({
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  conversations: z.array(copilotConversationSchema),
  messages: z.array(copilotMessageSchema),
  hasMore: z.boolean(),
  before: z
    .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
    .nullable(),
});

export type CopilotHistoryPage = z.infer<typeof copilotHistoryPageSchema>;
