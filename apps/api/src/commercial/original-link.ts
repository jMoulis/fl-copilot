import { issueSignedToken, presignUrl } from "@vercel/blob";
import type { DatabaseService } from "../database/types.js";
import { AuthError } from "../auth/service.js";
import { getVercelOidcToken } from "../vercel-request-context.js";
export function createCommercialOriginalLinkService(
  database: DatabaseService,
  sign = async (pathname: string, validUntil: number) => {
    const token = await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil,
      oidcToken: getVercelOidcToken() ?? process.env.VERCEL_OIDC_TOKEN,
    });
    return (
      await presignUrl(token, {
        operation: "get",
        access: "private",
        pathname,
        validUntil,
        useCache: true,
      })
    ).presignedUrl;
  },
  now: () => Date = () => new Date(),
) {
  return {
    async link(storeId: string, sourceDocumentId: string) {
      const source = await (
        await database.getDb()
      )
        .collection<{
          _id: string;
          objectKey: string;
          originalFilename: string;
        }>("sourceDocuments")
        .findOne({
          _id: sourceDocumentId,
          storeId,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
        });
      if (!source)
        throw new AuthError(
          404,
          "COMMERCIAL_SOURCE_NOT_FOUND",
          "Le PDF original n’est pas disponible pour ce magasin.",
        );
      const expiry = now().getTime() + 120000;
      return {
        sourceDocumentId,
        url: await sign(source.objectKey, expiry),
        expiresAt: new Date(expiry).toISOString(),
        filename: source.originalFilename ?? "document-commercial.pdf",
      };
    },
  };
}
