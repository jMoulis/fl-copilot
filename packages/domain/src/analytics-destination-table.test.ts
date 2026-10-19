import { expect, it } from "vitest";
import {
  largeAnalyticalContext,
  analyticalId,
} from "../../../scripts/test-analytics-destination-fixtures";
import {
  packAnalyticsDestinations,
  readAnalyticsDestination,
  analyticsDestinationTableSchema,
} from "./analytics-destination-table";
import { copilotMessageSchema } from "./copilot-conversation";
it("factors shared hundred-product scope without changing exact range, universe, average, metric or relation", () => {
  const original = largeAnalyticalContext();
  const other = {
    ...original,
    metric: "margin" as const,
    relation: "RELATED_AMOUNTS" as const,
  };
  const table = packAnalyticsDestinations([original, other])!;
  expect(table.periods).toHaveLength(1);
  expect(table.filters).toHaveLength(1);
  expect(table.productSets).toHaveLength(1);
  expect(readAnalyticsDestination(table, 0)).toEqual(original);
  expect(readAnalyticsDestination(table, 1)).toEqual(other);
  expect(packAnalyticsDestinations([])).toBeUndefined();
  const universe = {
    ...original,
    period: {
      ...original.period,
      kind: "range" as const,
      current: { start: "2026-10-01", end: "2026-10-15" },
      reference: null,
      universe: { start: "2026-01-01", end: "2026-12-31" },
      aggregation: "AVERAGE" as const,
      basis: "OBSERVED_PRODUCTS" as const,
    },
  };
  expect(
    readAnalyticsDestination(packAnalyticsDestinations([universe]), 0),
  ).toEqual(universe);
});
it("retains absent and explicitly null product sets and text filters without inventing a product", () => {
  for (const filters of [{}, { productIds: null, labelContains: null }]) {
    const c = {
      ...largeAnalyticalContext(),
      filters: { category: null, nature: null, productId: null, ...filters },
    };
    expect(readAnalyticsDestination(packAnalyticsDestinations([c]), 0)).toEqual(
      c,
    );
  }
});
it.each(["INDEX", "REFERENCE", "PRODUCTS", "SCOPE", "OPERATOR", "URL"])(
  "rejects damaged or executable target metadata (%s)",
  (mode) => {
    const table = packAnalyticsDestinations([largeAnalyticalContext()])!;
    if (mode === "INDEX") table.targets[0]![0] = 95;
    if (mode === "REFERENCE") table.filters[0]!.productSet = 95;
    if (mode === "PRODUCTS")
      table.productSets[0]!.push(table.productSets[0]![0]!);
    if (mode === "SCOPE") Object.assign(table, { storeId: analyticalId(300) });
    if (mode === "OPERATOR")
      Object.assign(table.filters[0]!, { $where: "execute()" });
    if (mode === "URL")
      Object.assign(table, { url: "https://private.invalid" });
    expect(analyticsDestinationTableSchema.safeParse(table).success).toBe(
      false,
    );
  },
);
it("fails closed at bounded metadata size and never truncates a product set", () => {
  const contexts = Array.from({ length: 96 }, (_, n) => ({
    ...largeAnalyticalContext(),
    filters: {
      ...largeAnalyticalContext().filters,
      productIds: Array.from({ length: 100 }, (_, i) =>
        analyticalId(1000 + 100 * n + i),
      ),
    },
  }));
  expect(() => packAnalyticsDestinations(contexts)).toThrow(
    "ANALYTICS_DESTINATIONS_TOO_LARGE",
  );
  expect(() =>
    readAnalyticsDestination(
      packAnalyticsDestinations([largeAnalyticalContext()]),
      -1,
    ),
  ).toThrow();
});
it("allows private presentation metadata only on a durable assistant answer", () => {
  const base = {
    id: analyticalId(200),
    storeId: analyticalId(201),
    ownerId: analyticalId(202),
    conversationId: analyticalId(203),
    role: "ASSISTANT",
    text: "Bilan",
    attachments: [],
    replyToMessageId: analyticalId(204),
    supersedesMessageId: null,
    version: 1,
    createdAt: "2026-10-19T12:00:00.000Z",
    analyticsDestinations: packAnalyticsDestinations([
      largeAnalyticalContext(),
    ]),
  };
  expect(copilotMessageSchema.safeParse(base).success).toBe(true);
  for (const role of ["USER", "TOOL"])
    expect(copilotMessageSchema.safeParse({ ...base, role }).success).toBe(
      false,
    );
});
