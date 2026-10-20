import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  layoutIllustrationQuoteStateSchema,
  layoutIllustrationGenerationRecordSchema,
} from "@fl-copilot/domain";
import { AuthError, type AuthService } from "../auth/service";
import type { LayoutIllustrationGenerationService } from "./layout-illustration-generation";
export function registerIllustrationGenerationRoutes(
  app: FastifyInstance,
  auth: AuthService,
  generation: Pick<LayoutIllustrationGenerationService, "quote" | "read">,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  async function scope(request: FastifyRequest) {
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
  api.get(
    "/api/v1/copilot/layout-illustrations/:preparationId/quote",
    {
      schema: {
        params: z.strictObject({ preparationId: z.uuid() }),
        response: { 200: layoutIllustrationQuoteStateSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return generation.quote(
        await scope(request),
        request.params.preparationId,
      );
    },
  );
  api.get(
    "/api/v1/copilot/layout-illustration-generations/:id",
    {
      schema: {
        params: z.strictObject({ id: z.uuid() }),
        response: { 200: layoutIllustrationGenerationRecordSchema },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      return generation.read(await scope(request), request.params.id);
    },
  );
}
