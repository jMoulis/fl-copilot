import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { parseEnvironment } from "../src/config.js";
import { createMongoDatabase } from "../src/database/mongo.js";
import type { DatabaseService } from "../src/database/types.js";
import { createCommercialVisualProcessor } from "../src/commercial/visual-processing.js";
import { createCommercialOriginalLinkService } from "../src/commercial/original-link.js";
import { createMongoSyncPullService } from "../src/sync/pull-service.js";
import { createMongoSyncBootstrapService } from "../src/sync/bootstrap-service.js";
import type { CommercialVisualProvider } from "../src/commercial/visual-provider.js";
import { CommercialAiPermanentError } from "../src/commercial/ai-provider.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "private original and visual PDF workflow",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_visual_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
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
        bytes = new TextEncoder().encode("%PDF-1.7 synthetic original");
      const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const db = await database.getDb();
      const c = (name: string) =>
        db.collection<{ _id: string; [key: string]: unknown }>(name);
      await c("sourceDocuments").insertOne({
        _id: sourceDocumentId,
        storeId,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        checksum,
        objectKey: "private-original.pdf",
        originalFilename: "original.pdf",
        sizeBytes: bytes.length,
        remoteUploadStatus: "CONFIRMED",
      });
      await c("commercialDocumentJobs").insertOne({
        _id: sourceDocumentId,
        storeId,
        checksum,
        parserVersion: "parser",
        pageCount: 1,
        status: "TO_VALIDATE",
        stage: "DRAFT_REVIEW",
      });
      await c("commercialDocumentPages").insertOne({
        _id: randomUUID(),
        storeId,
        sourceDocumentId,
        checksum,
        parserVersion: "parser",
        pageNumber: 1,
        width: 800,
        height: 600,
        rotation: 0,
        text: "DRAMAT RAISIN Moins de 2,20€ le kg",
        spans: [],
        warnings: [],
      });
      return { storeId, sourceDocumentId, bytes, checksum };
    }
    function provider(called: () => void): CommercialVisualProvider {
      return {
        model: "test-vision",
        async extract(target, pages, bytes, referenceDate) {
          expect(referenceDate).toBeInstanceOf(Date);
          called();
          expect(target).toBe(1);
          expect(pages).toHaveLength(1);
          expect(new TextDecoder().decode(bytes)).toBe(
            "%PDF-1.7 synthetic original",
          );
          return {
            output: {
              operations: [
                {
                  kind: "DRAMAT",
                  label: "RAISIN",
                  summaryFr: "Raisin à moins de 2,20€ le kg.",
                  fields: [],
                  evidence: [
                    { pageNumber: 1, quote: "DRAMAT RAISIN", region: null },
                  ],
                  items: [
                    {
                      kind: "OFFER",
                      label: "RAISIN",
                      fields: [
                        {
                          name: "sellingPrice",
                          rawValue: "Moins de 2,20€ le kg",
                          confidence: 0.95,
                          evidence: [
                            {
                              pageNumber: 1,
                              quote: "Moins de 2,20€ le kg",
                              region: null,
                            },
                          ],
                        },
                      ],
                      evidence: [
                        { pageNumber: 1, quote: "RAISIN", region: null },
                      ],
                    },
                  ],
                },
              ],
              tgIdeas: [],
              otherInformation: [],
              warnings: [],
            },
            responseId: "response",
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        },
      };
    }
    it("claims one immutable reading under concurrent delivery, sends original bytes and preserves legacy sources", async () => {
      const s = await seed();
      let calls = 0;
      const processor = createCommercialVisualProcessor(
        database,
        provider(() => calls++),
        { read: async () => s.bytes },
      );
      await processor.pending();
      const db = await database.getDb();
      const original = await db
        .collection<{ _id: string }>("commercialDocumentJobs")
        .findOne({ _id: s.sourceDocumentId });
      await Promise.all([
        processor.process(s.storeId, s.sourceDocumentId, 1),
        processor.process(s.storeId, s.sourceDocumentId, 1),
      ]);
      expect(calls).toBe(1);
      expect(
        await db
          .collection("commercialVisualReadings")
          .countDocuments({ storeId: s.storeId, status: "READY" }),
      ).toBe(1);
      expect(
        await db.collection("syncChanges").countDocuments({
          storeId: s.storeId,
          entityType: "commercial_visual_reading",
        }),
      ).toBe(1);
      await processor.process(s.storeId, s.sourceDocumentId, 1);
      expect(calls).toBe(1);
      expect(
        await db
          .collection<{ _id: string }>("commercialDocumentJobs")
          .findOne({ _id: s.sourceDocumentId }),
      ).toEqual(original);
      expect(
        await db.collection("offers").countDocuments({ storeId: s.storeId }),
      ).toBe(0);
    }, 20000);
    it("rejects a checksum mismatch without a model call and synchronizes the failure once", async () => {
      const s = await seed();
      let calls = 0;
      const processor = createCommercialVisualProcessor(
        database,
        provider(() => calls++),
        { read: async () => new Uint8Array([1, 2, 3]) },
      );
      await processor.pending();
      expect(
        await processor.process(s.storeId, s.sourceDocumentId, 1),
      ).toMatchObject({
        status: "FAILED",
        errorCode: "COMMERCIAL_VISUAL_CHECKSUM_MISMATCH",
      });
      await processor.process(s.storeId, s.sourceDocumentId, 1);
      expect(calls).toBe(0);
      expect(
        await (
          await database.getDb()
        )
          .collection("syncChanges")
          .countDocuments({ storeId: s.storeId }),
      ).toBe(1);
    }, 20000);
    it("keeps visual entities out of older clients and restores them through capable bootstrap", async () => {
      const s = await seed();
      const processor = createCommercialVisualProcessor(
        database,
        provider(() => {}),
        { read: async () => s.bytes },
      );
      await processor.pending();
      await processor.process(s.storeId, s.sourceDocumentId, 1);
      const pull = createMongoSyncPullService(database);
      expect(
        (await pull.pull(s.storeId, { limit: 500, commercialReview: "true" }))
          .changes,
      ).toEqual([]);
      const visible = await pull.pull(s.storeId, {
        limit: 500,
        commercialVisual: "true",
      });
      expect(visible.changes[0]?.entityType).toBe("commercial_visual_reading");
      const boot = await createMongoSyncBootstrapService(database).bootstrap(
        {
          storeId: s.storeId,
          storeName: "Test",
          role: "MANAGER",
          userId: randomUUID(),
          sessionId: randomUUID(),
          deviceId: randomUUID(),
        },
        { rawObservationDays: 90, commercialVisual: "true" },
      );
      expect(boot.entities.commercialVisualReadings).toHaveLength(1);
    }, 20000);
    it("scopes original download signing to the registered store/path and two minutes", async () => {
      const s = await seed();
      const signed: Array<{ path: string; expiry: number }> = [];
      const now = new Date("2026-10-08T06:00:00Z");
      const service = createCommercialOriginalLinkService(
        database,
        async (path, expiry) => {
          signed.push({ path, expiry });
          return "https://private.blob.vercel-storage.com/original.pdf?signed";
        },
        () => now,
      );
      const result = await service.link(s.storeId, s.sourceDocumentId);
      expect(result.expiresAt).toBe("2026-10-08T06:02:00.000Z");
      expect(signed).toEqual([
        { path: "private-original.pdf", expiry: now.getTime() + 120000 },
      ]);
      await expect(
        service.link(randomUUID(), s.sourceDocumentId),
      ).rejects.toThrow();
      expect(signed).toHaveLength(1);
    }, 20000);
    it("backs off temporary failures and publishes only the eventual immutable result", async () => {
      const s = await seed();
      let clock = new Date("2026-10-11T21:59:00Z"),
        calls = 0;
      const referenceDates: string[] = [];
      const retrying: CommercialVisualProvider = {
        model: "test-retry",
        extract: async (...args) => {
          calls++;
          referenceDates.push(args[3]!.toISOString());
          if (calls === 1) throw new Error("temporary network failure");
          return provider(() => undefined).extract(...args);
        },
      };
      const processor = createCommercialVisualProcessor(
        database,
        retrying,
        { read: async () => s.bytes },
        () => clock,
      );
      await processor.pending();
      expect(
        await processor.process(s.storeId, s.sourceDocumentId, 1),
      ).toMatchObject({ status: "RETRY" });
      expect(
        (await processor.pending()).find(
          (job) => job.sourceDocumentId === s.sourceDocumentId,
        ),
      ).toBeUndefined();
      expect(
        await processor.process(s.storeId, s.sourceDocumentId, 1),
      ).toMatchObject({ status: "IN_PROGRESS" });
      expect(calls).toBe(1);
      clock = new Date(clock.getTime() + 121000);
      expect(
        (await processor.pending()).find(
          (job) => job.sourceDocumentId === s.sourceDocumentId,
        )?.pages,
      ).toContain(1);
      expect(
        await processor.process(s.storeId, s.sourceDocumentId, 1),
      ).toMatchObject({ status: "READY" });
      expect(calls).toBe(2);
      expect(referenceDates).toEqual([
        "2026-10-11T21:59:00.000Z",
        "2026-10-11T21:59:00.000Z",
      ]);
      expect(
        await processor.process(s.storeId, s.sourceDocumentId, 1),
      ).toMatchObject({ status: "READY" });
      expect(calls).toBe(2);
    }, 20000);
    it("permanent model configuration failures stop", async () => {
      const s = await seed();
      const configured: CommercialVisualProvider = {
        model: "test-error",
        extract: async () => {
          throw new CommercialAiPermanentError(
            "COMMERCIAL_AI_CONFIGURATION_REQUIRED",
          );
        },
      };
      const processor = createCommercialVisualProcessor(database, configured, {
        read: async () => s.bytes,
      });
      await processor.pending();
      expect(
        await processor.process(s.storeId, s.sourceDocumentId, 1),
      ).toMatchObject({ status: "FAILED" });
    }, 20000);
  },
);
