import { z } from "zod";
/** Public activity only. Never model reasoning, tool arguments or internal errors. */
export const copilotActivitySchema = z.strictObject({
  id: z.string().min(1).max(80),
  stage: z.enum([
    "PREPARING",
    "ANALYTICS",
    "COMPARISON",
    "PRODUCTS",
    "DOCUMENTS",
    "CONTEXT",
    "INFORMATION",
    "PROPOSAL",
    "WRITING",
  ]),
  status: z.enum(["RUNNING", "DONE", "UNAVAILABLE"]),
});
export type CopilotActivity = z.infer<typeof copilotActivitySchema>;
