import {
  mongoMigrations,
  runMongoMigrations,
} from "../src/database/migrations";
import { createHash } from "node:crypto";
import { registerCommercialReviewPages } from "../src/commercial/review-sync";
import { readCurrentCommercialVisualPages } from "../src/commercial/current-visual-readings";
import { createMongoSyncPullService } from "../src/sync/pull-service";
import {
  applyCommercialVisualReading,
  readCommercialVisualReadings,
} from "../../mobile/src/commercial/visual-repository";
import { VisualTestDatabase } from "../../../scripts/test-visual-sqlite";
import { DatabaseSync } from "node:sqlite";
import { runLocalMigrations } from "../../mobile/src/db/migrations";
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
import { createCommercialVisualProcessor } from "../src/commercial/visual-processing";
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
    it("never replays a previously accepted text-AI-only recovery request or changes its stored results", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source;
      const page = {
        _id: randomUUID(),
        storeId,
        sourceDocumentId: id,
        pageNumber: 1,
        checksum: f.s.source.checksum,
        parserVersion: f.s.job!.parserVersion,
        schemaVersion: f.s.aiSchema,
        model: f.s.model,
        status: "FAILED",
        errorCode: "COMMERCIAL_AI_ATTEMPT_LIMIT",
        attemptCount: 4,
        runtimeBudgetVersion: 1,
      };
      await f.c("commercialDocumentAiPages").insertOne(page);
      const operationId = randomUUID();
      await f.c("commercialDocumentRecoveryRequests").insertOne({
        _id: operationId,
        storeId,
        sourceDocumentId: id,
        checksum: f.s.source.checksum,
        stages: ["AI"],
        status: "DISPATCHED",
      });
      expect(await f.service.work(storeId, id, operationId)).toEqual([]);
      expect(
        await f.c("commercialDocumentAiPages").findOne({ _id: page._id }),
      ).toEqual(page);
      expect((await f.service.review(storeId, id)).canResume).toBe(true);
    });
    it("publishes complete received legacy text pages after an interrupted finalization, without inventing the missing page", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source;
      await f.c("commercialDocumentJobs").updateOne(
        { _id: id },
        {
          $set: {
            status: "PROCESSING",
            stage: "AI_EXTRACTION",
            aiModel: f.s.model,
            aiSchemaVersion: f.s.aiSchema,
          },
        },
      );
      const page = (pageNumber: number) => ({
        _id: randomUUID(),
        storeId,
        sourceDocumentId: id,
        pageNumber,
        parserVersion: f.s.job!.parserVersion,
        schemaVersion: f.s.aiSchema,
        model: f.s.model,
        checksum: f.s.source.checksum,
        status: "DRAFT_READY",
        draft: { blocks: [], warnings: [], issues: [] },
      });
      await f.c("commercialDocumentAiPages").insertOne(page(1));
      await registerCommercialReviewPages(database, storeId, id);
      expect(
        await f.c("commercialReviewPages").countDocuments({ storeId }),
      ).toBe(0);
      await f.c("commercialDocumentAiPages").insertOne(page(2));
      const before = await f
        .c("commercialDocumentAiPages")
        .find({ storeId })
        .toArray();
      await registerCommercialReviewPages(database, storeId, id);
      await registerCommercialReviewPages(database, storeId, id);
      expect(
        await f.c("commercialReviewPages").countDocuments({ storeId }),
      ).toBe(2);
      expect(
        await f.c("commercialDocumentAiPages").find({ storeId }).toArray(),
      ).toEqual(before);
      expect(await f.c("commercialWeekPlans").countDocuments({ storeId })).toBe(
        0,
      );
    });
    it("reanalyses the same retained original once, preserves old generations, and synchronizes only coherent fresh results", async () => {
      const f = await fixture(),
        { storeId, _id: id } = f.s.source;
      const bytes = new TextEncoder().encode(
          "synthetic private PDF, no provider call",
        ),
        checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      await f
        .c("sourceDocuments")
        .updateOne({ _id: id }, { $set: { checksum } });
      await f.c("commercialDocumentJobs").updateOne(
        { _id: id },
        {
          $set: {
            checksum,
            status: "PROCESSING",
            stage: "AI_EXTRACTION",
            aiModel: f.s.model,
            aiSchemaVersion: f.s.aiSchema,
          },
        },
      );
      await f
        .c("commercialDocumentPages")
        .updateMany({ storeId }, { $set: { checksum } });
      const empty = {
        operations: [],
        tgIdeas: [],
        otherInformation: [],
        warnings: [],
      };
      for (const pageNumber of [1, 2]) {
        await f.c("commercialDocumentAiPages").insertOne({
          _id: randomUUID(),
          storeId,
          sourceDocumentId: id,
          checksum,
          parserVersion: f.s.job!.parserVersion,
          pageNumber,
          model: f.s.model,
          schemaVersion: f.s.aiSchema,
          status: "DRAFT_READY",
          draft: { blocks: [], warnings: [], issues: [] },
        });
        const readingId = randomUUID();
        await f.c("commercialVisualReadings").insertOne({
          _id: readingId,
          id: readingId,
          storeId,
          sourceDocumentId: id,
          checksum,
          pageNumber,
          pageCount: 2,
          model: f.s.model,
          schemaVersion: f.s.visualSchema,
          remoteVersion: 1,
          status: "READY",
          reading: empty,
          errorCode: null,
        });
      }
      await f.c("commercialVisualJobs").insertOne({
        _id: id,
        storeId,
        sourceDocumentId: id,
        checksum,
        parserVersion: f.s.job!.parserVersion,
        pageCount: 2,
        model: f.s.model,
        schemaVersion: f.s.visualSchema,
        status: "COMPLETE",
      });
      const oldVisual = await f
        .c("commercialVisualReadings")
        .find({ storeId })
        .sort({ pageNumber: 1 })
        .toArray();
      const oldAi = await f
        .c("commercialDocumentAiPages")
        .find({ storeId })
        .toArray();
      const original = await f.c("sourceDocuments").findOne({ _id: id });
      const review = await f.service.review(storeId, id);
      expect(review.canRestart).toBe(true);
      const input = {
        operationId: randomUUID(),
        basisHash: review.basisHash,
        mode: "RESTART" as const,
      };
      await f.service.request(storeId, id, input, f.actor, f.authorize);
      await f.service.request(storeId, id, input, f.actor, f.authorize);
      expect(f.dispatch).toHaveBeenCalledTimes(1);
      await expect(
        f.service.request(
          storeId,
          id,
          { ...input, operationId: randomUUID() },
          f.actor,
          f.authorize,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await f.service.work(storeId, id, input.operationId)).toEqual([
        "VISUAL",
      ]);
      const visualCall = vi.fn(async () => ({
        output: empty,
        responseId: "synthetic",
        usage: { inputTokens: 0, outputTokens: 0 },
      }));
      const visual = createCommercialVisualProcessor(
        database,
        { model: f.s.model, extract: visualCall },
        { read: async () => bytes },
        () => processingTime,
      );
      await visual.pending({ storeId, sourceDocumentId: id });
      expect(
        (
          await readCurrentCommercialVisualPages(f.db, storeId, id, checksum)
        ).map((p) => p.id),
      ).toEqual(oldVisual.map((p) => p.id));
      await visual.process(storeId, id, 1);
      expect(
        (
          await readCurrentCommercialVisualPages(f.db, storeId, id, checksum)
        ).map((p) => p.id),
      ).toEqual(oldVisual.map((p) => p.id));
      await visual.process(storeId, id, 2);
      await visual.pending({ storeId, sourceDocumentId: id });
      await registerCommercialReviewPages(database, storeId);
      await visual.process(storeId, id, 1);
      expect(visualCall).toHaveBeenCalledTimes(2);
      expect(
        await f
          .c("commercialDocumentAiPages")
          .countDocuments({ storeId, analysisRevision: 1 }),
      ).toBe(0);
      expect(await f.c("sourceDocuments").findOne({ _id: id })).toEqual(
        original,
      );
      expect(await f.c("sourceDocuments").countDocuments({ storeId })).toBe(1);
      expect(
        await f
          .c("commercialDocumentAiPages")
          .find({ storeId, analysisRevision: null })
          .toArray(),
      ).toEqual(oldAi);
      expect(
        await f
          .c("commercialVisualReadings")
          .find({ storeId, analysisRevision: null })
          .sort({ pageNumber: 1 })
          .toArray(),
      ).toEqual(oldVisual);
      expect(
        await f.c("commercialReviewPages").countDocuments({ storeId }),
      ).toBe(2);
      const pull = createMongoSyncPullService(database);
      await expect(
        pull.pull(storeId, { limit: 200, commercialVisual: "true" }),
      ).rejects.toMatchObject({
        publicCode: "COMMERCIAL_ANALYSIS_UPGRADE_REQUIRED",
      });
      await expect(
        pull.pull(
          storeId,
          { limit: 200, documentArchiveHistory: "true" },
          f.actor.userId,
        ),
      ).resolves.toMatchObject({ changes: [] });
      const pulled = await pull.pull(storeId, {
        limit: 200,
        commercialVisual: "true",
        commercialReview: "true",
        commercialAnalysisRevisions: "true",
      });
      const local = new VisualTestDatabase(new DatabaseSync(":memory:"));
      try {
        await runLocalMigrations(local);
        for (const change of pulled.changes.filter(
          (c) => c.entityType === "commercial_visual_reading",
        ))
          await applyCommercialVisualReading(local, storeId, change.entity);
        expect(
          (await readCommercialVisualReadings(local, storeId, id)).map(
            (p) => p.analysisRevision,
          ),
        ).toEqual([1, 1]);
      } finally {
        local.raw.close();
      }
      expect((await f.service.review(storeId, id)).state).toBe("READY");
      const record = await f
        .c("commercialDocumentRecoveryRequests")
        .findOne({ _id: input.operationId });
      expect(record?.previousJob).toMatchObject({ status: "PROCESSING" });
      expect(record?.previousVisualJob).toMatchObject({ status: "COMPLETE" });
    });
    it("upgrades existing immutable extraction indexes without changing a single legacy record", async () => {
      const db = (await database.getDb()).client.db(
        `flc_revision_migrate_${randomUUID().replaceAll("-", "")}`,
      );
      try {
        await runMongoMigrations(
          db,
          mongoMigrations.filter((m) => [14, 15, 16].includes(m.version)),
        );
        for (const name of [
          "commercialDocumentAiPages",
          "commercialVisualReadings",
          "commercialReviewPages",
        ]) {
          const row = {
            _id: randomUUID(),
            storeId: randomUUID(),
            sourceDocumentId: randomUUID(),
            parserVersion: "p",
            schemaVersion: "s",
            model: "m",
            pageNumber: 1,
          };
          await db.collection<{ _id: string }>(name).insertOne(row);
        }
        const before = await Promise.all(
          [
            "commercialDocumentAiPages",
            "commercialVisualReadings",
            "commercialReviewPages",
          ].map((name) =>
            db
              .collection<import("mongodb").Document & { _id: string }>(name)
              .find()
              .toArray(),
          ),
        );
        await runMongoMigrations(
          db,
          mongoMigrations.filter((m) => [14, 15, 16, 54].includes(m.version)),
        );
        await mongoMigrations.find((m) => m.version === 54)!.up(db);
        const after = await Promise.all(
          [
            "commercialDocumentAiPages",
            "commercialVisualReadings",
            "commercialReviewPages",
          ].map((name) =>
            db
              .collection<import("mongodb").Document & { _id: string }>(name)
              .find()
              .toArray(),
          ),
        );
        expect(after).toEqual(before);
        for (const [index, name] of [
          "commercialDocumentAiPages",
          "commercialVisualReadings",
          "commercialReviewPages",
        ].entries()) {
          const row = before[index]![0]!;
          await db
            .collection<import("mongodb").Document & { _id: string }>(name)
            .insertOne({ ...row, _id: randomUUID(), analysisRevision: 1 });
          await expect(
            db
              .collection<import("mongodb").Document & { _id: string }>(name)
              .insertOne({ ...row, _id: randomUUID(), analysisRevision: 1 }),
          ).rejects.toMatchObject({ code: 11000 });
        }
      } finally {
        await db.dropDatabase();
      }
    }, 30_000);
  },
);
