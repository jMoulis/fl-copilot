import { z } from "zod";
/** Human-confirmed practice, not a KPI, model instruction or shared employee record. */
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
    if (v.status === "FORGOTTEN" && v.statement !== "Oublié")
      c.addIssue({
        code: "custom",
        message: "Forgotten knowledge must be redacted",
      });
  });
export type CopilotKnowledge = z.infer<typeof copilotKnowledgeSchema>;
