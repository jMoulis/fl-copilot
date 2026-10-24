import type { Db, Document, ClientSession } from "mongodb";
import { ZodError } from "zod";
import {
  isCommercialOriginalSource,
  type CommercialChoiceSource,
  type CommercialOriginalOfferSource,
  type CopilotOriginalPdfRead,
} from "@fl-copilot/domain";
import type { CommercialPlanContext } from "@fl-copilot/commercial-core";
import { readCommercialOriginal } from "../copilot/commercial-original-reader";
import type { PdfSourceStorage } from "./pdf-page-processing";
import { CommercialPdfError } from "./pdf-text-adapter";

export type CommercialOriginalSourceVerifier = (
  db: Db,
  storeId: string,
  source: CommercialOriginalOfferSource,
) => Promise<boolean>;
export async function readCommercialOriginalSourceStates(
  db: Db,
  storeId: string,
  sources: readonly CommercialChoiceSource[],
  session?: ClientSession,
): Promise<NonNullable<CommercialPlanContext["originalSources"]>> {
  const ids = [
    ...new Set(
      sources.flatMap((source) =>
        isCommercialOriginalSource(source) ? [source.sourceDocumentId] : [],
      ),
    ),
  ];
  if (!ids.length) return [];
  const rows = await db
    .collection<Document & { _id: string }>("sourceDocuments")
    .find(
      {
        _id: { $in: ids },
        storeId,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        mimeType: "application/pdf",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      },
      {
        session,
        projection: { _id: 1, storeId: 1, checksum: 1 },
        maxTimeMS: 2000,
      },
    )
    .toArray();
  return rows
    .filter(
      (row) =>
        ids.includes(row._id) &&
        row.storeId === storeId &&
        typeof row.checksum === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(row.checksum),
    )
    .map((row) => ({
      sourceDocumentId: row._id,
      storeId,
      checksum: row.checksum as string,
    }));
}
/** Instantiate per push, never as a cross-request authorization/cache boundary. */
export function createCommercialOriginalSourceVerifier(
  storage?: PdfSourceStorage,
): CommercialOriginalSourceVerifier {
  const verified = new Map<
    string,
    Promise<CopilotOriginalPdfRead["snapshot"]["source"]>
  >();
  return async (db, storeId, source) => {
    const row = await db
      .collection<Document & { _id: string }>("sourceDocuments")
      .findOne(
        {
          _id: source.sourceDocumentId,
          storeId,
          checksum: source.checksum,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        {
          projection: { objectKey: 1, sizeBytes: 1, mimeType: 1 },
          maxTimeMS: 2000,
        },
      );
    if (!row) return false;
    const key = JSON.stringify([
      storeId,
      source.sourceDocumentId,
      source.checksum,
      row.objectKey,
      row.sizeBytes,
      row.mimeType,
    ]);
    let pending = verified.get(key);
    if (!pending) {
      pending = readCommercialOriginal(
        db,
        storeId,
        { sourceDocumentId: source.sourceDocumentId },
        AbortSignal.timeout(15000),
        storage,
      ).then((result) => result.snapshot.source);
      verified.set(key, pending);
    }
    try {
      const actual = await pending;
      return (
        actual.checksum === source.checksum &&
        source.pageNumber <= actual.pageCount
      );
    } catch (error) {
      if (
        error instanceof ZodError ||
        error instanceof CommercialPdfError ||
        (error instanceof Error &&
          [
            "COMMERCIAL_ORIGINAL_INVALID",
            "COMMERCIAL_ORIGINAL_PAGE_LIMIT",
            "COMMERCIAL_ORIGINAL_SCOPE_INVALID",
          ].includes(error.message))
      )
        return false;
      // Keep transient file/network failures retryable. Never persist a false approval or rejection.
      throw Error("COMMERCIAL_ORIGINAL_TEMPORARILY_UNAVAILABLE");
    }
  };
}
