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
  bootstrapQuerySchema,
  bootstrapResponseSchema,
  healthResponseSchema,
  completeSourceUploadRequestSchema,
  completeSourceUploadResponseSchema,
  initSourceUploadRequestSchema,
  initSourceUploadResponseSchema,
  importVerificationResultSchema,
  logoutResponseSchema,
  refreshSessionRequestSchema,
  SYNC_PROTOCOL_VERSION,
  syncPullQuerySchema,
  syncPullResponseSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
  verifyImportRequestSchema,
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
import {
  createMongoImportVerificationService,
  type ImportVerificationService,
} from "./imports/import-verification-service.js";
import { captureApiError, logRemoteEvent } from "./observability.js";
import {
  createMongoSyncBootstrapService,
  type SyncBootstrapService,
} from "./sync/bootstrap-service.js";
import {
  createMongoSyncPullService,
  SyncPullCursorError,
  type SyncPullService,
} from "./sync/pull-service.js";
import {
  createMongoSyncPushService,
  type SyncPushService,
} from "./sync/push-service.js";
import {
  createMongoSourceUploadService,
  type SourceUploadService,
} from "./uploads/source-upload-service.js";
import {
  createMongoWasteReceiptVisionExtractionService,
  createOpenAIReceiptVisionProvider,
} from "./uploads/waste-receipt-vision-extraction.js";
import { createMongoWasteReceiptArithmeticValidationService } from "./uploads/waste-receipt-arithmetic-validation.js";

type AppDependencies = {
  database: DatabaseService;
  auth?: AuthService;
  sendAuthCode?: AuthCodeSender;
  syncBootstrap?: SyncBootstrapService;
  syncPull?: SyncPullService;
  syncPush?: SyncPushService;
  sourceUploads?: SourceUploadService;
  importVerification?: ImportVerificationService;
};

