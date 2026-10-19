import { analyticsExplorerContextSchema } from "../packages/domain/src/analytics-explorer";
export const analyticalId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic non-pilot scope: deliberate maximum supported 100-product selection. */
export const largeAnalyticalContext = () =>
  analyticsExplorerContextSchema.parse({
    schemaVersion: 1,
    relation: "MONETARY",
    period: {
      kind: "range",
      current: { start: "2026-10-01", end: "2026-10-15" },
      reference: { start: "2025-10-01", end: "2025-10-15" },
      aggregation: "AVERAGE",
      basis: "OBSERVED_PRODUCTS",
    },
    metric: "sales",
    filters: {
      category: "FRUIT",
      nature: "BULK",
      productIds: Array.from({ length: 100 }, (_, i) => analyticalId(i + 1)),
      labelContains: "Pomme",
    },
  });
