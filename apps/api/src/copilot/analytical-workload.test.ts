import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import {
  copilotResponseSchema,
  type CopilotAnalyticsQuery,
} from "@fl-copilot/domain";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
import { readAnalyticsQuery } from "./analytics-query-tool";
import { readPeriodAnalysis } from "./period-analysis-tool";
import {
  createCopilotAiProvider,
  projectCopilotModelValue,
  type CopilotGenerationUsage,
  type CopilotAiProvider,
} from "./ai-provider";
import { parseEnvironment } from "../config";
import {
  generateCopilotResponse,
  validateCopilotResponse,
  mergeCopilotCompletedEvidence,
} from "./response-service";
import { renderAnswerText } from "./answer-text";
import { factDigest } from "./fact-context";
import { buildCopilotResponseMessage } from "./response-message";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";

function workload() {
  const storeId = randomUUID();
  const products = Array.from({ length: 20 }, (_, i) => ({
    _id: randomUUID(),
    storeId,
    label: `Produit pilote ${String.fromCharCode(65 + i)}`,
    category: i % 2 ? "FRUIT" : "VEGETABLE",
    nature: "BULK",
    salesUnit: i % 3 ? "KG" : "PIECE",
  }));
  const availability = (value: string | null) => ({
    status: value === null ? "UNAVAILABLE" : "AVAILABLE",
    inputCount: 1,
    availableInputCount: value === null ? 0 : 1,
    missingInputCount: value === null ? 1 : 0,
  });
  const dates = (start: string) =>
    Array.from({ length: 31 }, (_, i) =>
      new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
    );
  const days = [...dates("2026-10-01"), ...dates("2025-10-02")];
  const snapshots = products.flatMap((p, i) =>
    days.map((date, j) => ({
      _id: randomUUID(),
      storeId,
      productId: p._id,
      date,
      performance: {
        storeId,
        productId: p._id,
        date,
        formulaVersion: "product-daily-v1",
        inputRevision: "fixture",
        computedAt: "2026-11-06T00:00:00Z",
        sales: {
          salesValue: String(10 + i),
          marginValue: String(2 + i),
          quantity: i === 0 && j === 1 ? null : String(3 + i),
          quantityUnit: p.salesUnit,
        },
        waste: { salesValue: j % 3 ? null : "1" },
        availability: {
          salesValue: availability(String(10 + i)),
          salesMarginValue: availability(String(2 + i)),
          wasteSalesValue: availability(j % 3 ? null : "1"),
          salesQuantity: availability(
            i === 0 && j === 1 ? null : String(3 + i),
          ),
        },
      },
    })),
  );
  const department = days.map((date) => ({
    _id: randomUUID(),
    storeId,
    date,
    performance: {
      storeId,
      date,
      formulaVersion: "department-daily-v1",
      inputRevision: "fixture",
      computedAt: "2026-11-06T00:00:00Z",
      sales: { salesValue: "390", marginValue: "230" },
      waste: { salesValue: null },
      availability: {
        salesValue: availability("390"),
        salesMarginValue: availability("230"),
        wasteSalesValue: availability(null),
      },
    },
  }));
  const cursor = (items: unknown[]) => ({
    maxTimeMS() {
      return this;
    },
    limit(n: number) {
      items = items.slice(0, n);
      return this;
    },
    async toArray() {
      return items;
    },
  });
  const db = {
    collection(name: string) {
      return {
        find(query: Record<string, unknown>) {
          if (name === "products") {
            const ids = (query._id as { $in?: string[] } | undefined)?.$in;
            return cursor(
              ids ? products.filter((p) => ids.includes(p._id)) : products,
            );
          }
          const range = query.date as
            { $gte: string; $lte: string } | undefined;
          return cursor(
            (name === "departmentDailyPerformance"
              ? department
              : snapshots
            ).filter(
              (r) => !range || (r.date >= range.$gte && r.date <= range.$lte),
            ),
          );
        },
        async findOne(query: { _id: string }) {
          return products.find((p) => p._id === query._id) ?? null;
        },
        aggregate() {
          return cursor([]);
        },
      };
    },
  } as unknown as Db;
  const currentPeriod = { start: "2026-10-01", end: "2026-10-31" },
    referencePeriod = { start: "2025-10-02", end: "2025-11-01" };
  const base: CopilotAnalyticsQuery = {
    currentPeriod,
    referencePeriod,
    referenceMode: "CUSTOM",
    groupBy: "PRODUCT",
    metrics: ["sales", "margin", "waste"],
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
    limit: 20,
  };
  const category = { ...base, groupBy: "CATEGORY" as const };
  const measures: CopilotAnalyticsQuery = {
    ...base,
    metrics: ["sales"],
    includeSalesMeasures: true,
    limit: 10,
    chart: {
      type: "BARS",
      measure: "CURRENT_REFERENCE",
      value: "REALIZED_PRICE",
    },
  };
  const period = {
    productId: null,
    currentPeriod,
    referencePeriod,
    referenceMode: "CUSTOM" as const,
    aggregation: "SUM" as const,
    metrics: ["sales", "margin", "waste"] as Array<
      "sales" | "margin" | "waste"
    >,
  };
  return { storeId, db, base, category, measures, period };
}
function response(
  content: unknown,
  calls?: Array<{ name: string; input: unknown }>,
  streaming = false,
  truncated = false,
) {
  const wireText = truncated
    ? JSON.stringify(content).slice(
        0,
        JSON.stringify(content).indexOf("La couverture reste partielle.") + 10,
      )
    : JSON.stringify(content);
  if (streaming) {
    const events: unknown[] = [
      {
        type: "response.created",
        response: { id: randomUUID(), model: "fixture-expert", created_at: 1 },
      },
    ];
    if (calls)
      for (const [i, c] of calls.entries()) {
        const item = {
          type: "function_call",
          id: randomUUID(),
          call_id: randomUUID(),
          name: c.name,
          arguments: JSON.stringify(c.input),
          status: "completed",
        };
        events.push(
          {
            type: "response.output_item.added",
            output_index: i,
            item: { ...item, arguments: "" },
          },
          { type: "response.output_item.done", output_index: i, item },
        );
      }
    else {
      const id = randomUUID();
      events.push(
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id },
        },
        {
          type: "response.output_text.delta",
          item_id: id,
          output_index: 0,
          delta: wireText,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "message", id },
        },
      );
    }
    events.push({
      type: truncated ? "response.incomplete" : "response.completed",
      response: {
        ...(truncated
          ? { incomplete_details: { reason: "max_output_tokens" } }
          : {}),
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
    return new Response(
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  return Response.json({
    id: randomUUID(),
    object: "response",
    created_at: 1,
    model: "fixture-expert",
    status: truncated ? "incomplete" : "completed",
    ...(truncated
      ? { incomplete_details: { reason: "max_output_tokens" } }
      : {}),
    output: calls
      ? calls.map((c, i) => ({
          type: "function_call",
          id: randomUUID(),
          call_id: `call_${randomUUID()}_${i}`,
          name: c.name,
          arguments: JSON.stringify(c.input),
          status: "completed",
        }))
      : [
          {
            id: randomUUID(),
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: wireText,
                annotations: [],
              },
            ],
          },
        ],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

it.each([
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [true, true, false],
  [false, false, true],
])(
  "finishes monthly analysis with canonical sources (streaming %s, truncated %s, exhausted reads %s)",
  async (streaming, truncated, exhaustedReads) => {
    const f = workload();
    const fullPeriod = await readPeriodAnalysis(f.db, f.storeId, f.period);
    const fullProducts = await readAnalyticsQuery(f.db, f.storeId, f.base);
    const fullCategories = await readAnalyticsQuery(
      f.db,
      f.storeId,
      f.category,
    );
    const fullMeasures = await readAnalyticsQuery(f.db, f.storeId, f.measures);
    const expected = [fullPeriod, fullProducts, fullCategories, fullMeasures];
    const original = expected.map((v) => projectCopilotModelValue(v));
    const digests = expected.map(factDigest);
    const config = parseEnvironment({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test-not-real-no-network",
      COPILOT_AI_MODEL: "fixture-expert",
      COPILOT_AI_TIMEOUT_MS: "20000",
      COPILOT_AI_MAX_OUTPUT_TOKENS: "4000",
      COPILOT_AI_MAX_INPUT_BYTES: "256000",
    });
    const request = {
      requestId: randomUUID(),
      storeId: f.storeId,
      userQuestion:
        "Bilan approfondi du mois et des produits, quantités et prix, sans modification.",
      context: detectCopilotConflicts({
        batch: scoreCopilotPriorities({
          storeId: f.storeId,
          evaluatedAt: "2026-11-06T00:00:00Z",
          candidates: [],
        }),
        intents: [],
      }),
    };
    const observed: CopilotGenerationUsage[] = [];
    const canonicalByRef = new Map<string, string>();
    let turns = 0;
    const collect = (body: Record<string, unknown>) => {
      let resultIndex = 0;
      for (const item of body.input as Array<{
        type: string;
        output?: string;
      }>) {
        if (item.type !== "function_call_output" || !item.output) continue;
        const value = JSON.parse(item.output);
        expect(value.unavailable).not.toBe(true);
        expect(value.evidence.columns).toEqual([
          "ref",
          "label",
          "value",
          "sourceType",
          "factKind",
          "detail",
          "extra",
        ]);
        const originalEvidence =
          expected[Math.min(resultIndex++, expected.length - 1)]!.evidence;
        for (const [index, row] of (
          value.evidence.rows as string[][]
        ).entries()) {
          const ref = row[0]!,
            id = originalEvidence[index]!.id;
          expect(row[1]).toBe(originalEvidence[index]!.label);
          expect(row[2]).toBe(originalEvidence[index]!.value);
          const prior = canonicalByRef.get(ref);
          expect(prior === undefined || prior === id).toBe(true);
          canonicalByRef.set(ref, id);
        }
      }
    };
    let wireFactsBytes = 0,
      canonicalFactsBytes = 0;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        turns++;
        expect(body.max_output_tokens).toBe(turns === 1 ? 4000 : 10000);
        if (turns === 1) {
          const names = body.tools.map((tool: { name: string }) => tool.name);
          expect(names).toEqual(
            expect.arrayContaining([
              "analytics_period",
              "analytics_query",
              "mongo_aggregate",
              "mongo_list",
              "find_tools",
            ]),
          );
          expect(names).not.toContain("commercial_pdf");
        }
        expect(body.stream === true).toBe(streaming);
        if (exhaustedReads && turns === 3)
          expect(body.tool_choice).toBe("none");
        if (turns === 1)
          return response(
            null,
            [
              { name: "analytics_period", input: f.period },
              { name: "analytics_query", input: f.base },
              { name: "analytics_query", input: f.category },
            ],
            streaming,
          );
        collect(body);
        if (turns === 2)
          return response(
            null,
            [
              { name: "analytics_query", input: f.measures },
              ...(exhaustedReads
                ? [{ name: "analytics_query", input: f.measures }]
                : []),
            ],
            streaming,
          );
        const facts = [...canonicalByRef.keys()]
          .slice(0, 96)
          .map((evidenceId) => ({ evidenceId }));
        wireFactsBytes = bytes(facts);
        canonicalFactsBytes = bytes(
          facts.map((x) => ({ evidenceId: canonicalByRef.get(x.evidenceId) })),
        );
        return response(
          {
            language: "fr-FR",
            summary: "Voici le bilan renseigné.",
            facts,
            narrative:
              "Le rayon présente un montant renseigné de {{value:0}}. {{source:0}}\n\n| Repère | Montant |\n| --- | ---: |\n" +
              facts
                .slice(1, 12)
                .map((_, i) => `| {{label:${i + 1}}} | {{value:${i + 1}}} |`)
                .join("\n") +
              "\n\nLa couverture reste partielle. Je te propose de surveiller les produits moteurs, puis les prix réalisés et la casse renseignée.",
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          undefined,
          streaming,
          truncated,
        );
      });
    const period = vi.fn(async () => fullPeriod),
      analyticsQuery = vi.fn(async (input: CopilotAnalyticsQuery) =>
        input.includeSalesMeasures
          ? fullMeasures
          : input.groupBy === "CATEGORY"
            ? fullCategories
            : fullProducts,
      );
    const partials: unknown[] = [];
    const result = await createCopilotAiProvider(config, transport, {
      daily: vi.fn(),
      mongoRead: vi.fn(),
      commercialPdf: vi.fn(),
      needCatalogue: vi.fn(),
      referenceInspection: vi.fn(),
      conversationHistory: vi.fn(),
      period,
      analyticsQuery,
      onUsage: (event) => observed.push(event),
    }).generate(
      request,
      copilotResponseSchema,
      undefined,
      streaming
        ? (partial) => {
            partials.push(partial);
          }
        : undefined,
    );
    if (streaming) {
      expect(partials.length).toBeGreaterThan(0);
      expect(JSON.stringify(partials)).not.toMatch(/"evidenceId":"r\d+"/);
    }
    expect(result.outputLimited).toBe(truncated ? true : undefined);
    if (truncated)
      expect(result.output.narrative).toContain("Cette réponse est partielle");
    const onFailure = vi.fn();
    const generation = await generateCopilotResponse(
      {
        model: "fixture-expert",
        generate: vi.fn().mockResolvedValue(result),
      } as CopilotAiProvider,
      request,
      undefined,
      undefined,
      undefined,
      onFailure,
    );
    expect(generation.mode).toBe("AI");
    expect(onFailure).not.toHaveBeenCalled();
    const parent = {
      ...chatFixture(randomUUID).message,
      storeId: f.storeId,
      text: request.userQuestion,
      attachments: [],
    };
    const message = buildCopilotResponseMessage({
      id: randomUUID(),
      createdAt: parent.createdAt,
      parent,
      request,
      generation,
    });
    expect(message.text).toContain("copilot-source:");
    expect(message.text.includes("Cette réponse est partielle")).toBe(
      truncated,
    );
    expect(message.text).not.toContain(
      "L’analyse du copilote est momentanément indisponible",
    );
    expect(turns).toBe(3);
    expect(period).toHaveBeenCalledTimes(1);
    expect(analyticsQuery).toHaveBeenCalledTimes(3);
    expect(result.output.facts).toHaveLength(96);
    expect(result.output.facts.every((v) => !/^r\d+$/.test(v.evidenceId))).toBe(
      true,
    );
    const merged = mergeCopilotCompletedEvidence(request, result.toolEvidence);
    const valid = validateCopilotResponse(result.output, {
      ...request,
      evidence: merged,
    });
    expect(() =>
      validateCopilotResponse(
        { ...result.output, facts: [{ evidenceId: "r999999" }] },
        { ...request, evidence: merged },
      ),
    ).toThrow("UNKNOWN_EVIDENCE");
    expect(renderAnswerText(valid.narrative!, valid.facts, merged)).toContain(
      "copilot-source:",
    );
    expect(merged.find((e) => e.chart)?.chart).toEqual(
      fullMeasures.evidence.find((e) => e.chart)?.chart,
    );
    expect(expected.map(factDigest)).toEqual(digests);
    expect(
      result.factTrace?.reads.find((r) => r.read.kind === "PERIOD")?.digest,
    ).toBe(factDigest(fullPeriod));
    const payloads = observed.filter((e) => e.kind === "TOOL_RESULT");
    expect(payloads).toHaveLength(exhaustedReads ? 5 : 4);
    const before = payloads.reduce((sum, e) => sum + e.originalBytes, 0),
      after = payloads.reduce((sum, e) => sum + e.modelBytes, 0);
    expect(before).toBe(
      original.reduce((sum, v) => sum + bytes(v), 0) +
        (exhaustedReads ? bytes(original[3]) : 0),
    );
    expect(before).toBeGreaterThan(256000);
    expect(after).toBeLessThan(256000);
    expect(after).toBeLessThan(before * 0.6);
    expect(wireFactsBytes).toBeLessThan(canonicalFactsBytes * 0.4);
    expect(
      observed.filter((e) => e.kind === "STEP").map((e) => e.toolNames),
    ).toEqual([
      ["analytics_period", "analytics_query"],
      ["analytics_query"],
      [],
    ]);
    expect(
      observed.filter((e) => e.kind === "STEP").map((e) => e.outputTokenLimit),
    ).toEqual([4000, 10000, 10000]);
    expect(observed.at(-1)).toMatchObject({
      kind: "END",
      outcome: truncated ? "PARTIAL" : "COMPLETED",
      readFailures: {},
    });
    // Fixture bytes, not measured provider tokens or a production success claim.
    process.stdout.write(
      JSON.stringify({
        fixture: "monthly-analytics",
        toolBytesBefore: before,
        toolBytesAfter: after,
        finalFactBytesBefore: canonicalFactsBytes,
        finalFactBytesAfter: wireFactsBytes,
      }) + "\n",
    );
  },
);
