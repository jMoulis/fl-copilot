import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import {
  commercialProcessingFixture,
  processingTime,
} from "../../../scripts/test-commercial-processing-fixtures";
import { createCommercialProcessingRecovery } from "../src/commercial/processing-recovery";
import { createCommercialAiDraftProcessor } from "../src/commercial/ai-draft-processing";
import { createCommercialVisualProcessor } from "../src/commercial/visual-processing";
import { COMMERCIAL_AI_RUNTIME_BUDGET_VERSION } from "../src/commercial/ai-runtime-limits";
import { AuthError } from "../src/auth/service";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "commercial PDF resume: durable authority, immutable results and scoped work",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_resume_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        }),
      );
      await database.getDb();
    });
    afterAll(async () => {
      if (database) {
        await (await database.getDb()).dropDatabase();
        await database.close();
      }
    });
    async function fixture() {
      const s = commercialProcessingFixture(),
        db = await database.getDb(),
        c = (n: string) =>
          db.collection<{ _id: string; [key: string]: unknown }>(n);
      await c("sourceDocuments").insertOne({
        ...s.source,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
        sizeBytes: 100,
      });
      await c("commercialDocumentJobs").insertOne({
        ...s.job!,
        createdAt: processingTime,
        updatedAt: processingTime,
      });
      for (const p of s.textPages)
        await c("commercialDocumentPages").insertOne({
          _id: randomUUID(),
          storeId: s.source.storeId,
          sourceDocumentId: s.source._id,
          parserVersion: s.job!.parserVersion,
          ...p,
          text: "DRAMAT",
          width: 100,
          height: 100,
          rotation: 0,
          spans: [],
          warnings: [],
        });
      const actor = { userId: randomUUID(), deviceId: randomUUID() },
        authorize = vi.fn(async () => {}),
        dispatch = vi.fn(async () => {});
      let time = processingTime;
      const service = createCommercialProcessingRecovery(
        database,
        { enabled: true, model: s.model },
        dispatch,
        () => time,
      );
      const review = await service.review(s.source.storeId, s.source._id);
      return {
        s,
        db,
        c,
        actor,
        authorize,
        dispatch,
        service,
        review,
        setTime: (t: Date) => {
          time = t;
        },
      };
    }
    it("accepts once, replays one operation after response loss, keeps attempts/source/results and does not expose private metadata", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source;
      const original = await f.c("sourceDocuments").findOne({ _id: id }),
        before = await f.c("commercialDocumentJobs").findOne({ _id: id });
      expect(JSON.stringify(f.review)).not.toMatch(
        /objectKey|private\/|test-model|draft|userId/,
      );
      const input = {
        operationId: randomUUID(),
        basisHash: f.review.basisHash,
      };
      await f.service.request(storeId, id, input, f.actor, f.authorize);
      await f.service.request(storeId, id, input, f.actor, f.authorize);
      expect(f.dispatch).toHaveBeenCalledTimes(1);
      expect(
        await f
          .c("commercialDocumentRecoveryRequests")
          .countDocuments({ storeId }),
      ).toBe(1);
      const after = await f.c("commercialDocumentJobs").findOne({ _id: id });
      expect(after).toEqual({ ...before, lastManualResumeAt: processingTime });
      expect(await f.c("sourceDocuments").findOne({ _id: id })).toEqual(
        original,
      );
      expect(await f.service.work(storeId, id, input.operationId)).toEqual([
        "AI",
        "VISUAL",
      ]);
      expect(await f.service.work(randomUUID(), id, input.operationId)).toEqual(
        [],
      );
      expect((await f.service.review(storeId, id)).canResume).toBe(false);
      await expect(
        f.service.request(
          storeId,
          id,
          { ...input, basisHash: "c".repeat(64) },
          f.actor,
          f.authorize,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    });
    it("rejects stale proof, ownership/source drift and rolls back when manager authority disappears before commit", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source,
        input = { operationId: randomUUID(), basisHash: f.review.basisHash };
      await expect(f.service.review(randomUUID(), id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await f
        .c("commercialDocumentJobs")
        .updateOne({ _id: id }, { $set: { attemptCount: 3 } });
      await expect(
        f.service.request(storeId, id, input, f.actor, f.authorize),
      ).rejects.toMatchObject({
        publicCode: "COMMERCIAL_ANALYSIS_STATE_CHANGED",
      });
      const latest = await f.service.review(storeId, id);
      let n = 0;
      await expect(
        f.service.request(
          storeId,
          id,
          { ...input, basisHash: latest.basisHash },
          f.actor,
          async () => {
            if (++n === 4) throw new AuthError(403, "REVOKED", "Accès retiré.");
          },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(
        await f
          .c("commercialDocumentRecoveryRequests")
          .countDocuments({ storeId }),
      ).toBe(0);
      expect(
        (await f.c("commercialDocumentJobs").findOne({ _id: id }))
          ?.lastManualResumeAt,
      ).toBeUndefined();
      expect(f.dispatch).not.toHaveBeenCalled();
    });
    it("recovers unavailable dispatch on the same operation, bounds broker attempts and handles a crash on the final lease", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source,
        input = { operationId: randomUUID(), basisHash: f.review.basisHash };
      f.dispatch.mockRejectedValue(Error("private broker token"));
      await expect(
        f.service.request(storeId, id, input, f.actor, f.authorize),
      ).rejects.toMatchObject({
        publicCode: "COMMERCIAL_ANALYSIS_DISPATCH_PENDING",
        retryable: true,
      });
      expect(await f.service.pendingDispatches()).toBe(0);
      for (let i = 1; i < 5; i++) {
        f.setTime(new Date(processingTime.getTime() + i * 61_000));
        await f.service.pendingDispatches();
      }
      expect(f.dispatch).toHaveBeenCalledTimes(5);
      expect(
        (
          await f
            .c("commercialDocumentRecoveryRequests")
            .findOne({ _id: input.operationId })
        )?.status,
      ).toBe("DELIVERY_FAILED");
      await f.c("commercialDocumentRecoveryRequests").updateOne(
        { _id: input.operationId },
        {
          $set: { status: "PENDING", dispatchLeaseExpiresAt: processingTime },
        },
      );
      await f.service.pendingDispatches();
      expect(
        (
          await f
            .c("commercialDocumentRecoveryRequests")
            .findOne({ _id: input.operationId })
        )?.status,
      ).toBe("DELIVERY_FAILED");
      expect(f.dispatch).toHaveBeenCalledTimes(5);
      await expect(
        f.service.request(storeId, id, input, f.actor, f.authorize),
      ).rejects.toMatchObject({
        publicCode: "COMMERCIAL_ANALYSIS_DELIVERY_FAILED",
      });
    });
    it("serializes duplicate concurrent decisions and fences a reused operation across different sources", async () => {
      const f = await fixture(),
        g = await fixture(),
        { storeId, _id: id } = f.s.source,
        operationId = randomUUID();
      const result = await Promise.allSettled([
        f.service.request(
          storeId,
          id,
          { operationId, basisHash: f.review.basisHash },
          f.actor,
          f.authorize,
        ),
        g.service.request(
          g.s.source.storeId,
          g.s.source._id,
          { operationId, basisHash: g.review.basisHash },
          g.actor,
          g.authorize,
        ),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        result
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason.publicCode),
      ).toEqual(["COMMERCIAL_ANALYSIS_REQUEST_CHANGED"]);
      expect(f.dispatch.mock.calls.length + g.dispatch.mock.calls.length).toBe(
        1,
      );
    });
    it("limits worker eligibility to accepted stages and rechecks checksum and active leases", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source;
      await f
        .c("commercialDocumentJobs")
        .updateOne(
          { _id: id },
          { $set: { stage: "TEXT_EXTRACTION", status: "PENDING" } },
        );
      const review = await f.service.review(storeId, id),
        input = { operationId: randomUUID(), basisHash: review.basisHash };
      await f.service.request(storeId, id, input, f.actor, f.authorize);
      expect(await f.service.work(storeId, id, input.operationId)).toEqual([
        "TEXT",
      ]);
      await f
        .c("commercialDocumentJobs")
        .updateOne(
          { _id: id },
          { $set: { stage: "AI_EXTRACTION", status: "TEXT_READY" } },
        );
      expect(await f.service.work(storeId, id, input.operationId)).toEqual([]);
      await f
        .c("sourceDocuments")
        .updateOne(
          { _id: id },
          { $set: { checksum: `sha256:${"c".repeat(64)}` } },
        );
      expect(await f.service.work(storeId, id, input.operationId)).toEqual([]);
    });
    it("scopes visual registration to the requested source; completed and failed results never call providers again", async () => {
      const f = await fixture(),
        g = await fixture(),
        { storeId, _id: id } = f.s.source;
      const provider = { model: f.s.model, extract: vi.fn() },
        visual = createCommercialVisualProcessor(
          database,
          provider,
          { read: vi.fn() },
          () => processingTime,
        );
      expect(await visual.pending({ storeId, sourceDocumentId: id })).toEqual([
        { storeId, sourceDocumentId: id, pages: [1, 2] },
      ]);
      expect(
        await f.c("commercialVisualJobs").findOne({ _id: g.s.source._id }),
      ).toBeNull();
      expect(provider.extract).not.toHaveBeenCalled();
      for (const pageNumber of [1, 2])
        await f.c("commercialVisualReadings").insertOne({
          _id: randomUUID(),
          storeId,
          sourceDocumentId: id,
          pageNumber,
          model: f.s.model,
          schemaVersion: f.s.visualSchema,
          checksum: f.s.source.checksum,
          status: pageNumber === 1 ? "READY" : "FAILED",
          reading: pageNumber === 1 ? { retained: true } : null,
          attemptCount: 4,
        });
      const retained = await f
        .c("commercialVisualReadings")
        .find({ storeId })
        .sort({ pageNumber: 1 })
        .toArray();
      expect(await visual.pending({ storeId, sourceDocumentId: id })).toEqual(
        [],
      );
      await visual.process(storeId, id, 1);
      await visual.process(storeId, id, 2);
      expect(
        await f
          .c("commercialVisualReadings")
          .find({ storeId })
          .sort({ pageNumber: 1 })
          .toArray(),
      ).toEqual(retained);
      expect(provider.extract).not.toHaveBeenCalled();
    });
    it("does not reopen legacy budgets during manual AI manifest preparation", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source;
      const page = {
        _id: randomUUID(),
        storeId,
        sourceDocumentId: id,
        pageNumber: 1,
        parserVersion: f.s.job!.parserVersion,
        schemaVersion: f.s.aiSchema,
        model: f.s.model,
        checksum: f.s.source.checksum,
        status: "FAILED",
        errorCode: "COMMERCIAL_AI_ATTEMPT_LIMIT",
        attemptCount: 4,
        budgetAttemptCount: 4,
        runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION - 1,
      };
      await f.c("commercialDocumentAiPages").insertOne(page);
      const provider = { model: f.s.model, extract: vi.fn() },
        processor = createCommercialAiDraftProcessor(
          database,
          provider,
          () => processingTime,
        );
      await processor.manifest(storeId, id, false);
      await processor.extractPage(storeId, id, 1);
      expect(
        await f.c("commercialDocumentAiPages").findOne({ _id: page._id }),
      ).toEqual(page);
      expect(provider.extract).not.toHaveBeenCalled();
    });
  },
);
