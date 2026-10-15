import { z } from "zod";
const periodSchema = z
  .object({ start: z.string().date(), end: z.string().date() })
  .refine((p) => p.start <= p.end);
/** Merge overlapping/adjacent known periods; never bridge a gap with invented days. */
export function mergeBusinessPeriods(
  periods: readonly { start: string; end: string }[],
) {
  const sorted = periods
    .map((p) => periodSchema.parse(p))
    .sort(
      (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
    );
  const result: { start: string; end: string }[] = [];
  for (const p of sorted) {
    const last = result.at(-1);
    if (last && Date.parse(p.start) - Date.parse(last.end) <= 86400000) {
      if (p.end > last.end) last.end = p.end;
    } else result.push({ ...p });
  }
  return result;
}
