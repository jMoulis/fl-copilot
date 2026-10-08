import { randomUUID, createHash } from "node:crypto";
import {
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
  commercialPdfPageSchema,
} from "@fl-copilot/domain";
import {
  anchorCommercialVisualReading,
  currentCommercialWeek,
  commercialDocumentWeekContext,
  scopeCommercialVisualReading,
} from "@fl-copilot/commercial-core";
import {
  synchronizedCommercialVisualReadingSchema,
  type SynchronizedCommercialVisualReading,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types.js";
import {
  privatePdfStorage,
  type PdfSourceStorage,
} from "./pdf-page-processing.js";
import { CommercialAiPermanentError } from "./ai-provider.js";
import {
  MAX_VISUAL_PDF_BYTES,
  MAX_VISUAL_PDF_PAGES,
  type CommercialVisualProvider,
} from "./visual-provider.js";
import { createMongoSyncChangeService } from "../sync/sync-change-service.js";
type VisualJob = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  model: string;
  checksum: string;
  parserVersion: string;
  pageCount: number;
  schemaVersion: typeof COMMERCIAL_VISUAL_SCHEMA_VERSION;
  status?: string;
  createdAt?: Date;
};
import type { VisualReadingDocument } from "./visual-reading-store.js";
export function createCommercialVisualProcessor(
  database: DatabaseService,
  provider: CommercialVisualProvider,
  storage: PdfSourceStorage = privatePdfStorage,
  now = () => new Date(),
) {
  return {
    async pending() {
      const db = await database.getDb();
      const sources = await db
        .collection<VisualJob>("commercialDocumentJobs")
        .aggregate<VisualJob>([
          {
            $match: {
              parserVersion: { $exists: true },
              pageCount: { $gte: 1 },
              status: {
                $in: ["TEXT_READY", "PROCESSING", "TO_VALIDATE", "AI_FAILED"],
              },
            },
          },
          {
            $lookup: {
              from: "commercialVisualJobs",
              localField: "_id",
              foreignField: "_id",
              as: "visualRegistration",
            },
          },
          { $match: { visualRegistration: { $size: 0 } } },
          { $sort: { updatedAt: 1 } },
          { $limit: 3 },
        ])
        .toArray();
      for (const source of sources) {
        await db.collection<VisualJob>("commercialVisualJobs").updateOne(
          { _id: source._id },
          {
            $setOnInsert: {
              _id: source._id,
              storeId: source.storeId,
              sourceDocumentId: source._id,
              model: provider.model,
              checksum: source.checksum,
              parserVersion: source.parserVersion,
              pageCount: source.pageCount,
              schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
              status: "PENDING",
              createdAt: now(),
            },
          },
          { upsert: true },
        );
      }
      const jobs = await db
        .collection<VisualJob>("commercialVisualJobs")
        .find({
          model: provider.model,
          schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
          status: { $ne: "COMPLETE" },
        })
        .sort({ createdAt: 1 })
        .limit(20)
        .toArray();
      const pending: Array<{
        storeId: string;
        sourceDocumentId: string;
        pages: number[];
      }> = [];
      for (const job of jobs) {
        const records = await db
          .collection<VisualReadingDocument>("commercialVisualReadings")
          .find({
            storeId: job.storeId,
            sourceDocumentId: job._id,
            schemaVersion: job.schemaVersion,
            model: job.model,
          })
          .toArray();
        const pages = Array.from(
          { length: job.pageCount },
          (_, i) => i + 1,
        ).filter((page) => {
          const row = records.find((r) => r.pageNumber === page);
          return (
            !row ||
            (row.status === "RETRY" &&
              (!row.nextAttemptAt || row.nextAttemptAt <= now())) ||
            (row.status === "PROCESSING" &&
              row.leaseExpiresAt &&
              row.leaseExpiresAt <= now())
          );
        });
        if (
          !pages.length &&
          records.length === job.pageCount &&
          records.every(
            (row) => row.status === "READY" || row.status === "FAILED",
          )
        )
          await db
            .collection<VisualJob>("commercialVisualJobs")
            .updateOne(
              { _id: job._id, storeId: job.storeId },
              { $set: { status: "COMPLETE" } },
            );
        if (pages.length)
          pending.push({
            storeId: job.storeId,
            sourceDocumentId: job._id,
            pages,
          });
        if (pending.length >= 3) break;
      }
      return pending;
    },
    async process(
      storeId: string,
      sourceDocumentId: string,
      pageNumber: number,
    ) {
      const db = await database.getDb();
      const job = await db
        .collection<VisualJob>("commercialVisualJobs")
        .findOne({
          _id: sourceDocumentId,
          storeId,
          model: provider.model,
          schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
        });
      if (!job || pageNumber < 1 || pageNumber > job.pageCount)
        return { status: "SKIPPED", pageNumber };
      const identity = {
        storeId,
        sourceDocumentId,
        pageNumber,
        schemaVersion: job.schemaVersion,
        model: job.model,
      };
      const records = db.collection<VisualReadingDocument>(
        "commercialVisualReadings",
      );
      const existing = await records.findOne(identity);
      if (existing?.status === "READY" || existing?.status === "FAILED")
        return { status: existing.status, pageNumber };
      try {
        await records.updateOne(
          identity,
          {
            $setOnInsert: {
              ...identity,
              _id: randomUUID(),
              id: "",
              checksum: job.checksum,
              pageCount: job.pageCount,
              remoteVersion: 1,
              status: "RETRY",
              errorCode: null,
              reading: null,
              createdAt: now(),
              updatedAt: now(),
              attemptCount: 0,
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if (
          typeof error !== "object" ||
          !error ||
          !("code" in error) ||
          error.code !== 11000
        )
          throw error;
      }
      const leaseToken = randomUUID();
      const claimed = await records.findOneAndUpdate(
        {
          ...identity,
          $or: [
            {
              status: "RETRY",
              $or: [
                { nextAttemptAt: { $exists: false } },
                { nextAttemptAt: { $lte: now() } },
              ],
            },
            { status: "PROCESSING", leaseExpiresAt: { $lte: now() } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            leaseToken,
            leaseExpiresAt: new Date(now().getTime() + 300000),
            updatedAt: now(),
          },
          $inc: { attemptCount: 1 },
        },
        { returnDocument: "after" },
      );
      if (!claimed) return { status: "IN_PROGRESS", pageNumber };
      let completed: SynchronizedCommercialVisualReading;
      try {
        if ((claimed.attemptCount ?? 0) > 4)
          throw new CommercialAiPermanentError(
            "COMMERCIAL_VISUAL_ATTEMPT_LIMIT",
          );
        if (job.pageCount > MAX_VISUAL_PDF_PAGES)
          throw new CommercialAiPermanentError("COMMERCIAL_VISUAL_PAGE_LIMIT");
        const source = await db
          .collection<{ _id: string; objectKey: string; sizeBytes: number }>(
            "sourceDocuments",
          )
          .findOne({
            _id: sourceDocumentId,
            storeId,
            checksum: job.checksum,
            remoteUploadStatus: "CONFIRMED",
            sourceType: "WEEKLY_COMMERCIAL_PDF",
          });
        if (!source)
          throw new CommercialAiPermanentError(
            "COMMERCIAL_VISUAL_SOURCE_INVALID",
          );
        if (source.sizeBytes > MAX_VISUAL_PDF_BYTES)
          throw new CommercialAiPermanentError(
            "COMMERCIAL_VISUAL_PDF_SIZE_LIMIT",
          );
        const bytes = await storage.read(source.objectKey);
        if (!bytes) throw Error("SOURCE_TEMPORARILY_UNAVAILABLE");
        if (
          `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
          job.checksum
        )
          throw new CommercialAiPermanentError(
            "COMMERCIAL_VISUAL_CHECKSUM_MISMATCH",
          );
        const rawPages = await db
          .collection("commercialDocumentPages")
          .find({
            storeId,
            sourceDocumentId,
            checksum: job.checksum,
            parserVersion: job.parserVersion,
          })
          .sort({ pageNumber: 1 })
          .toArray();
        const pages = rawPages.map((p) => commercialPdfPageSchema.parse(p));
        if (pages.length !== job.pageCount)
          throw Error("VISUAL_SOURCE_PAGES_PENDING");
        const result = await provider.extract(
          pageNumber,
          pages,
          bytes,
          job.createdAt ?? now(),
        );
        let reading;
        try {
          const anchored = anchorCommercialVisualReading(
            result.output,
            pageNumber,
            pages,
          );
          reading = scopeCommercialVisualReading(
            anchored,
            currentCommercialWeek(job.createdAt ?? now()),
            commercialDocumentWeekContext([anchored]),
          );
        } catch {
          throw new CommercialAiPermanentError(
            "COMMERCIAL_VISUAL_OUTPUT_INVALID",
          );
        }
        completed = synchronizedCommercialVisualReadingSchema.parse({
          ...claimed,
          id: claimed._id,
          status: "READY",
          reading,
          errorCode: null,
        });
        const session = db.client.startSession();
        let applied = false;
        try {
          await session.withTransaction(async () => {
            applied = false;
            const updated = await records.updateOne(
              { ...identity, leaseToken },
              {
                $set: {
                  ...completed,
                  rawOutput: result.output,
                  responseId: result.responseId,
                  usage: result.usage,
                  updatedAt: now(),
                },
                $unset: {
                  leaseToken: "",
                  leaseExpiresAt: "",
                  nextAttemptAt: "",
                },
              },
              { session },
            );
            if (!updated.modifiedCount) return;
            applied = true;
            await createMongoSyncChangeService(now).append(
              { database: db, session },
              {
                storeId,
                entityType: "commercial_visual_reading",
                entityId: claimed._id,
                entityVersion: 1,
                operation: "UPSERT",
              },
            );
          });
        } finally {
          await session.endSession();
        }
        return {
          status: applied ? "READY" : "LEASE_LOST",
          pageNumber,
          operationCount: reading.operations.length,
        };
      } catch (error) {
        const permanent =
          error instanceof CommercialAiPermanentError ||
          (claimed.attemptCount ?? 0) >= 4;
        const code =
          error instanceof CommercialAiPermanentError
            ? error.code
            : permanent
              ? "COMMERCIAL_VISUAL_ATTEMPT_LIMIT"
              : "COMMERCIAL_VISUAL_TEMPORARILY_UNAVAILABLE";
        const session = db.client.startSession();
        try {
          await session.withTransaction(async () => {
            const update = await records.updateOne(
              { ...identity, leaseToken },
              {
                $set: {
                  status: permanent ? "FAILED" : "RETRY",
                  errorCode: code,
                  id: claimed._id,
                  updatedAt: now(),
                  nextAttemptAt: new Date(
                    now().getTime() +
                      60000 * 2 ** Math.min(4, claimed.attemptCount ?? 1),
                  ),
                },
                $unset: { leaseToken: "", leaseExpiresAt: "" },
              },
              { session },
            );
            if (permanent && update.modifiedCount)
              await createMongoSyncChangeService(now).append(
                { database: db, session },
                {
                  storeId,
                  entityType: "commercial_visual_reading",
                  entityId: claimed._id,
                  entityVersion: 1,
                  operation: "UPSERT",
                },
              );
          });
        } finally {
          await session.endSession();
        }
        return {
          status: permanent ? "FAILED" : "RETRY",
          pageNumber,
          errorCode: code,
        };
      }
    },
  };
}
