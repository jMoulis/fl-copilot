import { expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  copilotMongoReadInputSchema,
  factReadSchema,
} from "@fl-copilot/domain";
import {
  readMongoExploration,
  validateMongoReadPipeline,
} from "./mongo-read-tool";
import { factReadFromTool } from "./fact-context";
import { readActivityStage } from "./read-activity";
import { renderAnswerText } from "./answer-text";
import { COPILOT_READ_EVIDENCE_LIMIT } from "./generation-limits";
const storeId = "11111111-1111-4111-8111-111111111111";
const period = { start: "2026-10-01", end: "2026-10-31" };
it("supplies scalar cell/date/coverage evidence for the real narrative renderer, including nested group keys", async () => {
  const db = {
    collection: () => ({
      aggregate: () => ({
        next: async () => ({
          rows: [
            {
              _id: { label: "BANANE", unit: "KG" },
              sales: "12.34",
              quantity: "2",
            },
          ],
          coverage: [{ inputRows: 2 }],
        }),
      }),
    }),
  } as unknown as Db;
  const r = await readMongoExploration(db, storeId, {
    action: "AGGREGATE",
    collection: "productDailyPerformance",
    period,
    pipeline: "[]",
  });
  const labels = [
    "Résultat 1 · _id.label",
    "Résultat 1 · sales",
    "Résultat 1 · quantity",
    "Périmètre · period.start",
    "Périmètre · coverage.inputRows",
  ];
  const facts = labels.map((label) => ({
    evidenceId: r.evidence.find((e) => e.label === label)!.id,
  }));
  const text = renderAnswerText(
    "| Produit | CA | Quantité |\n| --- | --- | --- |\n| {{value:0}} | {{value:1}} € | {{value:2}} kg |\nDepuis {{value:3}}, {{value:4}} entrées consultées. {{source:1}}",
    facts,
    r.evidence,
  );
  expect(text).toContain("| BANANE | 12,34 € | 2 kg |");
  expect(text).toContain("Depuis 2026-10-01, 2 entrées consultées.");
  expect(text).toContain("copilot-source:");
  expect(text).not.toContain('"sales"');
});
it("keeps the existing evidence ceiling by paging lists and refusing an oversized analytical result without sampled figures", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `row-${i}`,
    ...Object.fromEntries(
      Array.from({ length: 20 }, (_, j) => [`field${j}`, j]),
    ),
  }));
  const db = {
    collection: () => ({
      aggregate: () => ({
        next: async () => ({ rows, coverage: [{ inputRows: 20 }] }),
      }),
    }),
  } as unknown as Db;
  const list = await readMongoExploration(db, storeId, {
    action: "LIST",
    collection: "products",
    period: null,
    afterId: null,
    limit: 20,
  });
  expect(list.status).toBe("AVAILABLE");
  expect(list.evidence.length).toBeLessThanOrEqual(COPILOT_READ_EVIDENCE_LIMIT);
  expect(list.rows.length).toBeLessThan(20);
  expect(list.hasMore).toBe(true);
  expect(list.nextAfterId).toBe(list.rows.at(-1)!.id);
  const aggregate = await readMongoExploration(db, storeId, {
    action: "AGGREGATE",
    collection: "products",
    period: null,
    pipeline: "[]",
  });
  expect(aggregate.status).toBe("LIMIT_EXCEEDED");
  expect(aggregate.rows).toEqual([]);
});
it.each([
  "$out",
  "$merge",
  "$lookup",
  "$unionWith",
  "$facet",
  "$graphLookup",
  "$documents",
  "$changeStream",
  "$search",
  "$collStats",
])("rejects %s before touching the database", async (stage) => {
  const collection = vi.fn();
  const r = await readMongoExploration(
    { collection } as unknown as Db,
    storeId,
    {
      action: "AGGREGATE",
      collection: "products",
      period: null,
      pipeline: JSON.stringify([{ [stage]: "users" }]),
    },
  );
  expect(r.status).toBe("INVALID_QUERY");
  expect(collection).not.toHaveBeenCalled();
});
it.each(
  [
    [{ $match: { $where: "return true" } }],
    [{ $project: { leak: "$$ROOT" } }],
    [{ $project: { leak: "$ownerId" } }],
    [{ $project: { leak: "$id.secret" } }, { $match: { storeId } }],
    [
      {
        $project: {
          leak: { $function: { body: "return 1", args: [], lang: "js" } },
        },
      },
    ],
    [{ $match: { label: { $regex: "(a+)+$" } } }],
    [{ $group: { _id: null, items: { $push: "$label" } } }],
    [{ $limit: 10001 }],
    [{ $set: { price: { $add: [1, 0.1] } } }],
    [{ $match: { $or: [{ label: "A" }, { storeId }] } }],
    [{ $project: { leak: { $literal: { constructor: 1 } } } }],
  ].map((pipeline) => [pipeline]),
)(
  "rejects nested code, private fields, operators and oversized work (%j)",
  (pipeline) => {
    expect(() =>
      validateMongoReadPipeline("products", JSON.stringify(pipeline)),
    ).toThrow();
  },
);
it("accepts flexible comparisons, filters, derived fields, grouping and sorting on public fields", () => {
  const pipeline = [
    {
      $match: {
        date: { $gte: "2026-10-01" },
        $expr: {
          $gte: [{ $indexOfCP: [{ $toLower: "$label" }, "banane"] }, 0],
        },
      },
    },
    {
      $group: {
        _id: { product: "$productId", unit: "$quantityUnit" },
        sales: { $sum: "$sales" },
        quantity: { $sum: "$quantity" },
      },
    },
    {
      $project: {
        productId: "$_id.product",
        unit: "$_id.unit",
        sales: 1,
        quantity: 1,
      },
    },
    { $sort: { sales: -1 } },
  ];
  expect(
    validateMongoReadPipeline(
      "productDailyPerformance",
      JSON.stringify(pipeline),
    ),
  ).toEqual(pipeline);
});
it.each(
  [
    [{ $group: { _id: null, quantity: { $sum: "$quantity" } } }],
    [
      {
        $group: {
          _id: { $literal: "$quantityUnit" },
          q: { $sum: "$quantity" },
        },
      },
    ],
    [
      { $set: { quantityUnit: "KG" } },
      { $group: { _id: "$quantityUnit", q: { $sum: "$quantity" } } },
    ],
    [
      { $group: { _id: "$quantityUnit", q: { $sum: "$quantity" } } },
      { $group: { _id: null, q: { $sum: "$q" } } },
    ],
  ].map((pipeline) => [pipeline]),
)("refuses quantity aggregation that loses units (%j)", (pipeline) => {
  expect(() =>
    validateMongoReadPipeline(
      "productDailyPerformance",
      JSON.stringify(pipeline),
    ),
  ).toThrow(/unité/);
});
it("rejects unknown collections/actor arguments and refuses an unbounded performance scan before DB access", async () => {
  expect(
    copilotMongoReadInputSchema.safeParse({
      action: "GET",
      collection: "users",
      id: "1",
    }).success,
  ).toBe(false);
  expect(
    copilotMongoReadInputSchema.safeParse({
      action: "GET",
      collection: "products",
      id: "1",
      storeId,
    }).success,
  ).toBe(false);
  const collection = vi.fn();
  const r = await readMongoExploration(
    { collection } as unknown as Db,
    storeId,
    {
      action: "AGGREGATE",
      collection: "productDailyPerformance",
      period: null,
      pipeline: "[]",
    },
  );
  expect(r.status).toBe("INVALID_QUERY");
  expect(collection).not.toHaveBeenCalled();
});
it("discovers the public dictionary without inspecting database metadata and retains replayable read provenance", async () => {
  const collection = vi.fn();
  const input = {
    action: "LIST" as const,
    collection: null,
    period: null,
    afterId: null,
    limit: 20,
  };
  const result = await readMongoExploration(
    { collection } as unknown as Db,
    storeId,
    input,
  );
  expect(result.rows.map((r) => r.collection)).toEqual([
    "products",
    "productDailyPerformance",
    "departmentDailyPerformance",
  ]);
  expect(collection).not.toHaveBeenCalled();
  const key = JSON.stringify(["mongo", input]);
  expect(factReadSchema.parse(factReadFromTool(key, result)!.read)).toEqual({
    kind: "MONGO",
    input,
  });
  expect(readActivityStage(key)).toBe("ANALYTICS");
  expect(result.evidence[0]!.detail).not.toContain("pipeline");
});
it("applies the scope and safe projection before user stages and never returns sampled sums over a bounded prefix", async () => {
  let observed: unknown[] = [];
  const aggregate = vi.fn((pipeline, options) => {
    observed = pipeline;
    expect(options).toEqual({ maxTimeMS: 3000, allowDiskUse: false });
    return {
      next: async () => ({
        rows: [{ total: "123" }],
        coverage: [{ inputRows: 100001 }],
      }),
    };
  });
  const r = await readMongoExploration(
    { collection: () => ({ aggregate }) } as unknown as Db,
    storeId,
    {
      action: "AGGREGATE",
      collection: "departmentDailyPerformance",
      period,
      pipeline: '[{"$group":{"_id":null,"total":{"$sum":"$sales"}}}]',
    },
  );
  expect(observed[0]).toMatchObject({
    $match: {
      storeId,
      "performance.storeId": storeId,
      date: { $gte: period.start, $lte: period.end },
    },
  });
  expect(r.status).toBe("LIMIT_EXCEEDED");
  expect(r.rows).toEqual([]);
  expect(JSON.stringify(r.evidence)).not.toContain('"123"');
});
