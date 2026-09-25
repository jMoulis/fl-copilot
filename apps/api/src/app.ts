import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  authChallengeRequestSchema,
  authChallengeResponseSchema,
  authSessionResponseSchema,
  authVerificationRequestSchema,
  healthResponseSchema,
  logoutResponseSchema,
  refreshSessionRequestSchema,
  type ApiErrorDto,
} from "@fl-copilot/sync-contracts";
import type { ApiConfig } from "./config.js";
import {
  AuthError,
  createMongoAuthService,
  type AuthCodeSender,
  type AuthService,
} from "./auth/service.js";
import type { DatabaseService } from "./database/types.js";

type AppDependencies = {
  database: DatabaseService;
  auth?: AuthService;
  sendAuthCode?: AuthCodeSender;
};

export function buildApp(config: ApiConfig, dependencies: AppDependencies) {
  const auth =
    dependencies.auth ??
    createMongoAuthService(
      dependencies.database,
      config,
      dependencies.sendAuthCode,
    );
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
    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({
        code: error.publicCode,
        messageFr: error.messageFr,
        retryable: error.retryable,
        requestId: request.id,
      } satisfies ApiErrorDto);
    }
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
  app.post(
    "/api/v1/auth/challenges",
    {
      schema: {
        body: authChallengeRequestSchema,
        response: { 201: authChallengeResponseSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await auth.requestChallenge(request.body)),
  );
  app.post(
    "/api/v1/auth/challenges/:challengeId/verify",
    {
      schema: {
        params: z.object({ challengeId: z.string().uuid() }),
        body: authVerificationRequestSchema,
        response: { 200: authSessionResponseSchema },
      },
    },
    async (request) =>
      auth.verifyChallenge(request.params.challengeId, request.body.code),
  );
  app.post(
    "/api/v1/auth/refresh",
    {
      schema: {
        body: refreshSessionRequestSchema,
        response: { 200: authSessionResponseSchema },
      },
    },
    async (request) =>
      auth.refreshSession(request.body.deviceId, request.body.refreshToken),
  );
  app.post(
    "/api/v1/auth/logout",
    { schema: { response: { 200: logoutResponseSchema } } },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      await auth.logout(authorization.slice("Bearer ".length));
      return { revoked: true as const };
    },
  );
  return app;
}
