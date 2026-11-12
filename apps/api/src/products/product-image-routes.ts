import type {
  FastifyInstance,
  FastifyBaseLogger,
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  productImageOptionsSchema,
  productImageRequestSchema,
  productImageResultSchema,
} from "@fl-copilot/sync-contracts";
import { AuthError, type AuthService } from "../auth/service";
import type { ProductImageService } from "./product-image-service";
type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  ZodTypeProvider
>;
export function registerProductImageRoutes(
  app: App,
  auth: AuthService,
  images: ProductImageService,
) {
  async function authorize(headers: {
    authorization?: string;
    "x-store-id"?: string | string[];
  }) {
    if (!headers.authorization?.startsWith("Bearer "))
      throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
    if (typeof headers["x-store-id"] !== "string")
      throw new AuthError(
        400,
        "STORE_CONTEXT_REQUIRED",
        "Le magasin doit être indiqué.",
      );
    const scope = await auth.authorizeStore(
      headers.authorization.slice(7),
      headers["x-store-id"],
    );
    if (scope.role !== "MANAGER")
      throw new AuthError(
        403,
        "VISUAL_ACCESS_INVALID",
        "Seul le responsable peut générer une image.",
      );
    return scope;
  }
  app.get(
    "/api/v1/product-images/options/:productId",
    {
      schema: {
        params: z.strictObject({ productId: z.uuid() }),
        response: { 200: productImageOptionsSchema },
      },
    },
    async (req, reply) => {
      const value = await images.options(
        await authorize(req.headers),
        req.params.productId,
      );
      await authorize(req.headers);
      reply.header("cache-control", "private, no-store");
      return value;
    },
  );
  app.post(
    "/api/v1/product-images/generate",
    {
      schema: {
        body: productImageRequestSchema,
        response: { 200: productImageResultSchema },
      },
    },
    async (req, reply) => {
      const value = await images.generate(
        await authorize(req.headers),
        req.body,
      );
      await authorize(req.headers);
      reply.header("cache-control", "private, no-store");
      return value;
    },
  );
  app.get(
    "/api/v1/product-images/:requestId",
    {
      schema: {
        params: z.strictObject({ requestId: z.uuid() }),
        response: { 200: productImageResultSchema },
      },
    },
    async (req, reply) => {
      const value = await images.status(
        await authorize(req.headers),
        req.params.requestId,
      );
      await authorize(req.headers);
      reply.header("cache-control", "private, no-store");
      return value;
    },
  );
  app.get(
    "/api/v1/product-images/:requestId/file",
    { schema: { params: z.strictObject({ requestId: z.uuid() }) } },
    async (req, reply) => {
      const bytes = await images.file(
        await authorize(req.headers),
        req.params.requestId,
      );
      await authorize(req.headers);
      reply.header("cache-control", "private, no-store");
      reply.type("image/png");
      return reply.send(Buffer.from(bytes));
    },
  );
}
