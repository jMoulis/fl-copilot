import { expect, it } from "vitest";
import {
  economicContextFixture,
  economicProduceContextFixture,
} from "../../../scripts/test-economic-fixtures";
import { economicPeriodSummary } from "./economic-context";
it("keeps different monthly coverage, computes exact-month annual change and confidence in points", () => {
  const s = economicPeriodSummary(economicContextFixture(), "2026-11");
  expect(s[0]).toMatchObject({
    requestedMonth: "2026-11",
    period: "2026-09",
    value: "102",
    annualChangePercent: "2.00",
    monthlyDifferencePoints: null,
  });
  expect(s[1]).toMatchObject({
    period: "2026-10",
    value: "80",
    annualChangePercent: null,
    monthlyDifferencePoints: "-5.00",
  });
});
it("never uses a later month, never substitutes an approximate annual reference and preserves missing vs zero", () => {
  const c = economicContextFixture();
  expect(economicPeriodSummary(c, "2026-09")[1]).toMatchObject({
    period: "2026-09",
    value: "85",
    monthlyDifferencePoints: null,
  });
  c.series[0]!.points[0]!.period = "2025-08";
  c.series[1]!.points[1]!.value = "0";
  expect(
    economicPeriodSummary(c, "2026-11")[0]!.annualChangePercent,
  ).toBeNull();
  expect(economicPeriodSummary(c, "2026-11")[1]).toMatchObject({
    value: "0",
    monthlyDifferencePoints: "-85.00",
  });
  c.series[1]!.points[1]!.value = null;
  expect(economicPeriodSummary(c, "2026-11")[1]).toMatchObject({
    value: null,
    monthlyDifferencePoints: null,
  });
  expect(economicPeriodSummary(c, "2024-01")[0]).toMatchObject({
    period: null,
    value: null,
  });
  expect(economicPeriodSummary(undefined, "2026-11")).toEqual([]);
});

it("computes separate official produce price changes without combining indices or borrowing reference months", () => {
  const context = economicProduceContextFixture();
  const result = economicPeriodSummary(context, "2026-11");
  expect(result.find((s) => s.id === "011814957")).toMatchObject({
    period: "2026-10",
    annualChangePercent: "5.25",
    monthlyDifferencePoints: null,
  });
  expect(result.find((s) => s.id === "011815032")).toMatchObject({
    period: "2026-09",
    annualChangePercent: "-10.00",
  });
  context.series.find((s) => s.id === "011814957")!.points[0]!.period =
    "2025-09";
  expect(
    economicPeriodSummary(context, "2026-11").find((s) => s.id === "011814957")!
      .annualChangePercent,
  ).toBeNull();
});
