import { z } from "zod";
import {
  copilotAnswerSourceSchema,
  chartMatchesContext,
  copilotAnswerSourcesSchema,
  readAnalyticsDestination,
} from "@fl-copilot/domain";
export type AnswerSource = z.infer<typeof copilotAnswerSourceSchema>;
/** Opening a citation cannot execute model content or navigate to a private/provider URL. */
export function readAnswerSource(
  encoded: string,
  analyticsDestinations?: unknown,
  answerSources?: unknown,
): AnswerSource {
  if (encoded.length > 100000) throw Error("ANSWER_SOURCE_TOO_LARGE");
  const reference = /^ref:(0|[1-9]\d?)$/.exec(encoded);
  const source = reference
    ? copilotAnswerSourceSchema.parse(
        copilotAnswerSourcesSchema.parse(answerSources)[Number(reference[1])],
      )
    : copilotAnswerSourceSchema.parse(JSON.parse(decodeURIComponent(encoded)));
  if (
    source.analyticsIndex === undefined ||
    analyticsDestinations === undefined
  )
    return source;
  const analyticsContext = readAnalyticsDestination(
    analyticsDestinations,
    source.analyticsIndex,
  );
  if (source.chart && !chartMatchesContext(source.chart, analyticsContext))
    throw Error("ANSWER_CHART_SCOPE_INVALID");
  return { ...source, analyticsContext };
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
