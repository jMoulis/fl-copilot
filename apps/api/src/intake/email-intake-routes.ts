import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  emailIntakeStatusSchema,
  emailIntakeDecisionPageQuerySchema,
  emailIntakeDecisionPageSchema,
  emailIntakeRevocationSchema,
  emailIntakeBindingRequestSchema,
  emailIntakeBindingSchema,
  emailIntakeListSchema,
  emailIntakeOriginalManifestSchema,
  emailIntakeOriginalDownloadSchema,
} from "@fl-copilot/sync-contracts";
import { AuthError, type AuthService } from "../auth/service.js";
import type { EmailIntakeStore } from "./email-intake-store.js";
import type { EmailOriginalAccess } from "./email-original-access.js";
export function registerEmailIntakeRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: AuthService;
    store?: EmailIntakeStore;
    originals: EmailOriginalAccess;
    history?: import("./email-decision-history").EmailDecisionHistory;
  },
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  async function authorize(request: FastifyRequest) {
    const token = request.headers.authorization,
      storeId = request.headers["x-store-id"];
    if (!token?.startsWith("Bearer "))
      throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
    if (typeof storeId !== "string" || !z.uuid().safeParse(storeId).success)
      throw new AuthError(
        400,
        "STORE_CONTEXT_REQUIRED",
        "Le magasin doit être indiqué.",
      );
    const principal = await dependencies.auth.authorizeStore(
      token.slice(7),
      storeId,
    );
    if (principal.role !== "MANAGER")
      throw new AuthError(
        403,
        "EMAIL_INTAKE_FORBIDDEN",
        "Votre rôle ne permet pas de configurer ou de traiter cette réception.",
      );
    return principal;
  }
  const configured = () => {
    if (!dependencies.store)
      throw new AuthError(
        503,
        "EMAIL_INTAKE_NOT_CONFIGURED",
        "La réception par email n’est pas encore configurée.",
      );
    return dependencies.store;
  };
  api.get(
    "/api/v1/intake/email/decisions",
    {
      schema: {
        querystring: emailIntakeDecisionPageQuerySchema,
        response: { 200: emailIntakeDecisionPageSchema },
      },
    },
    async (request, reply) => {
      const principal = await authorize(request);
      if (!dependencies.history)
        throw new AuthError(
          503,
          "EMAIL_INTAKE_HISTORY_UNAVAILABLE",
          "La restauration des confirmations est momentanément indisponible.",
        );
      reply.header("cache-control", "private, no-store");
      return dependencies.history.page(
        principal.storeId,
        principal.userId,
        request.query.cursor,
      );
    },
  );
  api.get(
    "/api/v1/intake/email/status",
    { schema: { response: { 200: emailIntakeStatusSchema } } },
    async (request, reply) => {
      await authorize(request);
      reply.header("cache-control", "private, no-store");
      return { enabled: !!dependencies.store };
    },
  );
  api.post(
    "/api/v1/intake/email/bindings",
    {
      schema: {
        body: emailIntakeBindingRequestSchema,
        response: { 200: emailIntakeBindingSchema },
      },
    },
    async (request, reply) => {
      const principal = await authorize(request),
        store = configured();
      const result = await store.createBinding(
        { storeId: principal.storeId, ownerId: principal.userId },
        request.body,
      );
      const current = await authorize(request);
      if (
        current.userId !== principal.userId ||
        current.storeId !== principal.storeId
      )
        throw new AuthError(
          403,
          "EMAIL_INTAKE_FORBIDDEN",
          "L’accès au magasin a changé.",
        );
      reply.header("cache-control", "private, no-store");
      return result;
    },
  );
  api.get(
    "/api/v1/intake/email/conversations/:id",
    {
      schema: {
        params: z.strictObject({ id: z.uuid() }),
        querystring: z.strictObject({
          cursor: z.string().min(1).max(1024).optional(),
        }),
        response: { 200: emailIntakeListSchema },
      },
    },
    async (request, reply) => {
      const principal = await authorize(request),
        store = configured();
      const result = await store.list(
        {
          storeId: principal.storeId,
          ownerId: principal.userId,
          conversationId: request.params.id,
        },
        request.query.cursor,
      );
      const current = await authorize(request);
      if (
        current.userId !== principal.userId ||
        current.storeId !== principal.storeId
      )
        throw new AuthError(
          403,
          "EMAIL_INTAKE_FORBIDDEN",
          "L’accès au magasin a changé.",
        );
      reply.header("cache-control", "private, no-store");
      return result;
    },
  );
  api.delete(
    "/api/v1/intake/email/bindings/:id",
    {
      schema: {
        params: z.strictObject({ id: z.uuid() }),
        querystring: z.strictObject({ conversationId: z.uuid() }),
        response: { 200: emailIntakeRevocationSchema },
      },
    },
    async (request, reply) => {
      const principal = await authorize(request);
      await configured().revokeBinding(
        {
          storeId: principal.storeId,
          ownerId: principal.userId,
          conversationId: request.query.conversationId,
        },
        request.params.id,
      );
      reply.header("cache-control", "private, no-store");
      return { revoked: true as const };
    },
  );
  for (const operation of ["manifest", "download"] as const)
    api.get(
      `/api/v1/intake/email/:receiptId/files/:fileId/original-${operation}`,
      {
        schema: {
          params: z.strictObject({ receiptId: z.uuid(), fileId: z.uuid() }),
          querystring: z.strictObject({ conversationId: z.uuid() }),
          response: {
            200:
              operation === "manifest"
                ? emailIntakeOriginalManifestSchema
                : emailIntakeOriginalDownloadSchema,
          },
        },
      },
      async (request, reply) => {
        const principal = await authorize(request);
        configured();
        const check = async () => {
          const current = await authorize(request);
          if (
            current.userId !== principal.userId ||
            current.storeId !== principal.storeId
          )
            throw new AuthError(
              403,
              "EMAIL_INTAKE_FORBIDDEN",
              "L’accès au magasin a changé.",
            );
        };
        reply.header("cache-control", "private, no-store");
        return dependencies.originals[operation](
          {
            storeId: principal.storeId,
            ownerId: principal.userId,
            conversationId: request.query.conversationId,
            receiptId: request.params.receiptId,
            fileId: request.params.fileId,
          },
          check,
        );
      },
    );
}
