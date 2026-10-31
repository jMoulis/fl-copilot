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
const storeId = "11111111-1111-4111-8111-111111111111";
const period = { start: "2026-10-01", end: "2026-10-31" };
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