export function buildApp(config: ApiConfig, dependencies: AppDependencies) {
  const auth =
    dependencies.auth ??
    createMongoAuthService(
      dependencies.database,
      config,
      dependencies.sendAuthCode,
    );
  const syncPush =
    dependencies.syncPush ?? createMongoSyncPushService(dependencies.database);
  const syncPull =
    dependencies.syncPull ?? createMongoSyncPullService(dependencies.database);
  const syncBootstrap =
    dependencies.syncBootstrap ??
    createMongoSyncBootstrapService(dependencies.database);
  const sourceUploads =
    dependencies.sourceUploads ??
    createMongoSourceUploadService(
      dependencies.database,
      undefined,
      undefined,
      undefined,
      createMongoWasteReceiptVisionExtractionService(
        dependencies.database,
        createOpenAIReceiptVisionProvider({
          apiKey: config.OPENAI_API_KEY,
          gatewayApiKey: config.AI_GATEWAY_API_KEY,
          vercelOidcToken: config.VERCEL_OIDC_TOKEN,
          model: config.WASTE_RECEIPT_VISION_MODEL,
        }),
      ),
      createMongoWasteReceiptArithmeticValidationService(
        dependencies.database,
        config.WASTE_RECEIPT_ARITHMETIC_TOLERANCE_EUR,
      ),
    );
  const importVerification =
    dependencies.importVerification ??
    createMongoImportVerificationService(dependencies.database);
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
    if (status >= 500) {
      request.log.error({ code, requestId: request.id }, "Request failed");
      const safeContext = {
        code,
        method: request.method,
        requestId: request.id,
      };
      logRemoteEvent("error", "API request failed", safeContext);
      captureApiError(error, safeContext);
    }
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
  app.post(
    "/api/v1/sync/push",
    {
      schema: {
        body: syncPushRequestSchema,
        response: { 200: syncPushResponseSchema },
      },
    },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const storeId = request.headers["x-store-id"];
      if (storeId !== request.body.storeId) {
        throw new AuthError(
          403,
          "STORE_CONTEXT_MISMATCH",
          "Le magasin demandé ne correspond pas à la requête.",
        );
      }
      const protocolVersion = request.headers["x-sync-protocol-version"];
      if (protocolVersion !== String(SYNC_PROTOCOL_VERSION)) {
        throw new AuthError(
          400,
          "SYNC_PROTOCOL_UNSUPPORTED",
          "Cette version du protocole de synchronisation n’est pas prise en charge.",
        );
      }
      const accessToken = authorization.slice("Bearer ".length);
      if (!accessToken) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      await auth.authorizeStore(
        accessToken,
        request.body.storeId,
        request.body.deviceId,
      );
      return syncPush.push(request.body, request.id);
    },
  );
  app.get(
    "/api/v1/sync/pull",
    {
      schema: {
        querystring: syncPullQuerySchema,
        response: { 200: syncPullResponseSchema },
      },
    },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string") {
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué pour synchroniser les données.",
        );
      }
      const protocolVersion = request.headers["x-sync-protocol-version"];
      if (protocolVersion !== String(SYNC_PROTOCOL_VERSION)) {
        throw new AuthError(
          400,
          "SYNC_PROTOCOL_UNSUPPORTED",
          "Cette version du protocole de synchronisation n’est pas prise en charge.",
        );
      }
      const accessToken = authorization.slice("Bearer ".length);
      if (!accessToken) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      await auth.authorizeStore(accessToken, storeId);
      try {
        return await syncPull.pull(storeId, request.query);
      } catch (error) {
        if (error instanceof SyncPullCursorError) {
          throw new AuthError(
            400,
            "SYNC_CURSOR_INVALID",
            "Le curseur de synchronisation est invalide.",
          );
        }
        throw error;
      }
    },
  );
  app.get(
    "/api/v1/sync/bootstrap",
    {
      schema: {
        querystring: bootstrapQuerySchema,
        response: { 200: bootstrapResponseSchema },
      },
    },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string") {
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué pour synchroniser les données.",
        );
      }
      const protocolVersion = request.headers["x-sync-protocol-version"];
      if (protocolVersion !== String(SYNC_PROTOCOL_VERSION)) {
        throw new AuthError(
          400,
          "SYNC_PROTOCOL_UNSUPPORTED",
          "Cette version du protocole de synchronisation n’est pas prise en charge.",
        );
      }
      const accessToken = authorization.slice("Bearer ".length);
      if (!accessToken) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const store = await auth.authorizeStore(accessToken, storeId);
      return syncBootstrap.bootstrap(store, request.query);
    },
  );
  app.post(
    "/api/v1/uploads/init",
    {
      schema: {
        body: initSourceUploadRequestSchema,
        response: { 200: initSourceUploadResponseSchema },
      },
    },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string") {
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué pour envoyer le fichier.",
        );
      }
      const context = await auth.authorizeStore(
        authorization.slice("Bearer ".length),
        storeId,
      );
      return sourceUploads.init(storeId, context.userId, request.body);
    },
  );
  app.post(
    "/api/v1/uploads/:uploadId/complete",
    {
      schema: {
        params: z.object({ uploadId: z.string().uuid() }),
        body: completeSourceUploadRequestSchema,
        response: { 200: completeSourceUploadResponseSchema },
      },
    },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string") {
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué pour confirmer le fichier.",
        );
      }
      await auth.authorizeStore(authorization.slice("Bearer ".length), storeId);
      return sourceUploads.complete(
        storeId,
        request.params.uploadId,
        request.body,
      );
    },
  );
  app.post(
    "/api/v1/imports/:sourceDocumentId/verify",
    {
      schema: {
        params: z.object({ sourceDocumentId: z.string().uuid() }),
        body: verifyImportRequestSchema,
        response: { 200: importVerificationResultSchema },
      },
    },
    async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      }
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string") {
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué pour vérifier l’import.",
        );
      }
      await auth.authorizeStore(authorization.slice("Bearer ".length), storeId);
      return importVerification.verify(
        storeId,
        request.params.sourceDocumentId,
        request.body,
      );
    },
  );
  if (config.SENTRY_TEST_ROUTE_ENABLED) {
    app.post("/api/v1/observability/test-error", async () => {
      throw new Error("M0-T10 API monitoring test error");
    });
  }
  return app;
}
