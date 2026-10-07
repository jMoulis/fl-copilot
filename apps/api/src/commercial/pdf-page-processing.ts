import { createHash, randomUUID } from "node:crypto";
import { get } from "@vercel/blob";
import type { DatabaseService } from "../database/types.js";
import {
  CommercialPdfError,
  COMMERCIAL_PDF_PARSER_VERSION,
  pdfJsTextAdapter,
  type CommercialPdfTextAdapter,
} from "./pdf-text-adapter.js";
import {
  commercialPdfPageSchema,
  type CommercialPdfPage,
} from "@fl-copilot/domain";

type PdfJob = {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  objectKey: string;
  pipelineVersion: string;
  status: string;
  stage: string;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | null;
  nextAttemptAt?: Date | null;
  attemptCount: number;
  pageCount?: number;
  textPageCount?: number;
  errorCode?: string | null;
  updatedAt?: Date;
};
type Source = {
  _id: string;
  storeId: string;
  sourceType: string;
  checksum: string;
  objectKey: string;
  remoteUploadStatus: string;
};
type PageRecord = CommercialPdfPage & {
  _id: string;
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  parserVersion: string;
  createdAt: Date;
};
export interface PdfSourceStorage {
  read(pathname: string): Promise<Uint8Array | null>;
}
const privatePdfStorage: PdfSourceStorage = {
  async read(pathname) {
    const blob = await get(pathname, { access: "private" });
    if (!blob || blob.statusCode !== 200) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of blob.stream) {
      size += chunk.byteLength;
      if (size > 100 * 1024 * 1024)
        throw new CommercialPdfError("PDF_SIZE_LIMIT");
      chunks.push(chunk);
    }
    return new Uint8Array(Buffer.concat(chunks));
  },
};
export function createCommercialPdfPageProcessor(
  database: DatabaseService,
  adapter: CommercialPdfTextAdapter = pdfJsTextAdapter,
  storage: PdfSourceStorage = privatePdfStorage,
  now: () => Date = () => new Date(),
) {
  return {
    async pending() {
      const db = await database.getDb();
      const timestamp = now();
      return db
        .collection<PdfJob>("commercialDocumentJobs")
        .find({
          pipelineVersion: "commercial-pdf.v1",
          stage: "TEXT_EXTRACTION",
          $or: [
            {
              status: "PENDING",
              $or: [
                { nextAttemptAt: { $exists: false } },
                { nextAttemptAt: null },
                { nextAttemptAt: { $lte: timestamp } },
              ],
            },
            { status: "PROCESSING", leaseExpiresAt: { $lte: timestamp } },
          ],
        })
        .sort({ createdAt: 1 })
        .limit(5)
        .project<{ storeId: string; sourceDocumentId: string }>({
          _id: 0,
          storeId: 1,
          sourceDocumentId: 1,
        })
        .toArray();
    },
    async process(storeId: string, sourceDocumentId: string) {
      const db = await database.getDb();
      const timestamp = now();
      const leaseToken = randomUUID();
      const jobs = db.collection<PdfJob>("commercialDocumentJobs");
      const job = await jobs.findOneAndUpdate(
        {
          _id: sourceDocumentId,
          storeId,
          pipelineVersion: "commercial-pdf.v1",
          stage: "TEXT_EXTRACTION",
          $or: [
            {
              status: "PENDING",
              $or: [
                { nextAttemptAt: { $exists: false } },
                { nextAttemptAt: null },
                { nextAttemptAt: { $lte: timestamp } },
              ],
            },
            { status: "PROCESSING", leaseExpiresAt: { $lte: timestamp } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            leaseToken,
            leaseExpiresAt: new Date(timestamp.getTime() + 5 * 60_000),
            updatedAt: timestamp,
          },
          $inc: { attemptCount: 1 },
        },
        { returnDocument: "after" },
      );
      if (!job) return { status: "SKIPPED" };
      try {
        const source = await db.collection<Source>("sourceDocuments").findOne({
          _id: sourceDocumentId,
          storeId,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
        });
        if (
          !source ||
          source.objectKey !== job.objectKey ||
          source.checksum !== job.checksum
        )
          throw new CommercialPdfError("PDF_SOURCE_IDENTITY_INVALID");
        const bytes = await storage.read(source.objectKey);
        if (!bytes) throw new CommercialPdfError("PDF_SOURCE_MISSING");
        if (
          `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
          source.checksum
        )
          throw new CommercialPdfError("PDF_SOURCE_CHECKSUM_MISMATCH");
        const output = await adapter.parse(bytes);
        const validated = commercialPdfPageSchema
          .array()
          .min(1)
          .max(100)
          .safeParse(output);
        if (
          !validated.success ||
          validated.data.some((page, index) => page.pageNumber !== index + 1)
        )
          throw new CommercialPdfError("PDF_OUTPUT_INVALID");
        const pages = validated.data;
        for (const page of pages)
          await db.collection<PageRecord>("commercialDocumentPages").updateOne(
            {
              storeId,
              sourceDocumentId,
              parserVersion: COMMERCIAL_PDF_PARSER_VERSION,
              pageNumber: page.pageNumber,
            },
            {
              $setOnInsert: {
                ...page,
                _id: randomUUID(),
                storeId,
                sourceDocumentId,
                checksum: source.checksum,
                parserVersion: COMMERCIAL_PDF_PARSER_VERSION,
                createdAt: now(),
              },
            },
            { upsert: true },
          );
        const result = await jobs.updateOne(
          { _id: sourceDocumentId, storeId, leaseToken },
          {
            $set: {
              status: "TEXT_READY",
              stage: "AI_EXTRACTION",
              parserVersion: COMMERCIAL_PDF_PARSER_VERSION,
              pageCount: pages.length,
              textPageCount: pages.filter((page) => page.text.length > 0)
                .length,
              leaseToken: null,
              leaseExpiresAt: null,
              nextAttemptAt: null,
              errorCode: null,
              updatedAt: now(),
            },
          },
        );
        return {
          status: result.modifiedCount ? "TEXT_READY" : "LEASE_LOST",
          pageCount: pages.length,
        };
      } catch (error) {
        const permanent = error instanceof CommercialPdfError;
        await jobs.updateOne(
          { _id: sourceDocumentId, storeId, leaseToken },
          {
            $set: {
              status: permanent ? "FAILED" : "PENDING",
              errorCode: permanent
                ? error.code
                : "PDF_PROCESSING_TEMPORARILY_UNAVAILABLE",
              leaseToken: null,
              leaseExpiresAt: null,
              nextAttemptAt: permanent
                ? null
                : new Date(
                    now().getTime() +
                      Math.min(
                        5 * 60_000,
                        5000 * 2 ** Math.min(job.attemptCount, 6),
                      ),
                  ),
              updatedAt: now(),
            },
          },
        );
        if (!permanent)
          throw new Error("PDF_PROCESSING_TEMPORARILY_UNAVAILABLE");
        return { status: "FAILED", errorCode: error.code };
      }
    },
  };
}
