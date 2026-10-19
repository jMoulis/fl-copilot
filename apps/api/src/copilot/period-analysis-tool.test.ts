import { expect, it } from "vitest";
import type { Db } from "mongodb";
import { readPeriodAnalysis } from "./period-analysis-tool";
const storeId = "b1587682-bb70-4aba-a066-74298ef97640",
  productId = "32c74fe3-a5df-4583-8c3f-19b5fd8b78ab";
const availability = (value: string | null) => ({
  status: value === null ? "UNAVAILABLE" : "AVAILABLE",
  inputCount: 1,
  availableInputCount: value === null ? 0 : 1,
  missingInputCount: value === null ? 1 : 0,
});
const row = (date: string, sales: string | null, waste: string | null) => ({
  _id: date,
  storeId,
  productId,
  date,
  performance: {
    storeId,
    productId,
    date,
    formulaVersion: "product-daily-v1",
    inputRevision: date,
    computedAt: "2026-10-15T12:00:00Z",
    sales: { salesValue: sales, marginValue: null },
    waste: { salesValue: waste },
    availability: {
      salesValue: availability(sales),
      salesMarginValue: availability(null),
      wasteSalesValue: availability(waste),
    },
  },
});
function database(rows: unknown[]) {
  const cursor = {
    maxTimeMS() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return rows;
    },
  };
  return {
    collection: (name: string) =>
      name === "products"
        ? {
            findOne: async () => ({
              _id: productId,
              storeId,
              label: "Girolles",
            }),
          }
        : { find: () => cursor },
  } as unknown as Db;
}
it("exposes period percentages and displayable period evidence, independently of requested daily averages", async () => {
  const result = await readPeriodAnalysis(
    database([
      row("2026-10-05", "8.96", null),
      row("2026-10-07", null, "80.64"),
      row("2026-10-12", "100", "5"),
    ]),
    storeId,
    {
      productId,
      currentPeriod: { start: "2026-10-12", end: "2026-10-15" },
      referencePeriod: { start: "2026-10-05", end: "2026-10-11" },
      aggregation: "AVERAGE",
      metrics: ["waste"],
    },
  );
  expect(result.wasteRates?.map((r) => r.percentage)).toEqual([
    "5.00",
    "900.00",
  ]);
  expect(result.wasteRates?.[1]).toMatchObject({
    status: "PARTIAL",
    salesTotal: "8.96",
    wasteTotal: "80.64",
  });
  expect(
    result.evidence.some(
      (e) =>
        e.label === "Période étudiée" && e.value === "05/10/2026 au 11/10/2026",
    ),
  ).toBe(true);
  expect(result.evidence.find((e) => e.value === "900.00")?.detail).toContain(
    "Ratio des cumuls",
  );
});
it("does not manufacture zero or a rate when a period has no waste and rejects cross-store snapshots", async () => {
  const input = {
    productId,
    currentPeriod: { start: "2026-10-05", end: "2026-10-11" },
    referencePeriod: null,
    aggregation: "SUM",
    metrics: ["waste"],
  };
  const result = await readPeriodAnalysis(
    database([row("2026-10-05", "100", null)]),
    storeId,
    input,
  );
  expect(result.wasteRates?.[0]).toMatchObject({
    percentage: null,
    status: "UNAVAILABLE",
    reason: "MISSING_INPUT",
  });
  await expect(
    readPeriodAnalysis(
      database([{ ...row("2026-10-05", "100", "1"), storeId: productId }]),
      storeId,
      input,
    ),
  ).rejects.toThrow("COPILOT_PERIOD_SCOPE_INVALID");
});
it("produces exact source destinations for current/reference averages and a related-money destination for a waste ratio", async () => {
  const input = {
    productId,
    currentPeriod: { start: "2026-10-12", end: "2026-10-15" },
    referencePeriod: { start: "2026-10-05", end: "2026-10-11" },
    aggregation: "AVERAGE" as const,
    metrics: ["waste" as const],
  };
  const result = await readPeriodAnalysis(
    database([row("2026-10-05", "100", "10"), row("2026-10-12", "100", "20")]),
    storeId,
    input,
  );
  const current = result.evidence.find(
    (e) =>
      e.analyticsContext?.period.kind === "range" &&
      e.analyticsContext.period.current.start === input.currentPeriod.start &&
      e.analyticsContext.period.aggregation === "AVERAGE",
  );
  expect(current?.analyticsContext).toMatchObject({
    metric: "waste",
    filters: { productId },
    period: {
      kind: "range",
      current: input.currentPeriod,
      reference: input.referencePeriod,
      aggregation: "AVERAGE",
      basis: "OBSERVED_PRODUCTS",
    },
  });
  expect(
    result.evidence.some(
      (e) =>
        e.analyticsContext?.period.kind === "range" &&
        e.analyticsContext.period.current.start ===
          input.referencePeriod.start &&
        e.analyticsContext.period.reference === null,
    ),
  ).toBe(true);
  expect(
    result.evidence.find(
      (e) => e.analyticsContext?.relation === "RELATED_AMOUNTS",
    )?.analyticsContext,
  ).toMatchObject({
    relation: "RELATED_AMOUNTS",
    period: { aggregation: "SUM" },
    metric: "waste",
  });
});
