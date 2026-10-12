import { z } from "zod";
import { recommendationTypeSchema } from "./copilot-candidate";

const prose = z.string().trim().min(1).max(1200);
const reference = z.string().min(1).max(1000);
/** Model prose references evidence; official figures are rendered from trusted data. */
export const copilotResponseSchema = z
  .object({
    language: z.literal("fr-FR"),
    summary: prose,
    facts: z.array(z.object({ evidenceId: reference }).strict()).max(24),
    interpretation: z.array(prose).max(8),
    recommendations: z
      .array(
        z
          .object({
            candidateId: reference,
            type: recommendationTypeSchema,
            title: z.string().trim().min(1).max(160),
            explanation: prose,
            evidenceIds: z.array(reference).min(1).max(16),
            confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
            risks: z.array(prose).max(8),
            missingData: z.array(prose).max(8),
            measurement: z
              .object({
                objective: prose,
                evidenceIds: z.array(reference).max(16),
                reviewWhen: prose,
              })
              .strict(),
          })
          .strict(),
      )
      .max(3),
    questions: z.array(prose).max(4),
  })
  .strict();
export type CopilotResponse = z.infer<typeof copilotResponseSchema>;
