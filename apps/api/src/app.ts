import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  healthResponseSchema,
  type ApiErrorDto,
} from "@fl-copilot/sync-contracts";
import type { ApiConfig } from "./config.js";
import type { DatabaseService } from "./database/types.js";

type AppDependencies = {
  database: DatabaseService;
};

export function buildApp(config: ApiConfig, dependencies: AppDependencies) {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            // Do not log request URLs, headers, body, query strings or source documents.
            serializers: {
              req: (req: { method: string }) => ({ method: req.method }),
            },
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
            ],
          },
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onClose", async () => {
    await dependencies.database.close();
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      messageFr: "Cette ressource est introuvable.",
      retryable: false,
      requestId: request.id,
    } satisfies ApiErrorDto),
  );
  app.setErrorHandler((error, request, reply) => {
    const candidate = error as { validation?: unknown; statusCode?: number };
    const status = candidate.validation
      ? 400
      : candidate.statusCode &&
          candidate.statusCode >= 400 &&
          candidate.statusCode < 500
        ? candidate.statusCode
        : 500;
    const codes: Record<number, [string, string]> = {
      400: ["VALIDATION_ERROR", "Les données transmises sont invalides."],
      401: ["AUTH_REQUIRED", "Veuillez vous connecter."],
      403: ["NOT_AUTHORIZED", "Vous ne pouvez pas accéder à cette ressource."],
      404: ["NOT_FOUND", "Cette ressource est introuvable."],
      413: [
        "PAYLOAD_TOO_LARGE",
        "Les données transmises sont trop volumineuses.",
      ],
      415: [
        "UNSUPPORTED_MEDIA_TYPE",
        "Ce format de données n’est pas accepté.",
      ],
      429: ["RATE_LIMITED", "Veuillez réessayer dans quelques instants."],
    };
    const [code, messageFr] =
      codes[status] ??
      (status >= 500
        ? ["INTERNAL_ERROR", "Une erreur est survenue. Veuillez réessayer."]
        : ["REQUEST_REJECTED", "Cette requête ne peut pas être traitée."]);
    if (status >= 500)
      request.log.error({ code, requestId: request.id }, "Request failed");
    return reply.code(status).send({
      code,
      messageFr,
      retryable: status >= 500 || status === 429,
      requestId: request.id,
    } satisfies ApiErrorDto);
  });
  // Intentionally public and store-independent; never expose business data here.
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const databaseStatus = await dependencies.database.checkHealth();
      const response = {
        status:
          databaseStatus === "connected"
            ? ("ok" as const)
            : ("degraded" as const),
        service: "fl-copilot-api" as const,
        database: { status: databaseStatus },
      };
      return databaseStatus === "connected"
        ? reply.code(200).send(response)
        : reply.code(503).send(response);
    },
  );
  return app;
}
