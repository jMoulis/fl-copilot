import { expect, it } from "vitest";
import { mergeBusinessPeriods } from "./business-periods";
it("keeps missing intervals and different years separate, merging only overlap and adjacency", () => {
  expect(
    mergeBusinessPeriods([
      { start: "2026-10-01", end: "2026-10-10" },
      { start: "2025-10-03", end: "2025-10-05" },
      { start: "2025-10-01", end: "2025-10-02" },
      { start: "2025-10-04", end: "2025-10-07" },
    ]),
  ).toEqual([
    { start: "2025-10-01", end: "2025-10-07" },
    { start: "2026-10-01", end: "2026-10-10" },
  ]);
});
