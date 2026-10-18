import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  receiptPublicationInputSchema,
  receiptPublicationSourceSchema,
  receiptPublicationPreviewSchema,
  COPILOT_RECEIPT_REVIEW_LINE_LIMIT,
} from "@fl-copilot/domain";
import { readWasteReceipt } from "./waste-receipt-tool.js";
import type { WasteReceiptDraftReader } from "../uploads/waste-receipt-draft.js";
/** Owned immutable receipt metadata, without extraction or provider work. */
export async function readReceiptSource(
  db: Db,
  storeId: string,
  sourceDocumentId: string,
) {
  z.uuid().parse(storeId);
  z.uuid().parse(sourceDocumentId);
  const row = await db
    .collection<{
      _id: string;
      storeId: string;
      checksum: string;
      originalFilename: string;
    }>("sourceDocuments")
    .findOne(
      {
        _id: sourceDocumentId,
        storeId,
        sourceType: "WASTE_RECEIPT",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      } as never,
      { maxTimeMS: 2000 },
    );
  if (!row) throw Error("RECEIPT_PUBLICATION_UNAVAILABLE");
  const source = receiptPublicationSourceSchema.parse({
    storeId: row.storeId,
    sourceDocumentId: row._id,
    checksum: row.checksum,
    filename: row.originalFilename,
  });
  if (
    source.storeId !== storeId ||
    source.sourceDocumentId !== sourceDocumentId
  )
    throw Error("READ_SCOPE_INVALID");
  return source;
}

export async function previewReceiptPublication(
  db: Db,
  storeId: string,
  raw: unknown,
  reader: WasteReceiptDraftReader,
) {
  z.uuid().parse(storeId);
  const input = receiptPublicationInputSchema.parse(raw);
  const source = await readReceiptSource(db, storeId, input.sourceDocumentId);
  const reading = await readWasteReceipt(
    db,
    storeId,
    { ...input, offset: 0, limit: 10 },
    reader,
  );
  const status =
    reading.status === "PUBLISHED"
      ? "ALREADY_PUBLISHED"
      : reading.status === "LIMIT_EXCEEDED" ||
          (reading.lineCount ?? 0) > COPILOT_RECEIPT_REVIEW_LINE_LIMIT
        ? "LIMIT_EXCEEDED"
        : reading.status === "EXTRACTED" && (reading.lineCount ?? 0) > 0
          ? "REVIEW_LOCAL"
          : "NOT_READY";
  const digest = createHash("sha256")
    .update(JSON.stringify([input, source, status]))
    .digest("hex");
  return receiptPublicationPreviewSchema.parse({
    input,
    source,
    status,
    evidence: [
      {
        id: `receipt-publication/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: source.sourceDocumentId,
        sourceVersion: reading.published?.receipt.version ?? null,
        label: "Publication du ticket de casse",
        value:
          status === "REVIEW_LOCAL"
            ? "Revue de publication préparée, aucune casse publiée. Le brouillon actuel, ses corrections et ses contrôles doivent être relus sur l’appareil avant confirmation explicite."
            : status === "ALREADY_PUBLISHED"
              ? "Ce ticket est déjà publié et synchronisé ; aucune nouvelle publication."
              : "Analyse indisponible, vide ou trop volumineuse pour cette carte. Aucune publication préparée.",
        factKind: "QUALITY",
      },
    ],
  });
}
