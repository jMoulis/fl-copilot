import { useVisualLibrary } from "../products/use-visual-library";
import { TodayContent } from "./today-overview";
import type { TodaySummary } from "./today-summary";

/** Reuse one focused shared library for every visible product, never one observer per row. */
export function TodayNativeContent({ summary }: { summary: TodaySummary }) {
  return summary.priorities.length || summary.movements.length ? (
    <TodayWithVisuals summary={summary} />
  ) : (
    <TodayContent summary={summary} />
  );
}
function TodayWithVisuals({ summary }: { summary: TodaySummary }) {
  const visuals = useVisualLibrary();
  return (
    <TodayContent
      summary={summary}
      storeId={visuals.context?.storeId}
      visuals={visuals}
    />
  );
}
