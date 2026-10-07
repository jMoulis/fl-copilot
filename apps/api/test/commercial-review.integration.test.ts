import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CommercialReviewPage,
  CommercialReviewDecision,
  SyncCommand,
} from "@fl-copilot/sync-contracts";
import { createMongoDatabase } from "../src/database/mongo.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService } from "../src/database/types.js";
import { registerCommercialReviewPages } from "../src/commercial/review-sync.js";
import { createMongoSyncPullService } from "../src/sync/pull-service.js";
import { createMongoSyncPushService } from "../src/sync/push-service.js";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "commercial extraction review sync",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_review_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      await (await database.getDb()).dropDatabase();
      await database.close();
    });
    async function seed() {
      const storeId = randomUUID(),
        sourceDocumentId = randomUUID(),
        pageId = randomUUID();
      const db = await database.getDb();
      const page: CommercialReviewPage = {
        id: pageId,
        storeId,
        sourceDocumentId,
        checksum: "sha256:fixture",
        pageNumber: 1,
        pageCount: 1,
        originalFilename: "week.pdf",
        remoteVersion: 1,
        warnings: [],
        issues: [],
        blocks: [
          {
            kind: "OFFER",
            label: "POIRE",
            sourceBlockIndex: 0,
            validationStatus: "TO_VALIDATE",
            evidence: [
              { pageNumber: 1, spanIndices: [0], quote: "POIRE 2,99 €/kg" },
            ],
            fields: [
              {
                name: "sellingPrice",
                rawValue: "2,99 €/kg",
                confidence: 0.9,
                validationStatus: "TO_VALIDATE",
                evidence: [
                  { pageNumber: 1, spanIndices: [0], quote: "2,99 €/kg" },
                ],
              },
            ],
          },
        ],
      };
      const collection = (name: string) =>
        db.collection<{ _id: string; [key: string]: unknown }>(name);
      await collection("sourceDocuments").insertOne({
        _id: sourceDocumentId,
        storeId,
        originalFilename: page.originalFilename,
      });
      await collection("commercialDocumentJobs").insertOne({
        _id: sourceDocumentId,
        storeId,
        checksum: page.checksum,
        pageCount: 1,
        status: "TO_VALIDATE",
        stage: "DRAFT_REVIEW",
        parserVersion: "parser",
        aiModel: "model",
        aiSchemaVersion: "schema",
      });
      await collection("commercialDocumentAiPages").insertOne({
        _id: pageId,
        storeId,
        sourceDocumentId,
        pageNumber: 1,
        checksum: page.checksum,
        parserVersion: "parser",
        model: "model",
        schemaVersion: "schema",
        status: "DRAFT_READY",
        draft: { blocks: page.blocks, warnings: [], issues: [] },
      });
      return { storeId, sourceDocumentId, pageId, page };
    }
    function review(
      page: CommercialReviewPage,
      overrides: Partial<CommercialReviewDecision> = {},
    ): CommercialReviewDecision {
      return {
        id: randomUUID(),
        storeId: page.storeId,
        sourceDocumentId: page.sourceDocumentId,
        pageId: page.id,
        sourceBlockIndex: 0,
        checksum: page.checksum,
        decision: "CONFIRMED_TRANSCRIPTION",
        corrections: [{ name: "sellingPrice", value: "3,49 €/kg" }],
        reviewedAt: new Date().toISOString(),
        ...overrides,
      };
    }
    function command(d: CommercialReviewDecision): SyncCommand {
      return {
        commandId: randomUUID(),
        localSequence: 1,
        type: "COMMERCIAL_TRANSCRIPTION_REVIEW",
        entityType: "commercial_review_decision",
        entityId: d.id,
        expectedRemoteVersion: null,
        createdAt: new Date().toISOString(),
        payload: d,
      };
    }
    async function push(
      d: CommercialReviewDecision,
      c = command(d),
      storeId = d.storeId,
      deviceId = randomUUID(),
    ) {
      return createMongoSyncPushService(database).push(
        {
          syncProtocolVersion: 1,
          appVersion: "test",
          storeId,
          deviceId,
          commands: [c],
        },
        randomUUID(),
      );
    }
    it("registers immutable page snapshots exactly once under concurrent delivery", async () => {
      const { storeId, sourceDocumentId, pageId, page } = await seed();
      const db = await database.getDb();
      const original = await db
        .collection("commercialDocumentAiPages")
        .findOne({ sourceDocumentId });
      await Promise.all([
        registerCommercialReviewPages(database, storeId, sourceDocumentId),
        registerCommercialReviewPages(database, storeId, sourceDocumentId),
      ]);
      expect(
        await db
          .collection("commercialReviewPages")
          .countDocuments({ storeId }),
      ).toBe(1);
      expect(
        await db
          .collection("syncChanges")
          .countDocuments({ storeId, entityType: "commercial_review_page" }),
      ).toBe(1);
      expect(
        await db
          .collection("commercialDocumentAiPages")
          .findOne({ sourceDocumentId }),
      ).toEqual(original);
      const result = await createMongoSyncPullService(database).pull(storeId, {
        limit: 500,
        commercialReview: "true",
      });
      expect(result.changes[0]).toMatchObject({
        entityId: pageId,
        entity: page,
      });
    }, 20000);
    it("omits new entities for old clients while new bootstrap restores them", async () => {
      const { storeId, page } = await seed();
      await registerCommercialReviewPages(database, storeId);
      const old = await createMongoSyncPullService(database).pull(storeId, {
        limit: 500,
      });
      expect(old.changes).toEqual([]);
      expect(old.nextCursor).toBeTruthy();
      const store = {
        storeId,
        storeName: "Rayon test",
        role: "MANAGER",
        userId: randomUUID(),
        sessionId: randomUUID(),
        deviceId: randomUUID(),
      };
      const bootstrap = await createMongoSyncBootstrapService(
        database,
      ).bootstrap(store, { rawObservationDays: 90, commercialReview: "true" });
      expect(bootstrap.entities.commercialReviewPages).toEqual([page]);
      const legacy = await createMongoSyncBootstrapService(database).bootstrap(
        store,
        { rawObservationDays: 90 },
      );
      expect(legacy.entities.commercialReviewPages).toBeUndefined();
    }, 20000);
    it("retries the same immutable decision without double publication and restores it on another device", async () => {
      const { storeId, page } = await seed();
      await registerCommercialReviewPages(database, storeId);
      const d = review(page),
        c = command(d),
        deviceId = randomUUID();
      expect((await push(d, c, storeId, deviceId)).results[0]?.status).toBe(
        "APPLIED",
      );
      expect((await push(d, c, storeId, deviceId)).results[0]?.status).toBe(
        "ALREADY_APPLIED",
      );
      const db = await database.getDb();
      expect(
        await db
          .collection("commercialReviewDecisions")
          .countDocuments({ storeId }),
      ).toBe(1);
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId,
          entityType: "commercial_review_decision",
        }),
      ).toBe(1);
      expect(await db.collection("offers").countDocuments({ storeId })).toBe(0);
      expect(
        await db.collection("commercialOperations").countDocuments({ storeId }),
      ).toBe(0);
      const boot = await createMongoSyncBootstrapService(database).bootstrap(
        {
          storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        },
        { rawObservationDays: 90, commercialReview: "true" },
      );
      expect(boot.entities.commercialReviewDecisions).toEqual([
        { id: d.id, storeId, remoteVersion: 1, decision: d },
      ]);
    }, 20000);
    it("rejects source tampering and reports another device's different choice as conflict", async () => {
      const { storeId, page } = await seed();
      await registerCommercialReviewPages(database, storeId);
      const d = review(page);
      for (const invalid of [
        review(page, { checksum: "wrong" }),
        review(page, {
          corrections: [{ name: "purchasePrice", value: "1 €" }],
        }),
      ])
        expect((await push(invalid)).results[0]?.status).toBe("REJECTED");
      expect((await push(d, command(d), randomUUID())).results[0]?.status).toBe(
        "REJECTED",
      );
      expect((await push(d)).results[0]?.status).toBe("APPLIED");
      const other = review(page, { decision: "DISMISSED", corrections: [] });
      const result = await push(other);
      expect(result.results[0]).toMatchObject({
        status: "CONFLICT",
        remoteEntity: { id: d.id, decision: d },
        error: { code: "COMMERCIAL_REVIEW_ALREADY_RECORDED" },
      });
      expect(
        await (
          await database.getDb()
        )
          .collection("commercialReviewDecisions")
          .countDocuments({ storeId }),
      ).toBe(1);
    }, 20000);
    it("keeps independent block decisions in the same store", async () => {
      const { storeId, page, pageId } = await seed();
      page.blocks.push({ ...page.blocks[0]!, sourceBlockIndex: 1 });
      const db = await database.getDb();
      await db
        .collection<{ _id: string }>("commercialDocumentAiPages")
        .updateOne({ _id: pageId }, { $set: { "draft.blocks": page.blocks } });
      await registerCommercialReviewPages(database, storeId);
      expect((await push(review(page))).results[0]?.status).toBe("APPLIED");
      expect(
        (await push(review(page, { sourceBlockIndex: 1 }))).results[0]?.status,
      ).toBe("APPLIED");
      expect(
        await db
          .collection("commercialReviewDecisions")
          .countDocuments({ storeId }),
      ).toBe(2);
    }, 20000);
  },
);
