import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readMongoExploration } from "../src/copilot/mongo-read-tool";
import { factReadFromTool } from "../src/copilot/fact-context";
import { renderAnswerText } from "../src/copilot/answer-text";
import { factDigest } from "../src/copilot/fact-context";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "read-only Mongo exploration against real MongoDB",
  () => {
    let client: MongoClient, db: Db;
    const storeId = randomUUID(),
      foreign = randomUUID(),
      productId = randomUUID();
    const period = { start: "2026-10-01", end: "2026-10-31" };
    const status = (value: string | null) => ({
      status: value === null ? "UNAVAILABLE" : "AVAILABLE",
    });
    const row = (
      date: string,
      sales: string | null,
      quantity: string | null,
      unit = "KG",
      store = storeId,
    ) => ({
      _id: randomUUID(),
      storeId: store,
      productId,
      date,
      secret: "never-visible",
      performance: {
        storeId: store,
        productId,
        date,
        formulaVersion: "product-daily-v1",
        inputRevision: `revision-${date}`,
        sales: {
          salesValue: sales,
          marginValue: null,
          quantity,
          quantityUnit: unit,
        },
        waste: {
          salesValue: null,
          purchaseValueKnown: "0.12",
          purchaseValueEstimated: "0.34",
        },
        availability: {
          salesValue: status(sales),
          salesMarginValue: status(null),
          salesQuantity: status(quantity),
          wasteSalesValue: status(null),
          wastePurchaseValueKnown: status("0.12"),
          wastePurchaseValueEstimated: status("0.34"),
        },
      },
    });
    const aggregate = (
      pipeline: unknown[],
      collection = "productDailyPerformance",
    ) =>
      readMongoExploration(db, storeId, {
        action: "AGGREGATE",
        collection,
        period,
        pipeline: JSON.stringify(pipeline),
      });
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_mongo_read_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
    });
    afterAll(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });
    beforeEach(async () => {
      await Promise.all([
        db.collection<Document & { _id: string }>("products").deleteMany({}),
        db
          .collection<Document & { _id: string }>("productDailyPerformance")
          .deleteMany({}),
      ]);
      await db.collection<Document & { _id: string }>("products").insertMany([
        {
          _id: productId,
          storeId,
          label: "BANANE",
          category: "FRUIT",
          nature: "BULK",
          salesUnit: "KG",
          status: "ACTIVE",
          version: 2,
          privateNote: "never-visible",
        },
        { _id: randomUUID(), storeId: foreign, label: "FOREIGN SECRET" },
      ]);
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .insertMany([
          row("2026-10-01", "0.1", "0.01"),
          row("2026-10-02", "0.2", "0.02"),
          row("2026-10-03", null, null),
          row("2026-09-30", "1000", "100"),
          row("2026-10-01", "99999", "999", "KG", foreign),
        ]);
    });
    it("executes an actual model-chosen pipeline with exact decimal sums, null preservation and source citations, without a write", async () => {
      const before = await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .find()
        .sort({ _id: 1 })
        .toArray();
      const result = await aggregate([
        {
          $group: {
            _id: null,
            sales: { $sum: "$sales" },
            absentWaste: { $sum: "$waste" },
            rows: { $sum: 1 },
          },
        },
      ]);
      expect(result.status).toBe("AVAILABLE");
      expect(result.rows).toEqual([
        { _id: null, sales: "0.3", absentWaste: null, rows: 3 },
      ]);
      expect(result.sourceCoverage).toMatchObject({
        inputRows: 3,
        sales_AVAILABLE: 2,
        sales_UNAVAILABLE: 1,
      });
      expect(
        await db
          .collection<Document & { _id: string }>("productDailyPerformance")
          .find()
          .sort({ _id: 1 })
          .toArray(),
      ).toEqual(before);
      expect(
        factReadFromTool(JSON.stringify(["mongo", result.input]), result)?.read
          .kind,
      ).toBe("MONGO");
      expect(
        renderAnswerText(
          "{{value:0}} {{source:0}}",
          [{ evidenceId: result.evidence[1]!.id }],
          result.evidence,
        ),
      ).toContain("copilot-source:");
    });
    it("pairs sales and quantities within explicit units and keeps known versus estimated waste costs separate", async () => {
      const r = await aggregate([
        {
          $match: {
            quantityUnit: "KG",
            salesStatus: "AVAILABLE",
            quantityStatus: "AVAILABLE",
          },
        },
        {
          $group: {
            _id: "$productId",
            sales: { $sum: "$sales" },
            quantity: { $sum: "$quantity" },
            costKnown: { $sum: "$wasteCostKnown" },
            costEstimated: { $sum: "$wasteCostEstimated" },
          },
        },
        { $set: { price: { $divide: ["$sales", "$quantity"] } } },
      ]);
      expect(r.rows[0]).toMatchObject({
        sales: "0.3",
        quantity: "0.03",
        price: "1E+1",
        costKnown: "0.24",
        costEstimated: "0.68",
      });
    });
    it("never reveals raw fields or foreign records through list/get/filter, and joins only the current store catalogue", async () => {
      const list = await readMongoExploration(db, storeId, {
        action: "LIST",
        collection: "products",
        period: null,
        afterId: null,
        limit: 1,
      });
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]).toMatchObject({ id: productId, status: "ACTIVE" });
      expect(JSON.stringify(list)).not.toMatch(/never-visible|FOREIGN SECRET/);
      const alien = await db
        .collection<Document & { _id: string }>("products")
        .findOne({ storeId: foreign });
      const get = await readMongoExploration(db, storeId, {
        action: "GET",
        collection: "products",
        id: alien!._id,
      });
      expect(get.status).toBe("EMPTY");
      const r = await aggregate([
        { $project: { label: 1, category: 1, sales: 1, id: 1 } },
      ]);
      expect(
        r.rows.every((x) => x.label === "BANANE" && x.category === "FRUIT"),
      ).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/never-visible|FOREIGN SECRET/);
    });
    it("paginates list reads by stable source ids and exposes a changed read digest after a corrected projection", async () => {
      const input = {
        action: "LIST" as const,
        collection: "productDailyPerformance" as const,
        period,
        afterId: null,
        limit: 1,
      };
      const first = await readMongoExploration(db, storeId, input);
      expect(first.hasMore).toBe(true);
      const second = await readMongoExploration(db, storeId, {
        ...input,
        afterId: first.nextAfterId,
      });
      expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
      expect(await readMongoExploration(db, storeId, input)).toEqual(first);
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .updateOne(
          { _id: String(first.rows[0]!.id) },
          {
            $set: {
              "performance.sales.salesValue": "5.00",
              "performance.inputRevision": "corrected",
            },
          },
        );
      expect(
        factDigest(await readMongoExploration(db, storeId, input)),
      ).not.toBe(factDigest(first));
    });
    it("masks quantities pending canonical unit recomputation or having unknown recorded units", async () => {
      await db
        .collection<Document & { _id: string }>("products")
        .updateOne(
          { _id: productId },
          { $set: { analyticsRefresh: { generation: "pending" } } },
        );
      const pending = await aggregate([]);
      expect(
        pending.rows.every(
          (r) => r.quantity === null && r.quantityRefreshPending === true,
        ),
      ).toBe(true);
      await db
        .collection<Document & { _id: string }>("products")
        .updateOne({ _id: productId }, { $unset: { analyticsRefresh: "" } });
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .updateMany(
          { storeId },
          { $set: { "performance.sales.quantityUnit": "UNKNOWN" } },
        );
      expect(
        (await aggregate([])).rows.every(
          (r) => r.quantity === null && r.quantityStatus === "UNAVAILABLE",
        ),
      ).toBe(true);
    });
    it("does not confuse a missing product with an empty department and guards inconsistent embedded tenants", async () => {
      await db
        .collection<Document & { _id: string }>("productDailyPerformance")
        .insertOne({
          ...row("2026-10-04", "999999", "1"),
          performance: row("2026-10-04", "999999", "1", "KG", foreign)
            .performance,
        });
      expect(
        (
          await aggregate([
            { $group: { _id: null, sales: { $sum: "$sales" } } },
          ])
        ).rows[0]!.sales,
      ).toBe("0.3");
      const r = await aggregate([{ $match: { productId: randomUUID() } }]);
      expect(r.status).toBe("EMPTY");
      expect(r.sourceCoverage!.inputRows).toBe(3);
    });
  },
);
