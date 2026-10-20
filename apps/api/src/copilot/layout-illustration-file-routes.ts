import { Readable } from "node:stream";
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
  layoutIllustrationFileStateSchema,
  layoutIllustrationFileVariantSchema,
} from "@fl-copilot/sync-contracts";
import { AuthError, type AuthService } from "../auth/service";
import type { LayoutIllustrationFiles } from "./layout-illustration-files";
type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  ZodTypeProvider
>;
export function registerLayoutIllustrationFileRoutes(
  app: App,
  auth: AuthService,
  files: LayoutIllustrationFiles,
) {
  async function authorize(request: FastifyRequest) {
    const token = request.headers.authorization,
      store = request.headers["x-store-id"];
    if (!token?.startsWith("Bearer ") || !token.slice(7).trim())
      throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
    if (typeof store !== "string")
      throw new AuthError(
        400,
        "STORE_CONTEXT_REQUIRED",
        "Le magasin doit être indiqué.",
      );
    return auth.authorizeStore(token.slice(7), store);
  }
  app.get(
    "/api/v1/copilot/layout-illustrations/:preparationId/manifest",
    {
      schema: {
        params: z.strictObject({ preparationId: z.uuid() }),
        response: { 200: layoutIllustrationFileStateSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return files.manifest(
        await authorize(request),
        request.params.preparationId,
      );
    },
  );
  app.get(
    "/api/v1/copilot/layout-illustrations/:preparationId/results/:resultId/:variant",
    {
      schema: {
        params: z.strictObject({
          preparationId: z.uuid(),
          resultId: z.uuid(),
          variant: layoutIllustrationFileVariantSchema,
        }),
      },
    },
    async (request, reply) => {
      const result = await files.read(
        await authorize(request),
        request.params.preparationId,
        request.params.resultId,
        request.params.variant,
      );
      // Stream bounded verified chunks; private PNGs may exceed buffered Function response limits.
      async function* chunks() {
        for (let i = 0; i < result.bytes.byteLength; i += 64 * 1024)
          yield Buffer.from(result.bytes.subarray(i, i + 64 * 1024));
      }
      return reply
        .type(result.mimeType)
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .header("etag", `"${result.checksum.slice(7)}"`)
        .send(Readable.from(chunks()));
    },
  );
}
