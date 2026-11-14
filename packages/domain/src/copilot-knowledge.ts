import { z } from "zod";
/** Private practice. Automatic capture uses delegated owner authority, not per-item human confirmation. */
export const copilotKnowledgeSchema = z
  .strictObject({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    ownerId: z.string().uuid(),
    scope: z.literal("USER_STORE"),
    kind: z.literal("OPERATING_PRACTICE"),
    statement: z.string().trim().min(1).max(800),
    status: z.enum(["ACTIVE", "FORGOTTEN"]),
    sourceMessageId: z.string().uuid().nullable(),
    confirmedBy: z.string().uuid(),
    captureMode: z.literal("AUTOMATIC").optional(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((v, c) => {
    if (
      v.confirmedBy !== v.ownerId ||
      Date.parse(v.updatedAt) < Date.parse(v.createdAt)
    )
      c.addIssue({ code: "custom", message: "Invalid knowledge confirmation" });
    if (v.captureMode === "AUTOMATIC" && !v.sourceMessageId)
      c.addIssue({
        code: "custom",
        message: "Automatic knowledge requires a user source",
      });
    if (v.status === "FORGOTTEN" && v.statement !== "Oublié")
      c.addIssue({
        code: "custom",
        message: "Forgotten knowledge must be redacted",
      });
  });
export type CopilotKnowledge = z.infer<typeof copilotKnowledgeSchema>;
