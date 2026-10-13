import { z } from "zod";
import { contextWeekQuerySchema } from "./weekly-context";
import {
  executionProposalSchema,
  executionReadResultSchema,
} from "./copilot-commercial-execution";
import { commercialExecutionTaskSchema } from "./commercial-execution-task";
import { commercialWeekPreparationSchema } from "./commercial-week-preparation";
import {
  plannedCommercialOfferSchema,
  plannedCommercialOperationSchema,
} from "./commercial-week-plan";
import { copilotEvidenceSchema } from "./copilot-candidate";
export const copilotPlanReadInputSchema = z.strictObject({
  weekStart: contextWeekQuerySchema.shape.weekStart,
  offset: z.number().int().min(0).max(10000),
  limit: z.number().int().min(1).max(10),
});
export const copilotPlanReadResultSchema = z
  .strictObject({
    weekStart: contextWeekQuerySchema.shape.weekStart,
    status: z.enum(["NO_PLAN", "READY", "LIMIT_EXCEEDED"]),
    plan: executionReadResultSchema.shape.plan
      .unwrap()
      .omit({ syncState: true })
      .extend({
        validatedAt: z.string().datetime(),
        tgCapacity: commercialWeekPreparationSchema.shape.tgCapacity,
        note: commercialWeekPreparationSchema.shape.note,
      })
      .nullable(),
    tasks: z
      .array(
        z.strictObject({
          proposal: executionProposalSchema,
          record: commercialExecutionTaskSchema.nullable(),
          offer: plannedCommercialOfferSchema.nullable(),
          operation: plannedCommercialOperationSchema
            .pick({
              id: true,
              name: true,
              kind: true,
              plannedStart: true,
              plannedEnd: true,
              announcedStart: true,
              announcedEnd: true,
            })
            .nullable(),
          placement:
            commercialWeekPreparationSchema.shape.placements.element.nullable(),
          placementOffers: z
            .array(
              plannedCommercialOfferSchema.pick({
                choiceId: true,
                productId: true,
                rawProductLabel: true,
                customerMechanism: true,
                saleStart: true,
                saleEnd: true,
              }),
            )
            .max(20),
        }),
      )
      .max(10),
    progress: executionReadResultSchema.shape.progress.nullable(),
    unmatchedDeclarations: z.number().int().nonnegative().nullable(),
    nextOffset: z.number().int().nonnegative().nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(12),
  })
  .superRefine((r, c) => {
    if (
      (r.status === "NO_PLAN") !== !r.plan ||
      (r.status === "READY") !== !!r.progress ||
      (r.status !== "READY" &&
        (r.tasks.length ||
          r.nextOffset !== null ||
          r.unmatchedDeclarations !== null)) ||
      (r.plan && r.plan.weekStart !== r.weekStart)
    )
      c.addIssue({ code: "custom", message: "Invalid plan coverage" });
  });
