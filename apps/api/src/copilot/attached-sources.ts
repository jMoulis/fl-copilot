import { z } from "zod";
import type { Db, Document } from "mongodb";
import {
  copilotMessageSchema,
  copilotAttachedSourcesSchema,
  sourceTypeSchema,
} from "@fl-copilot/domain";
const sourceMetadataSchema = z.object({
  _id: z.string().uuid(),
  storeId: z.string().uuid(),
  sourceType: sourceTypeSchema,
  originalFilename: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120),
  createdAt: z.date(),
  remoteUploadStatus: z.enum(["PENDING", "CONFIRMED", "INVALID"]),
});
/** Revalidate source ownership/availability at the turn, independently of captured filenames. */
export async function readAttachedSources(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.string().uuid().parse(storeId);
  const references = copilotMessageSchema.shape.attachments.parse(raw);
  if (!references.length) return [];
  const rows = await db
    .collection<Document & { _id: string }>("sourceDocuments")
    .find(
      {
        storeId,
        deletedAt: null,
        _id: { $in: references.map((reference) => reference.sourceDocumentId) },
      },
      {
        projection: {
          _id: 1,
          storeId: 1,
          sourceType: 1,
          originalFilename: 1,
          mimeType: 1,
          createdAt: 1,
          remoteUploadStatus: 1,
        },
      },
    )
    .maxTimeMS(2000)
    .limit(10)
    .toArray();
  const owned = new Map<string, z.infer<typeof sourceMetadataSchema>>();
  for (const row of rows) {
    const parsed = sourceMetadataSchema.safeParse(row);
    if (!parsed.success) continue;
    const source = parsed.data;
    if (
      source.storeId !== storeId ||
      !references.some((reference) => reference.sourceDocumentId === source._id)
    )
      throw Error("COPILOT_ATTACHMENT_SCOPE_INVALID");
    owned.set(source._id, source);
  }
  return copilotAttachedSourcesSchema.parse(
    references.map((reference) => {
      const source = owned.get(reference.sourceDocumentId);
      if (!source || source.remoteUploadStatus === "INVALID")
        return {
          sourceDocumentId: reference.sourceDocumentId,
          status: "UNAVAILABLE",
          sourceType: null,
          filename: null,
          mediaType: null,
          registeredAt: null,
        };
      return {
        sourceDocumentId: source._id,
        status:
          source.remoteUploadStatus === "CONFIRMED"
            ? "CONFIRMED"
            : "PENDING_UPLOAD",
        sourceType: source.sourceType,
        filename: source.originalFilename,
        mediaType: source.mimeType,
        registeredAt: source.createdAt.toISOString(),
      };
    }),
  );
}
