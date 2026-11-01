import { copilotChartSchema, chartMatchesContext } from "./copilot-chart";
import { z } from "zod";
import { analyticsExplorerContextSchema } from "./analytics-explorer";
import { retailExpertiseCitationSchema } from "./retail-expertise";
import { copilotExternalResearchSourceSchema } from "./copilot-web-research";
export const copilotAnswerSourceSchema = z
  .object({
    label: z.string().min(1).max(1000),
    value: z.union([z.string().max(10000), z.number().finite(), z.null()]),
    sourceId: z.string().min(1).max(1000),
    sourceType: z.string().max(80).optional(),
    externalResearch: copilotExternalResearchSourceSchema.optional(),
    retailExpertise: retailExpertiseCitationSchema.optional(),
    analyticsContext: analyticsExplorerContextSchema.optional(),
    chart: copilotChartSchema.optional(),
    analyticsIndex: z.number().int().min(0).max(95).optional(),
  })
  .refine(
    (v) =>
      !v.chart ||
      !v.analyticsContext ||
      chartMatchesContext(v.chart, v.analyticsContext),
  )
  .refine(
    (v) =>
      (!v.chart ||
        ((!!v.analyticsContext || v.analyticsIndex !== undefined) &&
          !v.externalResearch &&
          !v.retailExpertise &&
          ["KPI", "COMPARISON", "DATA_QUALITY"].includes(
            v.sourceType ?? "",
          ))) &&
      !(v.externalResearch && v.retailExpertise) &&
      !(v.analyticsContext && v.analyticsIndex !== undefined) &&
      (!(v.analyticsContext || v.analyticsIndex !== undefined) ||
        (!v.externalResearch &&
          !v.retailExpertise &&
          ["KPI", "COMPARISON", "DATA_QUALITY"].includes(
            v.sourceType ?? "",
          ))) &&
      (!v.retailExpertise ||
        (v.sourceId === v.retailExpertise.referenceId &&
          v.sourceType === "SOURCE_DOCUMENT")),
  );

/** Source snapshots are private message metadata, not conversational text. */
export const copilotAnswerSourcesSchema = z
  .array(copilotAnswerSourceSchema)
  .min(1)
  .max(96)
  .superRefine((sources, ctx) => {
    if (
      JSON.stringify(sources).replace(/[\u0080-\uffff]/g, "\\u0000").length >
      512 * 1024
    )
      ctx.addIssue({ code: "custom", message: "ANSWER_SOURCES_TOO_LARGE" });
  });
export type CopilotAnswerSource = z.infer<typeof copilotAnswerSourceSchema>;
export type CopilotAnswerSources = z.infer<typeof copilotAnswerSourcesSchema>;
