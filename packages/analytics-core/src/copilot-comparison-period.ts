import { previousIsoYearDate, type DatePeriod } from "./comparison";
import { addExplorerDays, explorerDays } from "./explorer-period";
/** Reuse the Explorer's ISO-weekday rule for conversational N-1 reads. */
export function resolveCopilotComparison<
  T extends {
    currentPeriod: DatePeriod;
    referencePeriod: DatePeriod | null;
    referenceMode?: "ISO_YEAR" | "CUSTOM";
  },
>(input: T): T {
  const { currentPeriod: current, referencePeriod: reference } = input;
  const anniversary = (date: string) =>
    `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  const inferred =
    reference &&
    reference.start === anniversary(current.start) &&
    reference.end === anniversary(current.end);
  if (
    input.referenceMode === "CUSTOM" ||
    (!inferred && input.referenceMode !== "ISO_YEAR")
  )
    return input;
  const dates = explorerDays(current).map(previousIsoYearDate);
  if (
    dates.some((d) => d === null) ||
    dates.some((d, i) => i > 0 && d !== addExplorerDays(dates[i - 1]!, 1))
  )
    throw Error("COPILOT_ISO_REFERENCE_UNAVAILABLE");
  return {
    ...input,
    referencePeriod: { start: dates[0]!, end: dates.at(-1)! },
    referenceMode: "ISO_YEAR",
  };
}
