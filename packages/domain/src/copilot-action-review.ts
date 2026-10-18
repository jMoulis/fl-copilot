import { z } from "zod";
import {
  copilotAnalysisPeriodSchema,
  periodAnalysisInputSchema,
} from "./copilot-context-tools";
import { contextWeekQuerySchema } from "./weekly-context";
const window = copilotAnalysisPeriodSchema.refine(
  (p) => (Date.parse(p.end) - Date.parse(p.start)) / 86400000 < 31,
  "Un bilan ciblé porte sur 31 jours maximum par période.",
);
/** Explicit windows, never an inferred execution date or an automatic J-7. */
export const copilotActionReviewInputSchema = z
  .strictObject({
    weekStart: contextWeekQuerySchema.shape.weekStart,
    taskId: z.string().uuid(),
    /** A selected private choice is context, never a confirmed task association. */
    decision: z
      .strictObject({
        recommendationId: z.uuid(),
        expectedVersion: z.number().int().min(1).max(50),
      })
      .nullable()
      .optional(),
    productId: z.string().uuid(),
    before: window,
    during: window,
    after: window.nullable(),
    aggregation: periodAnalysisInputSchema.shape.aggregation,
    metrics: periodAnalysisInputSchema.shape.metrics,
  })
  .superRefine((v, c) => {
    if (new Set(v.metrics).size !== v.metrics.length)
      c.addIssue({ code: "custom", message: "Indicateurs dupliqués." });
    if (
      v.before.end >= v.during.start ||
      (v.after && v.during.end >= v.after.start)
    )
      c.addIssue({
        code: "custom",
        message:
          "Les périodes avant, pendant et après doivent être ordonnées et distinctes.",
      });
    if (
      (Date.parse(v.after?.end ?? v.during.end) - Date.parse(v.before.start)) /
        86400000 >=
      93
    )
      c.addIssue({
        code: "custom",
        message: "Le bilan ciblé couvre 93 jours calendaires maximum.",
      });
  });
