import { directReferenceModelFixture } from "../../../../scripts/test-chat-fixtures";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import {
  copilotResponseSchema,
  recommendationTypeSchema,
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
          quantity: i === 1 && j === 1 ? null : String(3 + i),
          quantityUnit: p.salesUnit,
        },
        waste: { salesValue: j % 3 ? null : "1" },
        availability: {
          salesValue: availability(String(10 + i)),
          salesMarginValue: availability(String(2 + i)),
          wasteSalesValue: availability(j % 3 ? null : "1"),
          salesQuantity: availability(
            i === 1 && j === 1 ? null : String(3 + i),
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
    filters: {
      ...base.filters,
      productIds: products
        .filter((p) => p.salesUnit === "KG")
        .map((p) => p._id),
    },
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
  content = directReferenceModelFixture(content);
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
  [false, false, false, false, false],
  [true, false, false, false, false],
  [false, true, false, false, false],
  [true, true, false, false, false],
  [false, false, true, false, false],
  [false, false, false, true, false],
  [true, false, false, true, false],
  [false, false, false, false, true],
  [true, false, false, false, true],
])(
  "finishes monthly analysis with canonical sources (streaming %s, truncated %s, exhausted reads %s, malformed blocks %s, large answer %s)",
  async (
    streaming,
    truncated,
    exhaustedReads,
    malformedBlocks,
    largeAnswer,
  ) => {
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
    const requestBodies: Array<{
      input: Array<{ role?: string; content?: unknown }>;
      tools: unknown;
      text: { format: unknown };
      tool_choice?: unknown;
    }> = [];
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
        // Decode the actual provider payload and compare every retained field,
        // not just the final handful of facts selected by the scripted model.
        const canonical =
          original[Math.min(resultIndex - 1, original.length - 1)]!;
        const decoded = structuredClone(value);
        const restoreRefs = (item: unknown): unknown => {
          if (typeof item === "string") return canonicalByRef.get(item) ?? item;
          if (Array.isArray(item)) return item.map(restoreRefs);
          if (item && typeof item === "object")
            return Object.fromEntries(
              Object.entries(item).map(([k, v]) => [k, restoreRefs(v)]),
            );
          return item;
        };
        decoded.rows = decoded.rows?.map((row: Record<string, unknown>) => {
          if (!decoded.metricColumns) return row;
          return {
            ...row,
            metrics: (row.metrics as unknown[][]).map((cells) =>
              Object.fromEntries(
                decoded.metricColumns.map((key: string, i: number) => {
                  const coverage =
                    key === "currentCoverageIndex" ||
                    key === "referenceCoverageIndex";
                  return [
                    coverage ? key.replace(/Index$/, "") : key,
                    coverage && cells[i] !== null
                      ? decoded.coverages[Number(cells[i])]
                      : cells[i],
                  ];
                }),
              ),
            ),
          };
        });
        expect(restoreRefs(decoded.rows)).toEqual(
          "rows" in canonical ? canonical.rows : undefined,
        );
        const metadata = (v: object) =>
          Object.fromEntries(
            Object.entries(v).filter(
              ([key]) =>
                ![
                  "rows",
                  "evidence",
                  "remainingReads",
                  "coverages",
                  "metricColumns",
                ].includes(key),
            ),
          );
        expect(restoreRefs(metadata(decoded))).toEqual(metadata(canonical));
        const reconstructed = value.evidence.rows.map((row: unknown[]) => {
          const detail =
            row[5] === null
              ? undefined
              : value.evidence.details[Number(row[5])];
          return {
            label: row[1],
            value: row[2],
            sourceType: row[3],
            factKind: row[4],
            ...(detail === undefined
              ? {}
              : {
                  detail: Array.isArray(detail)
                    ? detail
                        .map((i: number) => value.evidence.detailParts[i])
                        .join("")
                    : detail,
                }),
            ...(row[6] ?? {}),
          };
        });
        expect(reconstructed).toEqual(
          canonical.evidence.map((entry) =>
            Object.fromEntries(
              Object.entries(entry).filter(
                ([key]) => !["id", "sourceId", "sourceVersion"].includes(key),
              ),
            ),
          ),
        );
      }
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        expect(body.text.format.schema.properties).not.toHaveProperty("facts");
        requestBodies.push(body);
        turns++;
        expect(body.max_output_tokens).toBe(turns === 1 ? 4000 : 10000);
        const allowsUnboundPriorities =
          body.text.format.schema.properties.recommendations.maxItems !== 0;
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
          const queryTool = body.tools.find(
            (t: { name: string }) => t.name === "analytics_query",
          );
          expect(queryTool.description).toContain("{{chart:REF}}");
          expect(queryTool.description).not.toContain("zero-based");
          expect(queryTool.description).toContain("reuse returned measures");
        }
        expect(body.stream === true).toBe(streaming);
        if (exhaustedReads && turns === 2)
          expect(body.tool_choice).toBe("none");
        if (turns === 1)
          return response(
            null,
            [
              { name: "analytics_period", input: f.period },
              { name: "analytics_query", input: f.base },
              { name: "analytics_query", input: f.category },
              { name: "analytics_query", input: f.measures },
              ...(exhaustedReads
                ? [{ name: "analytics_query", input: f.measures }]
                : []),
            ],
            streaming,
          );
        collect(body);
        const refs = [...canonicalByRef.keys()].slice(
          0,
          largeAnswer ? 108 : 12,
        );
        const chartId = fullMeasures.evidence.find((e) => e.chart)!.id;
        const chartRef = [...canonicalByRef].find(
          ([, id]) => id === chartId,
        )![0];
        const wasteId = fullProducts.rows[0]!.metrics.find(
          (m) => m.metric === "waste",
        )!.evidenceIds.current;
        const wasteRef = [...canonicalByRef].find(
          ([, id]) => id === wasteId,
        )![0];
        return response(
          {
            narrative:
              `Le rayon présente un montant renseigné de {{value:${refs[0]}}}. {{source:${refs[0]}}}\n\n| Repère | Montant |\n| --- | ---: |\n` +
              refs
                .slice(1)
                .map((ref) => `| {{label:${ref}}} | {{value:${ref}}} |`)
                .join("\n") +
              (largeAnswer
                ? `\n\nLa casse renseignée reste consultable : {{value:${wasteRef}}}. {{source:${wasteRef}}}`
                : "") +
              "\n\nMes priorités : surveiller les produits moteurs, vérifier les prix réalisés et suivre la casse renseignée.\n\nLa couverture reste partielle." +
              (malformedBlocks
                ? `\n\nValeur inconnue {{value:r999999}}.\n\nMontant 999999 €.\n\nRéférence mal formée {{value:r0}.\n\nMauvais graphique {{chart:${refs[0]}}}.\n\nLa suite reste lisible. {{chart:${chartRef}}}`
                : ""),
            recommendations: allowsUnboundPriorities
              ? [
                  {
                    candidateId:
                      "qualitative-priority-without-deterministic-candidate",
                    type: recommendationTypeSchema.options[0],
                    title: "Surveiller les produits moteurs",
                    explanation: "Une piste qualitative pour le rayon.",
                    evidenceIds: [refs[0]!],
                    confidence: "LOW",
                    risks: [],
                    missingData: [],
                    measurement: {
                      objective: "Suivre les contributions",
                      evidenceIds: [],
                      reviewWhen: "Au prochain bilan",
                    },
                  },
                ]
              : [],
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
    expect(result.outputLimited).toBe(
      truncated || malformedBlocks ? true : undefined,
    );
    expect(result.metadata).toMatchObject({
      inputTokens: 20,
      outputTokens: 40,
    });
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
    expect(onFailure.mock.calls).toEqual([]);
    expect(generation.mode).toBe("AI");
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
    expect(turns).toBe(2);
    if (largeAnswer) {
      expect(message.text).toContain("La casse renseignée reste consultable");
      expect(message.text).not.toContain("Un passage n’a pas pu être vérifié");
      expect(result.outputLimited).toBeUndefined();
    }
    // The provider sees the same tools/schema and an append-only input even
    // when the final step forces conclusion. This qualifies prefix stability,
    // not an actual remote cache hit or billed-token reduction.
    for (let index = 1; index < requestBodies.length; index++) {
      const previous = requestBodies[index - 1]!,
        current = requestBodies[index]!;
      expect(current.tools).toEqual(previous.tools);
      expect(current.text.format).toEqual(previous.text.format);
      expect(current.input.slice(0, previous.input.length)).toEqual(
        previous.input,
      );
    }
    if (exhaustedReads) {
      const last = requestBodies.at(-1)!;
      expect(last.tool_choice).toBe("none");
      expect(last.input.at(-1)).toMatchObject({
        role: "system",
        content:
          "Conclude now using completed verified reads. State any uncompleted scope once; do not infer absent data.",
      });
    }
    expect(period).toHaveBeenCalledTimes(1);
    expect(analyticsQuery).toHaveBeenCalledTimes(3);
    // The server retains only the twelve facts actually used by this narrative;
    // the old fixture copied 96 entries, most of which were never displayed.
    expect(result.output.facts).toHaveLength(
      largeAnswer ? 108 : malformedBlocks ? 13 : 12,
    );
    if (malformedBlocks) {
      expect(message.text).toContain("La suite reste lisible");
      expect(message.text).toContain("Un passage n’a pas pu être vérifié");
      expect(message.text).not.toContain("999999");
      expect(message.text).not.toContain("{{");
      expect(result.factTrace?.complete).toBe(false);
      expect(message.text).toContain("Graphique");
      expect(observed.at(-1)).toMatchObject({
        answerOmissions: { reference: 1, render: 3 },
      });
    }
    expect(result.output.recommendations).toEqual([]);
    expect(result.output.narrative).toContain("Mes priorités");
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
    expect(after).toBeLessThan(before * 0.3);
    expect(
      observed.filter((e) => e.kind === "STEP").map((e) => e.toolNames),
    ).toEqual([["analytics_period", "analytics_query"], []]);
    expect(
      observed.filter((e) => e.kind === "STEP").map((e) => e.outputTokenLimit),
    ).toEqual([4000, 10000]);
    expect(observed.at(-1)).toMatchObject({
      kind: "END",
      outcome: truncated || malformedBlocks ? "PARTIAL" : "COMPLETED",
      readFailures: {},
    });
    // Fixture bytes, not measured provider tokens or a production success claim.
    process.stdout.write(
      JSON.stringify({
        fixture: "monthly-analytics",
        providerSteps: requestBodies.length,
        requestInputBytes: requestBodies.reduce(
          (sum, b) => sum + bytes(b.input),
          0,
        ),
        toolBytesBefore: before,
        toolBytesAfter: after,
        modelCopiedFactEntries: 0,
        retainedFacts: result.output.facts.length,
      }) + "\n",
    );
  },
);
