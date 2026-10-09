import { z } from "zod";
export const commercialExecutionTaskSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    planId: z.string().uuid(),
    planRevisionId: z.string().uuid(),
    planVersion: z.number().int().positive(),
    planChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["PRINT_SIGNAGE", "INSTALL_TG"]),
    targetId: z.string().uuid(),
    label: z.string().trim().min(1).max(400),
    status: z.enum(["TODO", "DONE", "SKIPPED", "NOT_APPLICABLE"]),
    note: z.string().trim().max(1200),
    completedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((t, c) => {
    if ((t.status === "DONE") !== (t.completedAt !== null))
      c.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "La date de déclaration doit correspondre au statut Fait.",
      });
    if (["SKIPPED", "NOT_APPLICABLE"].includes(t.status) && !t.note)
      c.addIssue({
        code: "custom",
        path: ["note"],
        message: "Précisez pourquoi la tâche est ignorée ou non applicable.",
      });
  });
export type CommercialExecutionTask = z.infer<
  typeof commercialExecutionTaskSchema
>;
