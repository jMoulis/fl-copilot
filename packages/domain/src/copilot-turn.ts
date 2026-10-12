import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
/** Only stable application IDs cross the turn boundary; no actor, credentials or model context. */
export const copilotTurnRequestSchema = z
  .object({
    replyId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userMessageId: z.string().uuid(),
  })
  .strict();
export const copilotTurnResultSchema = z
  .object({
    message: copilotMessageSchema.safeExtend({
      createdAt: z.string().datetime(),
    }),
    alreadyApplied: z.boolean(),
  })
  .strict();
export type CopilotTurnRequest = z.infer<typeof copilotTurnRequestSchema>;
