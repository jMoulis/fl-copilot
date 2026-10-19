import { z } from "zod";
import {
  copilotExternalResearchSourceSchema,
  analyticsExplorerContextSchema,
  retailExpertiseCitationSchema,
  readAnalyticsDestination,
} from "@fl-copilot/domain";
const answerSourceSchema = z
  .object({
    label: z.string().min(1).max(1000),
    value: z.union([z.string().max(10000), z.number().finite(), z.null()]),
    sourceId: z.string().min(1).max(1000),
    sourceType: z.string().max(80).optional(),
    externalResearch: copilotExternalResearchSourceSchema.optional(),
    retailExpertise: retailExpertiseCitationSchema.optional(),
    analyticsContext: analyticsExplorerContextSchema.optional(),
    analyticsIndex: z.number().int().min(0).max(95).optional(),
  })
  .refine(
    (v) =>
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
export type AnswerSource = z.infer<typeof answerSourceSchema>;
/** Opening a citation cannot execute model content or navigate to a private/provider URL. */
export function readAnswerSource(
  encoded: string,
  analyticsDestinations?: unknown,
): AnswerSource {
  if (encoded.length > 100000) throw Error("ANSWER_SOURCE_TOO_LARGE");
  const source = answerSourceSchema.parse(
    JSON.parse(decodeURIComponent(encoded)),
  );
  if (
    source.analyticsIndex === undefined ||
    analyticsDestinations === undefined
  )
    return source;
  return {
    ...source,
    analyticsContext: readAnalyticsDestination(
      analyticsDestinations,
      source.analyticsIndex,
    ),
  };
}

export function formatSourcePublication(value: string | null) {
  if (!value) return "date de publication non précisée";
  const monthOnly = value.length === 7;
  const day = monthOnly ? `${value}-01` : value;
  z.iso.date().parse(day);
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(
    "fr-FR",
    monthOnly
      ? { month: "long", year: "numeric", timeZone: "UTC" }
      : { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  );
}
