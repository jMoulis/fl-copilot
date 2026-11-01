import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  copilotAnalyticsQuerySchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import { readAnalyticsQuery } from "../src/copilot/analytics-query-tool";
import { runMongoMigrations } from "../src/database/migrations";
import { renderAnswerText } from "../src/copilot/answer-text";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("flexible canonical analytics queries", () => {
  let client: MongoClient, db: Db, storeId: string, otherStore: string;
  let banana: string, pear: string;
  const query = (
    extra: Partial<CopilotAnalyticsQuery> = {},
  ): CopilotAnalyticsQuery => ({
    currentPeriod: { start: "2025-10-01", end: "2025-10-31" },
    referencePeriod: null,
    groupBy: "PRODUCT",
    metrics: ["sales"],
    aggregation: "SUM",
    filters: {
      productIds: null,
      labelContains: null,
      category: null,
      nature: null,
    },
    having: null,
    sort: { metric: "sales", value: "CURRENT", direction: "DESC" },
    offset: 0,
    limit: 10,
    ...extra,
  });
  const snapshot = (
    id: string,
    productId: string,
    date: string,
    value: string | null,
  ) => {
    const availability = {
      status: value === null ? "UNAVAILABLE" : "AVAILABLE",
      inputCount: 1,
      availableInputCount: value === null ? 0 : 1,
      missingInputCount: value === null ? 1 : 0,
    };
    return {
      _id: randomUUID(),
      storeId: id,
      productId,
      date,
      performance: {
        storeId: id,
        productId,
        date,
        formulaVersion: "product-daily-v1",
        inputRevision: randomUUID(),
        computedAt: "2026-10-16T00:00:00.000Z",
        sales: { salesValue: value, marginValue: value },
        waste: { salesValue: value },
        availability: {
          salesValue: availability,
          salesMarginValue: availability,
          wasteSalesValue: availability,
        },
      },
    };
  };
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_cube_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  beforeEach(async () => {
    storeId = randomUUID();
    otherStore = randomUUID();
    banana = randomUUID();
    pear = randomUUID();
    await db.collection<Document & { _id: string }>("products").insertMany([
      {
        _id: banana,
        storeId,
        label: "BANANE VRAC",
        category: "FRUIT",
        nature: "BULK",
      },
      {
        _id: pear,
        storeId,
        label: "POIRE",
        category: "FRUIT",
        nature: "PACKAGED",
        deletedAt: "2026-01-01",
      },
      {
        _id: randomUUID(),
        storeId: otherStore,
        label: "PRIVATE PRODUCT",
        category: "OTHER",
        nature: "UNKNOWN",
      },
    ]);
    await db
      .collection<Document & { _id: string }>("productDailyPerformance")
      .insertMany([
        snapshot(storeId, banana, "2025-10-01", "10.10"),
        snapshot(storeId, banana, "2025-10-02", "0.20"),
        snapshot(storeId, pear, "2025-10-01", "20.00"),
        snapshot(storeId, banana, "2024-10-01", "40.00"),
        snapshot(otherStore, randomUUID(), "2025-10-01", "999999.00"),
      ]);
  });
  it("computes a citable complete-cohort Pareto before pagination, with independent reference and unchanged tenant data", async () => {
    const before = await db
      .collection("productDailyPerformance")
      .countDocuments();
    const r = await readAnalyticsQuery(
      db,
      storeId,
      query({
        includeSalesConcentration: true,
        limit: 1,
        referencePeriod: { start: "2024-10-01", end: "2024-10-31" },
      }),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.hasMore).toBe(true);
    expect(r.salesConcentration?.current).toMatchObject({
      status: "PARTIAL",
      availableProductCount: 2,
      totalSalesValue: "30.30",
      top20ProductCount: 1,
      top20SalesSharePercent: "66.01",
      productsFor80Percent: 2,
      productShareFor80Percent: "100.00",
    });
    expect(r.salesConcentration?.reference).toMatchObject({
      status: "PARTIAL",
      availableProductCount: 1,
      missingProductCount: 1,
      totalSalesValue: "40.00",
      productsFor80Percent: 1,
    });
    const current = r.salesConcentration!.current;
    for (const [key, id] of Object.entries(current.evidenceIds)) {
      const item = r.evidence.find((e) => e.id === id)!;
      expect(item.value).toBe(String(current[key as keyof typeof current]));
      expect(item.detail).toContain("avant pagination");
      expect(item.analyticsContext).toBeUndefined();
    }
    const text = renderAnswerText(
      "{{label:0}} : {{value:0}}. {{source:0}}",
      [{ evidenceId: current.evidenceIds.top20SalesSharePercent }],
      r.evidence,
    );
    expect(text).toContain("66,01");
    expect(text).toContain("copilot-source:");
    const next = await readAnalyticsQuery(
      db,
      storeId,
      query({
        includeSalesConcentration: true,
        limit: 1,
        offset: 1,
        referencePeriod: { start: "2024-10-01", end: "2024-10-31" },
      }),
    );
    const { evidenceIds: _firstIds, ...first } = current;
    const { evidenceIds: _nextIds, ...second } =
      next.salesConcentration!.current;
    void _firstIds;
    void _nextIds;
    expect(first).toEqual(second);
    expect(
      await db.collection("productDailyPerformance").countDocuments(),
    ).toBe(before);
    expect(await db.collection("outboxCommands").countDocuments()).toBe(0);
  });
  it("keeps analytical evidence keys compact and stable while retaining the full source revision and citable values", async () => {
    const input = query({
      includeSalesConcentration: true,
      includeSalesMeasures: true,
      referencePeriod: { start: "2024-10-01", end: "2024-10-31" },
    });
    const r = await readAnalyticsQuery(db, storeId, input);
    expect(r.evidence.length).toBeGreaterThan(14);
    expect(new Set(r.evidence.map((e) => e.id)).size).toBe(r.evidence.length);
    for (const e of r.evidence) {
      expect(e.id).toMatch(/^aq:[0-9a-f]{32}$/);
      expect(e.sourceId).toMatch(/^analytics-query\/[0-9a-f]{64}$/);
      expect(e.id.length).toBeLessThan(e.sourceId.length / 2);
    }
    const again = await readAnalyticsQuery(db, storeId, input);
    expect(again.evidence).toEqual(r.evidence);
    const current = r.salesConcentration!.current;
    const fact = r.evidence.find(
      (e) => e.id === current.evidenceIds.top20SalesSharePercent,
    )!;
    expect(
      renderAnswerText(
        "{{value:0}} % {{source:0}}",
        [{ evidenceId: fact.id }],
        r.evidence,
      ),
    ).toContain("66,01 %");
    expect(await db.collection("outboxCommands").countDocuments()).toBe(0);
  });
  it("reads stored quantities, preserves units and supplies citable weighted realized-price evidence without asserting TTC", async () => {
    await db.collection("productDailyPerformance").updateMany(
      { storeId, productId: banana },
      {
        $set: {
          "performance.sales.quantity": "2.000",
          "performance.sales.quantityUnit": "KG",
          "performance.availability.salesQuantity": {
            status: "AVAILABLE",
            inputCount: 1,
            availableInputCount: 1,
            missingInputCount: 0,
          },
        },
      },
    );
    const r = await readAnalyticsQuery(
      db,
      storeId,
      query({
        includeSalesMeasures: true,
        referencePeriod: { start: "2024-10-01", end: "2024-10-31" },
      }),
    );
    const row = r.rows.find((p) => p.key === banana)!;
    expect(row.salesMeasures).toMatchObject({
      current: {
        taxBasis: "UNCONFIRMED",
        quantity: { value: "4.000", unit: "KG", status: "PARTIAL" },
        averageRealizedPrice: {
          value: "2.58",
          pairedDays: 2,
          pairedSalesValue: "10.30",
          pairedQuantity: "4.000",
        },
      },
      reference: { averageRealizedPrice: { value: "20.00" } },
    });
    const price = r.evidence.find(
      (e) =>
        e.id === row.salesMeasures!.current.evidenceIds.averageRealizedPrice,
    )!;
    expect(price.value).toBe("2.58");
    expect(price.label).toContain("€/kg");
    expect(price.detail).toContain("Base HT/TTC non confirmée");
    expect(price.analyticsContext).toBeUndefined();
    const rendered = renderAnswerText(
      "| Quantité | Prix moyen |\n| --- | --- |\n| {{value:0}} kg | {{value:1}} €/kg |\n{{source:1}}",
      [
        { evidenceId: row.salesMeasures!.current.evidenceIds.quantity },
        { evidenceId: price.id },
      ],
      r.evidence,
    );
    expect(rendered).toContain("2,58 €/kg");
    expect(rendered).toContain("copilot-source:");
    expect(
      r.rows.find((p) => p.key === pear)!.salesMeasures!.current.quantity.value,
    ).toBeNull();
    expect(JSON.stringify(r)).not.toContain("999999");
  });
  it("keeps the existing evidence budget even with ten products, three metrics and a reference period", async () => {
    for (let i = 0; i < 8; i++) {
      const productId = randomUUID();
      await db.collection<Document & { _id: string }>("products").insertOne({
        _id: productId,
        storeId,
        label: `PRODUIT TEST ${i}`,
        category: "FRUIT",
        nature: "BULK",
      } as Document & { _id: string });
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .insertMany([
          snapshot(storeId, productId, "2025-10-01", "10"),
          snapshot(storeId, productId, "2024-10-01", "12"),
        ]);
    }
    const r = await readAnalyticsQuery(
      db,
      storeId,
      query({
        includeSalesMeasures: true,
        limit: 10,
        metrics: ["sales", "margin", "waste"],
        referencePeriod: { start: "2024-10-01", end: "2024-10-31" },
      }),
    );
    expect(r.rows).toHaveLength(10);
    expect(r.evidence).toHaveLength(161);
    expect(r.rows.every((row) => row.salesMeasures)).toBe(true);
  });
  it("returns a complete-scope product ranking on partial calendar data and renders a verified table", async () => {
    const r = await readAnalyticsQuery(db, storeId, query());
    expect(r).toMatchObject({
      status: "AVAILABLE",
      totalGroups: 2,
      hasMore: false,
      rows: [
        { key: pear, metrics: [{ current: "20.00" }] },
        {
          key: banana,
          metrics: [
            {
              current: "10.30",
              currentCoverage: { availableDays: 2, missingDays: 29 },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(r)).not.toContain("999999");
    expect(JSON.stringify(r)).not.toContain("PRIVATE PRODUCT");
    const facts = r.rows.map((row) => ({
      evidenceId: row.metrics[0]!.evidenceIds.current,
    }));
    const text = renderAnswerText(
      "| Produit | CA |\n| --- | --- |\n| {{label:0}} | {{value:0}} € |\n| {{label:1}} | {{value:1}} € |\n{{source:0}}",
      facts,
      r.evidence,
    );
    expect(text).toContain("20,00 €");
    expect(text).toContain("10,30 €");
    expect(text).toContain("BANANE VRAC");
  });
  it("filters by a literal name or current category/nature, keeps retired historical products and returns unresolved IDs", async () => {
    const name = await readAnalyticsQuery(
      db,
      storeId,
      query({ filters: { ...query().filters, labelContains: "banane" } }),
    );
    expect(name.rows.map((r) => r.key)).toEqual([banana]);
    const packaged = await readAnalyticsQuery(
      db,
      storeId,
      query({ filters: { ...query().filters, nature: "PACKAGED" } }),
    );
    expect(packaged.rows.map((r) => r.key)).toEqual([pear]);
    const unknown = randomUUID();
    const empty = await readAnalyticsQuery(
      db,
      storeId,
      query({ filters: { ...query().filters, productIds: [unknown] } }),
    );
    expect(empty).toMatchObject({
      status: "EMPTY",
      rows: [],
      unresolvedProductIds: [unknown],
    });
    expect(
      (
        await readAnalyticsQuery(
          db,
          storeId,
          query({ filters: { ...query().filters, labelContains: ".*" } }),
        )
      ).rows,
    ).toEqual([]);
  });
  it("compares arbitrary months, orders decreases, paginates only after global ranking and has stable evidence identities", async () => {
    const input = query({
      referencePeriod: { start: "2024-10-01", end: "2024-10-31" },
      having: null,
      sort: { metric: "sales", value: "CHANGE", direction: "ASC" },
      limit: 1,
    });
    const a = await readAnalyticsQuery(db, storeId, input),
      b = await readAnalyticsQuery(db, storeId, input);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      hasMore: true,
      nextOffset: 1,
      rows: [
        {
          key: banana,
          metrics: [
            {
              current: "10.30",
              reference: "40.00",
              change: "-29.70",
              changePercent: "-74.25",
            },
          ],
        },
      ],
    });
    expect(
      (await readAnalyticsQuery(db, storeId, { ...input, offset: 1 })).rows[0]!
        .key,
    ).toBe(pear);
    expect(
      a.evidence.find(
        (e) => e.id === a.rows[0]!.metrics[0]!.evidenceIds.change,
      )!.value,
    ).toBe("-29.70");
  });
  it("handles unknown catalogue classification, daily gaps and multiple monetary metrics without inferred zeros", async () => {
    const missing = randomUUID();
    await db
      .collection<Document & { _id: string }>("productDailyPerformance")
      .insertOne(snapshot(storeId, missing, "2025-10-01", "1.00"));
    const category = await readAnalyticsQuery(
      db,
      storeId,
      query({ groupBy: "CATEGORY", metrics: ["sales", "margin", "waste"] }),
    );
    expect(category.rows.map((r) => r.key)).toEqual(["FRUIT", "UNKNOWN"]);
    expect(category.rows[0]!.metrics).toHaveLength(3);
    const daily = await readAnalyticsQuery(
      db,
      storeId,
      query({
        groupBy: "DAY",
        having: null,
        sort: { metric: "sales", value: "GROUP", direction: "ASC" },
        limit: 3,
      }),
    );
    expect(daily.rows.map((r) => r.metrics[0]!.current)).toEqual([
      "31.10",
      "0.20",
      null,
    ]);
    expect(daily.rows[2]!.metrics[0]!.currentCoverage.missingDays).toBe(1);
    expect(daily.rows[1]!.metrics[0]!.currentCoverage.partialDays).toBe(1);
  });
  it("revalidates snapshot scope and never executes model operators or writes operational data", async () => {
    const before = await db
      .collection("productDailyPerformance")
      .countDocuments();
    expect(
      copilotAnalyticsQuerySchema.safeParse({
        ...query(),
        pipeline: [{ $out: "products" }],
      }).success,
    ).toBe(false);
    await expect(
      readAnalyticsQuery(db, storeId, { ...query(), storeId: otherStore }),
    ).rejects.toThrow();
    await readAnalyticsQuery(db, storeId, query());
    expect(
      await db.collection("productDailyPerformance").countDocuments(),
    ).toBe(before);
    expect(await db.collection("outboxCommands").countDocuments()).toBe(0);
    await db
      .collection<Document & { _id: string }>("productDailyPerformance")
      .updateOne(
        { storeId, productId: banana, date: "2025-10-01" },
        { $set: { "performance.storeId": otherStore } },
      );
    await expect(readAnalyticsQuery(db, storeId, query())).rejects.toThrow(
      "ANALYTICS_QUERY_SCOPE_INVALID",
    );
  });
  it.each([false, true])(
    "uses the installed SDK to align the model query, then renders the actual Mongo chart snapshot (streaming %s)",
    async (streaming) => {
      const { createCopilotAiProvider } =
        await import("../src/copilot/ai-provider");
      const { parseEnvironment } = await import("../src/config");
      const { scoreCopilotPriorities, detectCopilotConflicts } =
        await import("@fl-copilot/analytics-core");
      const { copilotResponseSchema } = await import("@fl-copilot/domain");
      const { validateCopilotResponse } =
        await import("../src/copilot/response-service");
      const { renderAnswerContent } =
        await import("../src/copilot/answer-text");
      const input = query({
        currentPeriod: { start: "2026-10-01", end: "2026-10-03" },
        referencePeriod: { start: "2025-10-01", end: "2025-10-03" },
        chart: { type: "BARS", measure: "CURRENT_REFERENCE" },
      });
      let result: Awaited<ReturnType<typeof readAnalyticsQuery>> | undefined;
      let calls = 0;
      const provider = createCopilotAiProvider(
        parseEnvironment({
          NODE_ENV: "test",
          OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
          COPILOT_AI_MODEL: "test-model",
          COPILOT_AI_TIMEOUT_MS: "5000",
        }),
        async (_url, init) => {
          const sent = JSON.parse(String(init?.body));
          if (!calls) expect(JSON.stringify(sent.tools)).toContain("chart");
          const output =
            calls++ === 0
              ? [
                  {
                    type: "function_call",
                    id: "fc-chart",
                    call_id: "call-chart",
                    name: "analytics_query",
                    arguments: JSON.stringify(input),
                  },
                ]
              : [
                  {
                    type: "message",
                    id: "msg-chart",
                    role: "assistant",
                    status: "completed",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          language: "fr-FR",
                          summary: "Voici la comparaison.",
                          facts: [{ evidenceId: result!.chartEvidenceId! }],
                          narrative: "Voici la comparaison.\n\n{{chart:0}}",
                          interpretation: [],
                          recommendations: [],
                          questions: [],
                        }),
                        annotations: [],
                      },
                    ],
                  },
                ];
          if (streaming) {
            const events: unknown[] = [
              {
                type: "response.created",
                response: {
                  id: "resp-chart",
                  model: "test-model",
                  created_at: 1,
                },
              },
            ];
            for (const [index, item] of output.entries()) {
              events.push({
                type: "response.output_item.added",
                output_index: index,
                item:
                  item.type === "function_call"
                    ? { ...item, arguments: "" }
                    : { type: "message", id: item.id },
              });
              if (item.type === "message" && "content" in item)
                events.push({
                  type: "response.output_text.delta",
                  item_id: item.id,
                  output_index: index,
                  delta: item.content![0]!.text,
                });
              events.push({
                type: "response.output_item.done",
                output_index: index,
                item: { ...item, status: "completed" },
              });
            }
            events.push({
              type: "response.completed",
              response: {
                usage: {
                  input_tokens: 10,
                  output_tokens: 10,
                  total_tokens: 20,
                },
              },
            });
            return new Response(
              events
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(""),
              { headers: { "content-type": "text/event-stream" } },
            );
          }
          return new Response(
            JSON.stringify({
              id: "resp-chart",
              object: "response",
              created_at: 1,
              model: "test-model",
              status: "completed",
              output,
              usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
        {
          daily: async () => {
            throw Error("UNEXPECTED_DAILY");
          },
          analyticsQuery: async (q) => {
            expect(q.referencePeriod).toEqual({
              start: "2025-10-02",
              end: "2025-10-04",
            });
            result = await readAnalyticsQuery(db, storeId, q);
            return result;
          },
        },
      );
      const request = {
        requestId: randomUUID(),
        storeId,
        userQuestion: "Compare N-1 en graphique",
        context: detectCopilotConflicts({
          batch: scoreCopilotPriorities({
            storeId,
            evaluatedAt: "2026-11-01T10:00:00Z",
            candidates: [],
          }),
          intents: [],
        }),
      };
      const generated = await provider.generate(
        request,
        copilotResponseSchema,
        undefined,
        streaming ? () => undefined : undefined,
      );
      const complete = { ...request, evidence: generated.toolEvidence };
      const response = validateCopilotResponse(generated.output, complete);
      const rendered = renderAnswerContent(
        response.narrative!,
        response.facts,
        generated.toolEvidence!,
      );
      const source = JSON.parse(
        decodeURIComponent(/copilot-source:([^)]*)/.exec(rendered.text)![1]!),
      );
      expect(source.chart.series[1].period).toEqual({
        start: "2025-10-02",
        end: "2025-10-04",
      });
      expect(source.chart).toEqual(
        result!.evidence.find((e) => e.id === result!.chartEvidenceId)!.chart,
      );
      expect(calls).toBe(2);
    },
  );
});
