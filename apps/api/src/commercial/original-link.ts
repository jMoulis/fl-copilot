import type { DatabaseService } from "../database/types.js";
import { AuthError } from "../auth/service.js";
import { signPrivateOriginal } from "../uploads/private-original-link.js";
import { sourceOriginalDownloadSchema } from "@fl-copilot/sync-contracts";
export function createCommercialOriginalLinkService(
  database: DatabaseService,
  sign = signPrivateOriginal,
  now: () => Date = () => new Date(),
) {
  return {
    async link(storeId: string, sourceDocumentId: string) {
      const sources = (await database.getDb()).collection<{
        _id: string;
        objectKey: string;
        originalFilename: string;
      }>("sourceDocuments");
      const query = {
        _id: sourceDocumentId,
        storeId,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      };
      const unavailable = () =>
        new AuthError(
          404,
          "COMMERCIAL_SOURCE_NOT_FOUND",
          "Le PDF original n’est pas disponible pour ce magasin.",
        );
      const source = await sources.findOne(query);
      if (!source) throw unavailable();
      const expiry = now().getTime() + 120000;
      const url = sourceOriginalDownloadSchema.shape.url.parse(
        await sign(source.objectKey, expiry),
      );
      const current = await sources.findOne(query);
      if (
        !current ||
        current.objectKey !== source.objectKey ||
        current.originalFilename !== source.originalFilename ||
        now().getTime() >= expiry
      )
        throw unavailable();
      return {
        sourceDocumentId,
        url,
        expiresAt: new Date(expiry).toISOString(),
        filename: source.originalFilename ?? "document-commercial.pdf",
      };
    },
  };
}
