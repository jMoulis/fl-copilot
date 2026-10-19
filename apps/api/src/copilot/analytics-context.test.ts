import { it, expect } from "vitest";
import {
  analyticsExplorerContextSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import { projectCopilotModelValue } from "./ai-provider";
import { factDigest } from "./fact-context";
import { renderAnswerText } from "./answer-text";
import { readAnswerSource } from "../../../mobile/src/copilot/answer-source";
const context = analyticsExplorerContextSchema.parse({
  schemaVersion: 1,
  period: {
    kind: "range",
    current: { start: "2026-10-01", end: "2026-10-15" },
    reference: { start: "2025-10-02", end: "2025-10-16" },
    aggregation: "AVERAGE",
    basis: "OBSERVED_PRODUCTS",
  },
  metric: "waste",
  filters: {
    category: "FRUIT",
    nature: null,
    productId: null,
    labelContains: "poire",
  },
});
const evidence = copilotEvidenceSchema.parse({
  id: "money",
  sourceId: "canonical",
  sourceType: "KPI",
  sourceVersion: null,
  label: "Casse moyenne",
  value: "12.30",
  factKind: "DERIVED",
  analyticsContext: context,
});
it("carries server-owned exact analytical destinations through source text while preserving the original figure and legacy sources", () => {
  const text = renderAnswerText(
    "Le montant renseigné est {{value:0}} €. {{source:0}}",
    [{ evidenceId: evidence.id }],
    [evidence],
  );
  const encoded = /copilot-source:([^)]*)/.exec(text)![1];
  expect(readAnswerSource(encoded).analyticsContext).toEqual(context);
  expect(text).toContain("12,30 €");
  expect(
    readAnswerSource(
      encodeURIComponent(
        JSON.stringify({
          label: "Ancienne source",
          value: "1",
          sourceId: "old",
        }),
      ),
    ).analyticsContext,
  ).toBeUndefined();
});
it("keeps navigation out of model input/tool budgets and freshness digests, without mutating trusted evidence or user messages", () => {
  const assistant = {
    role: "ASSISTANT",
    text: "Bilan. [Source](copilot-source:encoded)",
    analyticsDestinations: { private: "navigation" },
  };
  const input = {
    evidence: [evidence],
    nested: { evidence: [evidence] },
    messages: [assistant, { role: "USER", text: assistant.text }],
  };
  const projected = projectCopilotModelValue(input);
  expect(projected.evidence[0].analyticsContext).toBeUndefined();
  expect(projected.nested.evidence[0].analyticsContext).toBeUndefined();
  expect(projected.messages[0]).not.toHaveProperty("analyticsDestinations");
  expect(projected.messages[0].text).toBe("Bilan. [Source]");
  expect(projected.messages[1].text).toBe(assistant.text);
  expect(input.evidence[0].analyticsContext).toEqual(context);
  const legacy = { ...evidence };
  delete legacy.analyticsContext;
  expect(factDigest(evidence)).toBe(factDigest(legacy));
  expect(factDigest({ ...evidence, value: "99" })).not.toBe(
    factDigest(evidence),
  );
});
it("refuses arbitrary tenant/URL/operators, duplicate product sets and external-source navigation before opening any destination", () => {
  for (const bad of [
    { ...context, storeId: "foreign" },
    { ...context, url: "https://example.com" },
    {
      ...context,
      filters: {
        ...context.filters,
        productIds: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000001",
        ],
      },
    },
    {
      ...context,
      period: {
        ...context.period,
        kind: "range",
        current: { start: "2026-02-30", end: "2026-03-01" },
      },
    },
  ])
    expect(analyticsExplorerContextSchema.safeParse(bad).success).toBe(false);
  expect(
    copilotEvidenceSchema.safeParse({
      ...evidence,
      sourceType: "SOURCE_DOCUMENT",
    }).success,
  ).toBe(false);
});
it("does not turn an otherwise storable legacy answer into an oversized message by enriching navigation", () => {
  const productIds = Array.from(
    { length: 100 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  const large = {
    ...evidence,
    analyticsContext: {
      ...context,
      filters: { ...context.filters, productIds },
    },
  };
  const narrative = "{{source:0}} ".repeat(4);
  const rendered = renderAnswerText(
    narrative,
    [{ evidenceId: evidence.id }],
    [large],
  );
  expect(rendered.length).toBeLessThanOrEqual(16000);
  expect(rendered).toContain("copilot-source:");
  expect(
    readAnswerSource(/copilot-source:([^)]*)/.exec(rendered)![1])
      .analyticsContext,
  ).toBeUndefined();
});
it("annotates canonical query groups, including a DAY group's original observed-product universe", async () => {
  const { readAnalyticsQuery } = await import("./analytics-query-tool");
  const storeId = "00000000-0000-4000-8000-000000000001",
    ids = [
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ];
  const catalogue = ids.map((_id, i) => ({
    _id,
    storeId,
    label: i ? "Tomate" : "Poire",
    category: i ? "VEGETABLE" : "FRUIT",
    nature: i ? "PACKAGED" : "BULK",
  }));
  const metric = {
    status: "AVAILABLE",
    inputCount: 1,
    availableInputCount: 1,
    missingInputCount: 0,
  };
  const rows = ids.map((productId, i) => ({
    _id: productId,
    storeId,
    productId,
    date: `2026-10-0${i + 1}`,
    performance: {
      storeId,
      productId,
      date: `2026-10-0${i + 1}`,
      sales: { salesValue: String(i + 10), marginValue: "1" },
      waste: { salesValue: "0" },
      availability: {
        salesValue: metric,
        salesMarginValue: metric,
        wasteSalesValue: metric,
      },
      formulaVersion: "product-daily-v1",
      inputRevision: "test",
      computedAt: "2026-10-19T12:00:00.000Z",
    },
  }));
  const cursor = (value: unknown[]) => ({
    maxTimeMS() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return value;
    },
  });
  const db = {
    collection: (name: string) => ({
      find: () => cursor(name === "products" ? catalogue : rows),
    }),
  } as unknown as import("mongodb").Db;
  for (const groupBy of [
    "DAY",
    "PRODUCT",
    "CATEGORY",
    "NATURE",
    "TOTAL",
  ] as const) {
    const r = await readAnalyticsQuery(db, storeId, {
      currentPeriod: { start: "2026-10-01", end: "2026-10-02" },
      referencePeriod: null,
      groupBy,
      metrics: ["sales"],
      aggregation: "SUM",
      filters: {
        category: null,
        nature: null,
        productIds: null,
        labelContains: null,
      },
      having: null,
      sort: { metric: "sales", value: "CURRENT", direction: "DESC" },
      offset: 0,
      limit: 20,
    });
    const source = r.evidence.find(
      (e) => e.id === r.rows[0].metrics[0].evidenceIds.current,
    )!;
    expect(source.analyticsContext?.period).toMatchObject({
      kind: "range",
      aggregation: "SUM",
      basis: "OBSERVED_PRODUCTS",
    });
    if (groupBy === "DAY")
      expect(source.analyticsContext?.period).toMatchObject({
        current: { start: r.rows[0].key, end: r.rows[0].key },
        universe: { start: "2026-10-01", end: "2026-10-02" },
      });
    if (groupBy === "PRODUCT")
      expect(source.analyticsContext?.filters.productId).toBe(r.rows[0].key);
    if (groupBy === "CATEGORY")
      expect(source.analyticsContext?.filters.category).toBe(r.rows[0].key);
    if (groupBy === "NATURE")
      expect(source.analyticsContext?.filters.nature).toBe(r.rows[0].key);
  }
});
it("accepts additive destinations beside legacy copies of the same fact while still refusing changed figures or conflicting destinations", async () => {
  const { sameCopilotEvidence } = await import("./evidence-identity");
  const legacy = { ...evidence };
  delete legacy.analyticsContext;
  expect(sameCopilotEvidence(legacy, evidence)).toBe(true);
  for (const bad of [
    { ...evidence, value: "99" },
    { ...evidence, analyticsContext: { ...context, metric: "sales" as const } },
  ]) {
    expect(sameCopilotEvidence(evidence, bad)).toBe(false);
    expect(() =>
      renderAnswerText(
        "{{source:0}}",
        [{ evidenceId: evidence.id }],
        [evidence, bad],
      ),
    ).toThrow("AMBIGUOUS");
  }
  const rendered = renderAnswerText(
    "{{source:0}}",
    [{ evidenceId: evidence.id }],
    [evidence, legacy],
  );
  expect(
    readAnswerSource(/copilot-source:([^)]*)/.exec(rendered)![1])
      .analyticsContext,
  ).toEqual(context);
});
it("retains explicit J−7 destinations for daily/product change tools rather than changing them to ISO N−1", async () => {
  const { readDailyAnalysis } = await import("./daily-analysis-tool");
  const { readProductAnalysis } = await import("./product-analysis-tool");
  const storeId = "00000000-0000-4000-8000-000000000001",
    productId = "00000000-0000-4000-8000-000000000002";
  const availability = {
    status: "AVAILABLE",
    inputCount: 1,
    availableInputCount: 1,
    missingInputCount: 0,
  };
  const rows = ["2026-10-15", "2026-10-08"].map((date, i) => ({
    _id: date,
    storeId,
    productId,
    date,
    performance: {
      storeId,
      productId,
      date,
      sales: { salesValue: i ? "5" : "10", marginValue: "1" },
      waste: { salesValue: "0" },
      availability: {
        salesValue: availability,
        salesMarginValue: availability,
        wasteSalesValue: availability,
      },
      formulaVersion: "product-daily-v1",
      inputRevision: date,
      computedAt: "2026-10-19T12:00:00.000Z",
    },
  }));
  const cursor = (value: unknown[]) => ({
    maxTimeMS() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return value;
    },
  });
  const db = {
    collection: (name: string) =>
      name === "departmentDailyPerformance"
        ? {
            findOne: async ({ date }: { date: string }) => {
              const r = rows.find((p) => p.date === date);
              return r
                ? {
                    ...r,
                    performance: {
                      ...r.performance,
                      formulaVersion: "department-daily-v1",
                    },
                  }
                : null;
            },
          }
        : {
            find: () =>
              cursor(
                name === "products"
                  ? [{ _id: productId, storeId, label: "Poire" }]
                  : rows,
              ),
          },
  } as unknown as import("mongodb").Db;
  const daily = await readDailyAnalysis(db, storeId, {
    businessDate: "2026-10-15",
  });
  expect(
    daily.evidence.find((e) => e.sourceId.endsWith("/J7"))?.analyticsContext
      ?.period,
  ).toMatchObject({
    kind: "range",
    current: { start: "2026-10-15", end: "2026-10-15" },
    reference: { start: "2026-10-08", end: "2026-10-08" },
  });
  const products = await readProductAnalysis(db, storeId, {
    businessDate: "2026-10-15",
    metric: "sales",
    direction: "INCREASE",
  });
  expect(
    products.evidence.find(
      (e) => e.analyticsContext?.filters.productId === productId,
    )?.analyticsContext?.period,
  ).toMatchObject({
    kind: "range",
    reference: { start: "2026-10-08", end: "2026-10-08" },
  });
});
