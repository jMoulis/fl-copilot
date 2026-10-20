import type {
  FastifyInstance,
  FastifyBaseLogger,
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  initVisualFileRequestSchema,
  initVisualFileResponseSchema,
  completeVisualFileRequestSchema,
  visualFileManifestSchema,
} from "@fl-copilot/sync-contracts";
import { AuthError, type AuthService } from "../auth/service";
import type { VisualFileService } from "./visual-file-service";
type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  ZodTypeProvider
>;
export function registerVisualFileRoutes(
  app: App,
  auth: AuthService,
  files: VisualFileService,
) {
  async function authorize(request: FastifyRequest, write = false) {
    const authorization = request.headers.authorization,
      storeId = request.headers["x-store-id"];
    if (!authorization?.startsWith("Bearer ") || !authorization.slice(7).trim())
      throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
    if (typeof storeId !== "string")
      throw new AuthError(
        400,
        "STORE_CONTEXT_REQUIRED",
        "Le magasin doit être indiqué.",
      );
    const principal = await auth.authorizeStore(
      authorization.slice(7),
      storeId,
    );
    if (write && principal.role !== "MANAGER")
      throw new AuthError(
        403,
        "VISUAL_ACCESS_INVALID",
        "Seul le responsable peut envoyer une image produit.",
      );
    return principal;
  }
  app.post(
    "/api/v1/visual-files/init",
    {
      schema: {
        body: initVisualFileRequestSchema,
        response: { 200: initVisualFileResponseSchema },
      },
    },
    async (request) =>
      files.init(await authorize(request, true), request.body.assetId),
  );
  app.post(
    "/api/v1/visual-files/complete",
    {
      schema: {
        body: completeVisualFileRequestSchema,
        response: { 200: visualFileManifestSchema },
      },
    },
    async (request) =>
      files.complete(
        await authorize(request, true),
        request.body.assetId,
        request.body.uploadId,
      ),
  );
  app.get(
    "/api/v1/visual-assets/:assetId/file-manifest",
    {
      schema: {
        params: z.strictObject({ assetId: z.uuid() }),
        response: { 200: visualFileManifestSchema },
      },
    },
    async (request) =>
      files.manifest(await authorize(request), request.params.assetId),
  );
  app.get(
    "/api/v1/visual-assets/:assetId/:variant",
    {
      schema: {
        params: z.strictObject({
          assetId: z.uuid(),
          variant: z.enum(["source", "preview"]),
        }),
      },
    },
    async (request, reply) => {
      const result = await files.read(
        await authorize(request),
        request.params.assetId,
        request.params.variant,
      );
      return reply
        .type(result.mimeType)
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-length", result.bytes.byteLength)
        .header("etag", `"${result.contentHash.slice(7)}"`)
        .send(Buffer.from(result.bytes));
    },
  );
}
