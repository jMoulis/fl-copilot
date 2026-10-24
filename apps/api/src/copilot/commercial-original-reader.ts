import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import {
  copilotOriginalPdfInputSchema,
  copilotOriginalPdfSnapshotSchema,
  MAX_COPILOT_PDF_BYTES,
  MAX_COPILOT_PDF_PAGES,
  type CopilotOriginalPdfRead,
} from "@fl-copilot/domain";
import {
  privatePdfStorage,
  type PdfSourceStorage,
} from "../commercial/pdf-page-processing";
import {
  pdfJsTextAdapter,
  type CommercialPdfTextAdapter,
} from "../commercial/pdf-text-adapter";

const sourceSchema = z.object({
  _id: z.uuid(),
  storeId: z.uuid(),
  sourceType: z.literal("WEEKLY_COMMERCIAL_PDF"),
  originalFilename: z.string().min(1).max(240),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(MAX_COPILOT_PDF_BYTES),
  mimeType: z.literal("application/pdf"),
  objectKey: z.string().min(1),
  createdAt: z.date(),
});
/** Same store authorization and registered private original as the original-file service.
 * No job, visual extraction, offer validation or current-week prerequisite. */
export async function readCommercialOriginal(
  db: Db,
  storeId: string,
  raw: unknown,
  signal: AbortSignal,
  storage: PdfSourceStorage = privatePdfStorage,
  adapter: CommercialPdfTextAdapter = pdfJsTextAdapter,
): Promise<CopilotOriginalPdfRead> {
  z.uuid().parse(storeId);
  const input = copilotOriginalPdfInputSchema.parse(raw);
  const lookup = async () => {
    signal.throwIfAborted();
    const row = await db
      .collection<Document & { _id: string }>("sourceDocuments")
      .findOne(
        {
          _id: input.sourceDocumentId,
          storeId,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      );
    signal.throwIfAborted();
    if (!row) throw Error("COMMERCIAL_ORIGINAL_UNAVAILABLE");
    const source = sourceSchema.parse(row);
    if (source._id !== input.sourceDocumentId || source.storeId !== storeId)
      throw Error("COMMERCIAL_ORIGINAL_SCOPE_INVALID");
    return source;
  };
  const source = await lookup();
  const pdf = await storage.read(source.objectKey, {
    maximumBytes: source.sizeBytes,
    signal,
  });
  signal.throwIfAborted();
  if (!pdf) throw Error("COMMERCIAL_ORIGINAL_UNAVAILABLE");
  if (
    pdf.length !== source.sizeBytes ||
    `sha256:${createHash("sha256").update(pdf).digest("hex")}` !==
      source.checksum
  )
    throw Error("COMMERCIAL_ORIGINAL_INVALID");
  // Container validation/page count is local and read-only, not commercial pre-extraction.
  const pages = await adapter.parse(pdf);
  if (!pages.length || pages.length > MAX_COPILOT_PDF_PAGES)
    throw Error("COMMERCIAL_ORIGINAL_PAGE_LIMIT");
  const current = await lookup();
  if (JSON.stringify(current) !== JSON.stringify(source))
    throw Error("COMMERCIAL_ORIGINAL_CHANGED");
  return {
    pdf,
    snapshot: copilotOriginalPdfSnapshotSchema.parse({
      status: "AVAILABLE",
      source: {
        sourceDocumentId: source._id,
        filename: source.originalFilename,
        checksum: source.checksum,
        sizeBytes: source.sizeBytes,
        pageCount: pages.length,
        registeredAt: source.createdAt.toISOString(),
      },
      evidence: [
        {
          id: `pdf-original/${source.checksum.slice(7)}/${source._id}`,
          sourceType: "SOURCE_DOCUMENT",
          sourceId: source._id,
          sourceVersion: null,
          label: "PDF original consulté",
          value: source.originalFilename,
          detail:
            "Original disponible pour lecture directe par le copilote. Aucune extraction, validation commerciale, offre retenue ou réalisation n’est attestée par cet accès.",
          factKind: "QUALITY",
        },
      ],
    }),
  };
}
