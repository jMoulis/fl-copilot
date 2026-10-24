import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import {
  transcriptionReviewInputSchema,
  transcriptionReviewSourceSchema,
  validateTranscriptionReviewPreview,
} from "@fl-copilot/domain";
/** The server cannot know this device's rejected captures. Prepare a local review, not a resolution. */
export async function previewTranscriptionReview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = transcriptionReviewInputSchema.parse(raw);
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
      {
        maxTimeMS: 2000,
        projection: { _id: 1, storeId: 1, checksum: 1, originalFilename: 1 },
      },
    );
  const source = row
    ? transcriptionReviewSourceSchema.parse({
        storeId: row.storeId,
        sourceDocumentId: row._id,
        checksum: row.checksum,
        filename: row.originalFilename,
      })
    : null;
  const status = source ? "REVIEW_LOCAL" : "UNAVAILABLE";
  return validateTranscriptionReviewPreview(storeId, {
    input,
    source,
    status,
    evidence: [
      {
        id: `transcription-review/${createHash("sha256")
          .update(JSON.stringify([input, source, status]))
          .digest("hex")}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.sourceDocumentId,
        sourceVersion: null,
        label: source?.filename ?? "Document commercial",
        factKind: "QUALITY",
        value: source
          ? "Comparaison locale à ouvrir, aucune résolution effectuée. L’appareil vérifie les choix en conflit et la première transcription acceptée ; aucun nombre de conflits ni décision n’est déduit de cette lecture serveur."
          : "Document commercial confirmé indisponible dans ce magasin. Aucune comparaison préparée ; ce n’est pas la preuve d’une absence de conflit.",
      },
    ],
  });
}
