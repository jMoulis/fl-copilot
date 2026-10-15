import { expect, it } from "vitest";
import { calculatePeriodWasteRate } from "./period-waste-rate";
const period = { start: "2026-10-05", end: "2026-10-11" };
const p = (
  businessDate: string,
  value: string | null,
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" = "AVAILABLE",
) => ({ businessDate, value, status });
it("calculates recorded period sums across different posting days, including rates over 100%", () => {
  const result = calculatePeriodWasteRate({
    period,
    sales: [p("2026-10-05", "8.96")],
    waste: [p("2026-10-07", "80.64")],
  });
  expect(result).toMatchObject({
    percentage: "900.00",
    status: "PARTIAL",
    salesTotal: "8.96",
    wasteTotal: "80.64",
    reason: null,
  });
});
it("uses a ratio of sums rather than an average of daily rates and rounds only the final percentage", () => {
  expect(
    calculatePeriodWasteRate({
      period,
      sales: [p("2026-10-05", "3"), p("2026-10-06", "7")],
      waste: [p("2026-10-05", "1"), p("2026-10-06", "0.005")],
    }).percentage,
  ).toBe("10.05");
});
it("keeps absent waste unknown, explicit zero available, and non-positive sales unavailable", () => {
  expect(
    calculatePeriodWasteRate({
      period,
      sales: [p(period.start, "100")],
      waste: [],
    }),
  ).toMatchObject({ percentage: null, reason: "MISSING_INPUT" });
  expect(
    calculatePeriodWasteRate({
      period,
      sales: [p(period.start, "100")],
      waste: [p(period.end, "0")],
    }).percentage,
  ).toBe("0.00");
  for (const sales of ["0", "-10"])
    expect(
      calculatePeriodWasteRate({
        period,
        sales: [p(period.start, sales)],
        waste: [p(period.end, "5")],
      }),
    ).toMatchObject({ percentage: null, reason: "NON_POSITIVE_SALES" });
});
it("ignores unavailable numeric payloads and validates dates/duplicates", () => {
  expect(
    calculatePeriodWasteRate({
      period,
      sales: [p(period.start, "100")],
      waste: [p(period.end, "5", "UNAVAILABLE")],
    }).percentage,
  ).toBeNull();
  expect(() =>
    calculatePeriodWasteRate({
      period,
      sales: [p(period.start, "1"), p(period.start, "2")],
      waste: [],
    }),
  ).toThrow();
});
it("marks fully known periods available, including known zero waste", () => {
  const day = { start: period.start, end: period.start };
  expect(
    calculatePeriodWasteRate({
      period: day,
      sales: [p(day.start, "100")],
      waste: [p(day.start, "0")],
    }),
  ).toMatchObject({ percentage: "0.00", status: "AVAILABLE" });
  expect(
    calculatePeriodWasteRate({
      period: day,
      sales: [p(day.start, "100", "PARTIAL")],
      waste: [p(day.start, "5")],
    }),
  ).toMatchObject({ percentage: "5.00", status: "PARTIAL" });
});
