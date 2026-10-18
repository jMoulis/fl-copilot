import { readRecommendationDecisions } from "./copilot/decision-read-tool.js";
import { readRecommendationTracking } from "./copilot/recommendation-tracking-tool.js";
import { readActionReview } from "./copilot/action-review-tool.js";
import {
  createCommercialProcessingRecovery,
  type CommercialProcessingRecoveryService,
} from "./commercial/processing-recovery.js";
import {
  commercialProcessingReviewSchema,
  commercialProcessingResumeSchema,
  commercialProcessingRequestedSchema,
} from "@fl-copilot/sync-contracts";
import {
  storeConflictLegacyInputSchema,
  storeConflictV2InputSchema,
  storeConflictV3InputSchema,
  storeConflictV4InputSchema,
} from "@fl-copilot/domain";
import { previewStoreConflict } from "./copilot/store-conflict-tool.js";
import { previewReceiptRecovery } from "./copilot/receipt-recovery-tool.js";
import {
  importClassificationRequestSchema,
  importClassificationResultSchema,
  validateImportClassification,
} from "@fl-copilot/domain";
import { createImportClassifier } from "./copilot/import-classification-provider.js";
import { readPriceScenario } from "./copilot/price-scenario-tool.js";
import { inspectCommercialReference } from "./copilot/reference-inspection-tool.js";
import { previewCommercialReference } from "./copilot/reference-preview-tool.js";
import { readCommercialDocumentComparison } from "./copilot/document-comparison-tool.js";
import { previewCommercialPlanValidation } from "./copilot/plan-validation-tool.js";
import { readCommercialPlanReadiness } from "./copilot/plan-readiness-tool.js";
import { previewOfferValidation } from "./copilot/offer-validation-tool.js";
import { previewChoiceCreate } from "./copilot/choice-create-tool.js";
import { readSourceOffers } from "./copilot/source-offers-tool.js";
import { previewChoiceRetention } from "./copilot/choice-retention-tool.js";
import { previewChoiceReassociation } from "./copilot/choice-reassociation-tool.js";
import { previewChoiceUpdate } from "./copilot/choice-update-tool.js";
import { previewChoiceWithdrawal } from "./copilot/choice-withdrawal-tool.js";
import { readPreparationPreview } from "./copilot/preparation-preview-tool.js";
import { readCommercialPreparation } from "./copilot/commercial-preparation-tool.js";
import { readOperationsPreview } from "./copilot/operations-preview-tool.js";
import { readNeedPreview } from "./copilot/need-preview-tool.js";
import { previewReceiptCorrection } from "./copilot/receipt-correction-tool.js";
import { previewReceiptPublication } from "./copilot/receipt-publication-tool.js";
import { readIdentityReviewPreview } from "./copilot/identity-review-tool.js";
import { readCataloguePreview } from "./copilot/catalogue-preview-tool.js";
import { readCommercialExecutionPreview } from "./copilot/commercial-plan-tool.js";
import { readAnalyticsQuery } from "./copilot/analytics-query-tool.js";
import { createCopilotWebResearchJournal } from "./copilot/web-research-journal.js";
import { createCopilotWebResearch } from "./copilot/web-research.js";
import { readRetailExpertise } from "./copilot/retail-expertise-tool.js";
import { publicResearchToolResult } from "./copilot/public-research-tool.js";
import { prepareContextCheckpoint } from "./copilot/context-checkpoint.js";
import { readConversationContext } from "./copilot/conversation-history-tool.js";
import type { FastifyReply } from "fastify";
import { PassThrough } from "node:stream";
import {
  readProductClassificationPreview,
  readProductClassificationBatchPreview,
} from "./copilot/product-preview-tool.js";
import { readCopilotStoreSettings } from "./copilot/store-settings-tool.js";
import {
  readNeedCatalogue,
  readNeedMemberships,
} from "./copilot/need-tools.js";
import { readCommercialPlan } from "./copilot/commercial-plan-tool.js";
import { readWasteReceipt } from "./copilot/waste-receipt-tool.js";
import { readStoreSourceDocuments } from "./copilot/commercial-documents-tool.js";
import { readCopilotWeek } from "./copilot/week-context-tool.js";
import { readSubstitutes } from "./copilot/substitutes-tool.js";
import { readFieldEvents } from "./copilot/field-events-tool.js";
import { readProductSearch } from "./copilot/product-search-tool.js";
import {
  readCommercialDocuments,
  readCommercialPdf,
} from "./copilot/commercial-documents-tool.js";
import { readCommercialChoice } from "./copilot/commercial-choice-tool.js";
import { readCommercialOffers } from "./copilot/commercial-offers-tool.js";
import { readPeriodAnalysis } from "./copilot/period-analysis-tool.js";
import { readProductAnalysis } from "./copilot/product-analysis-tool.js";
import { readDailyAnalysis } from "./copilot/daily-analysis-tool.js";
import { loadCopilotReadContext } from "./copilot/read-context.js";
import {
  copilotTurnRequestSchema,
  copilotTurnResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { runCopilotTurn, CopilotTurnError } from "./copilot/turn-service.js";
import { CopilotTurnLeaseError } from "./copilot/turn-lease.js";
import {
  createCopilotAiProvider,
  type CopilotGenerationRequest,
} from "./copilot/ai-provider.js";
import {
  historyQuerySchema,
  historyPageSchema,
  readCopilotHistory,
} from "./copilot/history";
import {
  createWeekContextService,
  type WeekContextService,
} from "./context/week-context.js";
import {
  contextWeekQuerySchema,
  weeklyContextSchema,
} from "@fl-copilot/sync-contracts";
import { createCommercialVisualProvider } from "./commercial/visual-provider.js";
import { createCommercialOriginalLinkService } from "./commercial/original-link.js";
import { commercialOriginalLinkSchema } from "@fl-copilot/sync-contracts";
import { createCommercialAiProvider } from "./commercial/ai-provider.js";
import { serve as serveInngest } from "inngest/fastify";
import { createCommercialInngestWorkflows } from "./commercial/inngest-workflows.js";
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
import { getVercelOidcToken } from "./vercel-request-context.js";
import { createMongoWasteReceiptArithmeticValidationService } from "./uploads/waste-receipt-arithmetic-validation.js";
import { createMongoWasteReceiptDraftReader } from "./uploads/waste-receipt-draft.js";
import { createMongoWasteReceiptProductMatchingService } from "./uploads/waste-receipt-product-matching.js";

type AppDependencies = {
  database: DatabaseService;
  importClassifier?: ReturnType<typeof createImportClassifier>;
  copilotContext?: (
    storeId: string,
    parent: CopilotMessage,
  ) => Promise<CopilotGenerationRequest["context"]>;
  weekContext?: WeekContextService;
  auth?: AuthService;
  sendAuthCode?: AuthCodeSender;
  syncBootstrap?: SyncBootstrapService;
  syncPull?: SyncPullService;
  syncPush?: SyncPushService;
  sourceUploads?: SourceUploadService;
  commercialRecovery?: CommercialProcessingRecoveryService;
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
  const commercialWorkflows =
    config.INNGEST_EVENT_KEY && config.INNGEST_SIGNING_KEY
      ? createCommercialInngestWorkflows(
          dependencies.database,
          config.INNGEST_EVENT_KEY,
          config.INNGEST_SIGNING_KEY,
          createCommercialAiProvider({
            model: config.COMMERCIAL_PDF_AI_MODEL,
            gatewayApiKey: config.AI_GATEWAY_API_KEY,
            vercelOidcToken: config.VERCEL_OIDC_TOKEN,
            getVercelOidcToken,
          }),
          createCommercialVisualProvider({
            model: config.COMMERCIAL_PDF_AI_MODEL,
            gatewayApiKey: config.AI_GATEWAY_API_KEY,
            getVercelOidcToken: () =>
              getVercelOidcToken() ?? config.VERCEL_OIDC_TOKEN,
          }),
        )
      : undefined;
  const commercialRecovery =
    dependencies.commercialRecovery ??
    commercialWorkflows?.recovery ??
    createCommercialProcessingRecovery(dependencies.database, {
      enabled: false,
      model: config.COMMERCIAL_PDF_AI_MODEL,
    });
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
          getVercelOidcToken,
          model: config.WASTE_RECEIPT_VISION_MODEL,
        }),
      ),
      createMongoWasteReceiptArithmeticValidationService(
        dependencies.database,
        config.WASTE_RECEIPT_ARITHMETIC_TOLERANCE_EUR,
      ),
      createMongoWasteReceiptProductMatchingService(dependencies.database),
      createMongoWasteReceiptDraftReader(dependencies.database),
      commercialWorkflows?.dispatch,
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
  if (commercialWorkflows)
    app
      .withTypeProvider()
      .route<{ Querystring: Record<string, string | undefined> }>({
        method: ["GET", "POST", "PUT"],
        url: "/api/inngest",
        handler: serveInngest({
          client: commercialWorkflows.client,
          functions: commercialWorkflows.functions,
          servePath: "/api/inngest",
        }),
      });
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
      bodyLimit: 4 * 1024 * 1024,
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
      const principal = await auth.authorizeStore(
        accessToken,
        request.body.storeId,
        request.body.deviceId,
      );
      return request.body.commands.some(
        (c) =>
          c.entityType.startsWith("copilot_") || c.type.startsWith("COPILOT_"),
      )
        ? syncPush.push(request.body, request.id, principal.userId)
        : syncPush.push(request.body, request.id);
    },
  );
  app.post(
    "/api/v1/copilot/turn",
    {
      schema: {
        body: copilotTurnRequestSchema,
        response: { 200: copilotTurnResultSchema },
      },
    },
    async (request, reply) => {
      const token = request.headers.authorization;
      if (!token?.startsWith("Bearer "))
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string")
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué.",
        );
      const authorize = async () => {
        const principal = await auth.authorizeStore(token.slice(7), storeId);
        return {
          storeId: principal.storeId,
          ownerId: principal.userId,
          canRespond: true,
        };
      };
      await authorize();
      const loadContext =
        dependencies.copilotContext ??
        (config.COPILOT_AI_MODEL ? loadCopilotReadContext : undefined);
      if (!loadContext)
        throw new AuthError(
          503,
          "COPILOT_NOT_READY",
          "Le chat du copilote n’est pas encore disponible.",
        );
      const streaming = request.headers.accept === "application/x-ndjson";
      const abort = new AbortController();
      if (streaming && reply.raw.destroyed) abort.abort();
      if (streaming)
        reply.raw.once("close", () => {
          if (!reply.raw.writableEnded) abort.abort();
        });
      let stream: PassThrough | undefined;
      const emit = (event: unknown) => {
        if (!stream) {
          stream = new PassThrough();
          (reply as FastifyReply)
            .header("content-type", "application/x-ndjson; charset=utf-8")
            .header("cache-control", "no-store")
            .header("x-accel-buffering", "no")
            .send(stream);
        }
        if (!abort.signal.aborted) {
          if (stream.writableLength > 256000) {
            abort.abort();
            return;
          }
          stream.write(JSON.stringify(event) + "\n");
        }
      };
      let lastText = "",
        lastSent = 0;
      try {
        const db = await dependencies.database.getDb();
        const result = await runCopilotTurn(
          {
            db,
            provider: createCopilotAiProvider(config, undefined, {
              prepareContextCheckpoint: async (input) => {
                const principal = await authorize();
                const parent = await db
                  .collection<CopilotMessage & { _id: string }>(
                    "copilotMessages",
                  )
                  .findOne(
                    {
                      _id: request.body.userMessageId,
                      storeId: principal.storeId,
                      ownerId: principal.ownerId,
                      conversationId: request.body.conversationId,
                      role: "USER",
                    },
                    { maxTimeMS: 2000 },
                  );
                if (!parent) throw Error("COPILOT_CONTEXT_PARENT_INVALID");
                const { _id, ...payload } = parent;
                if (_id !== payload.id)
                  throw Error("COPILOT_CONTEXT_PARENT_INVALID");
                const result = await prepareContextCheckpoint(
                  db,
                  payload,
                  input,
                );
                await authorize();
                return result;
              },
              conversationHistory: async (input) => {
                const principal = await authorize();
                const result = await readConversationContext(
                  db,
                  {
                    storeId: principal.storeId,
                    ownerId: principal.ownerId,
                    conversationId: request.body.conversationId,
                    parentMessageId: request.body.userMessageId,
                  },
                  input,
                );
                await authorize();
                return result;
              },
              ...(request.headers["x-copilot-retail-expertise"] === "1"
                ? {
                    retailExpertise: async (input) => {
                      await authorize();
                      const result = readRetailExpertise(input);
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-web-research"] === "1"
                ? {
                    publicResearch: async (input, signal) =>
                      publicResearchToolResult(
                        await createCopilotWebResearchJournal({
                          db,
                          authorize,
                          research: createCopilotWebResearch(config).research,
                        })(
                          {
                            conversationId: request.body.conversationId,
                            userMessageId: request.body.userMessageId,
                          },
                          input,
                          signal,
                        ),
                      ),
                  }
                : {}),
              analyticsQuery: async (input) => {
                await authorize();
                const result = await readAnalyticsQuery(db, storeId, input);
                await authorize();
                return result;
              },
              ...(request.headers["x-copilot-preparation-proposals"] === "1"
                ? {
                    preparationRefresh:
                      request.headers["x-copilot-preparation-layout"] === "1" &&
                      request.headers["x-copilot-preparation-selection"] ===
                        "1" &&
                      request.headers["x-copilot-preparation-refresh"] === "1",
                    preparationSelection:
                      request.headers["x-copilot-preparation-layout"] === "1" &&
                      request.headers["x-copilot-preparation-selection"] ===
                        "1",
                    preparationCreate:
                      request.headers["x-copilot-preparation-layout"] === "1" &&
                      request.headers["x-copilot-preparation-create"] === "1",
                    preparationLayout:
                      request.headers["x-copilot-preparation-layout"] === "1",
                    preparationPreview: async (input) => {
                      await authorize();
                      const result = await readPreparationPreview(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-store-operations"] === "1"
                ? {
                    operationsPreview: async (input) => {
                      await authorize();
                      const result = await readOperationsPreview(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-need-proposals"] === "1"
                ? {
                    needPreview: async (input) => {
                      await authorize();
                      const result = await readNeedPreview(db, storeId, input);
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(["1", "2", "3", "4", "5"].includes(
                String(request.headers["x-copilot-store-conflicts"]),
              )
                ? {
                    storeConflictVersion:
                      request.headers["x-copilot-store-conflicts"] === "5"
                        ? (5 as const)
                        : request.headers["x-copilot-store-conflicts"] === "4"
                          ? (4 as const)
                          : request.headers["x-copilot-store-conflicts"] === "3"
                            ? (3 as const)
                            : request.headers["x-copilot-store-conflicts"] ===
                                "2"
                              ? (2 as const)
                              : (1 as const),
                    storeConflict: async (input) => {
                      if (request.headers["x-copilot-store-conflicts"] === "1")
                        storeConflictLegacyInputSchema.parse(input);
                      else if (
                        request.headers["x-copilot-store-conflicts"] === "2"
                      )
                        storeConflictV2InputSchema.parse(input);
                      else if (
                        request.headers["x-copilot-store-conflicts"] === "3"
                      )
                        storeConflictV3InputSchema.parse(input);
                      else if (
                        request.headers["x-copilot-store-conflicts"] === "4"
                      )
                        storeConflictV4InputSchema.parse(input);
                      await authorize();
                      const result = await previewStoreConflict(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-receipt-recovery"] === "1"
                ? {
                    receiptRecovery: async (input) => {
                      await authorize();
                      const result = await previewReceiptRecovery(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(["1", "2"].includes(
                String(request.headers["x-copilot-receipt-correction"]),
              )
                ? {
                    receiptCorrectionVersion:
                      request.headers["x-copilot-receipt-correction"] === "2"
                        ? 2
                        : 1,
                    receiptCorrection: async (input) => {
                      await authorize();
                      const result = await previewReceiptCorrection(
                        db,
                        storeId,
                        input,
                        createMongoWasteReceiptDraftReader(
                          dependencies.database,
                        ),
                        request.headers["x-copilot-receipt-correction"] === "2"
                          ? 2
                          : 1,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-receipt-publication"] === "1"
                ? {
                    receiptPublication: async (input) => {
                      await authorize();
                      const result = await previewReceiptPublication(
                        db,
                        storeId,
                        input,
                        createMongoWasteReceiptDraftReader(
                          dependencies.database,
                        ),
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-identity-review"] === "1"
                ? {
                    identityReview: async (input) => {
                      await authorize();
                      const result = await readIdentityReviewPreview(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-catalogue-proposals"] === "1"
                ? {
                    cataloguePreview: async (input) => {
                      await authorize();
                      const result = await readCataloguePreview(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-execution-proposals"] === "1"
                ? {
                    executionPreview: async (input) => {
                      await authorize();
                      const result = await readCommercialExecutionPreview(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              daily: async (input) => {
                await authorize();
                const result = await readDailyAnalysis(db, storeId, input);
                await authorize();
                return result;
              },
              productBatchPreview: async (input) => {
                await authorize();
                const result = await readProductClassificationBatchPreview(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              productPreview: async (input) => {
                await authorize();
                const result = await readProductClassificationPreview(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              storeSettings: async (input) => {
                await authorize();
                const result = await readCopilotStoreSettings(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              needCatalogue: async (input) => {
                await authorize();
                const result = await readNeedCatalogue(db, storeId, input);
                await authorize();
                return result;
              },
              needMemberships: async (input) => {
                await authorize();
                const result = await readNeedMemberships(db, storeId, input);
                await authorize();
                return result;
              },
              ...(request.headers["x-copilot-recommendation-tracking"] === "1"
                ? {
                    recommendationDecisions: async (input) => {
                      const p = await authorize();
                      const result = await readRecommendationDecisions(
                        db,
                        { storeId, ownerId: p.ownerId },
                        input,
                      );
                      await authorize();
                      return result;
                    },
                    recommendationTracking: async (input) => {
                      const principal = await authorize();
                      const result = await readRecommendationTracking(
                        db,
                        {
                          storeId,
                          ownerId: principal.ownerId,
                          conversationId: request.body.conversationId,
                        },
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              actionReview: async (input) => {
                await authorize();
                const result = await readActionReview(db, storeId, input);
                await authorize();
                return result;
              },
              commercialPlan: async (input) => {
                await authorize();
                const result = await readCommercialPlan(db, storeId, input);
                await authorize();
                return result;
              },
              receiptDocuments: async (input) => {
                await authorize();
                const result = await readStoreSourceDocuments(
                  db,
                  storeId,
                  input,
                  "WASTE_RECEIPT",
                );
                await authorize();
                return result;
              },
              receipt: async (input) => {
                await authorize();
                const result = await readWasteReceipt(
                  db,
                  storeId,
                  input,
                  createMongoWasteReceiptDraftReader(dependencies.database),
                );
                await authorize();
                return result;
              },
              weekContext: async (input) => {
                await authorize();
                const result = await readCopilotWeek(
                  dependencies.weekContext ??
                    createWeekContextService(dependencies.database),
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              substitutes: async (input) => {
                await authorize();
                const result = await readSubstitutes(db, storeId, input);
                await authorize();
                return result;
              },
              fieldEvents: async (input) => {
                await authorize();
                const result = await readFieldEvents(db, storeId, input);
                await authorize();
                return result;
              },
              productSearch: async (input) => {
                await authorize();
                const result = await readProductSearch(db, storeId, input);
                await authorize();
                return result;
              },
              commercialDocuments: async (input) => {
                await authorize();
                const result = await readCommercialDocuments(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              priceScenario: async (input) => {
                const principal = await authorize();
                const result = await readPriceScenario(
                  db,
                  {
                    storeId: principal.storeId,
                    ownerId: principal.ownerId,
                    conversationId: request.body.conversationId,
                    parentMessageId: request.body.userMessageId,
                  },
                  input,
                );
                await authorize();
                return result;
              },
              referenceInspection: async (input) => {
                await authorize();
                const result = await inspectCommercialReference(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              documentComparison: async (input) => {
                await authorize();
                const result = await readCommercialDocumentComparison(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              commercialPdf: async (input) => {
                await authorize();
                const result = await readCommercialPdf(db, storeId, input);
                await authorize();
                return result;
              },
              planReadiness: async (input) => {
                await authorize();
                const result = await readCommercialPlanReadiness(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              commercialPreparation: async (input) => {
                await authorize();
                const result = await readCommercialPreparation(
                  db,
                  storeId,
                  input,
                );
                await authorize();
                return result;
              },
              ...(request.headers["x-copilot-choice-update"] === "1"
                ? {
                    choiceUpdate: async (input) => {
                      await authorize();
                      const result = await previewChoiceUpdate(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-choice-retention"] === "1"
                ? {
                    choiceRetention: async (input) => {
                      await authorize();
                      const result = await previewChoiceRetention(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-choice-create"] === "1"
                ? {
                    choiceCreate: async (input) => {
                      await authorize();
                      const result = await previewChoiceCreate(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-commercial-reference"] === "1"
                ? {
                    referencePreview: async (input) => {
                      await authorize();
                      const result = await previewCommercialReference(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-plan-validation"] === "1"
                ? {
                    planValidation: async (input) => {
                      await authorize();
                      const result = await previewCommercialPlanValidation(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-offer-validation"] === "1"
                ? {
                    offerValidation: async (input) => {
                      await authorize();
                      const result = await previewOfferValidation(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-choice-reassociation"] === "1"
                ? {
                    choiceReassociation: async (input) => {
                      await authorize();
                      const result = await previewChoiceReassociation(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              ...(request.headers["x-copilot-choice-withdrawal"] === "1"
                ? {
                    choiceWithdrawal: async (input) => {
                      await authorize();
                      const result = await previewChoiceWithdrawal(
                        db,
                        storeId,
                        input,
                      );
                      await authorize();
                      return result;
                    },
                  }
                : {}),
              sourceOffers: async (input) => {
                await authorize();
                const result = await readSourceOffers(db, storeId, input);
                await authorize();
                return result;
              },
              commercialChoice: async (input) => {
                await authorize();
                const result = await readCommercialChoice(db, storeId, input);
                await authorize();
                return result;
              },
              commercialOffers: async (input) => {
                await authorize();
                const result = await readCommercialOffers(db, storeId, input);
                await authorize();
                return result;
              },
              period: async (input) => {
                await authorize();
                const result = await readPeriodAnalysis(db, storeId, input);
                await authorize();
                return result;
              },
              productChanges: async (input) => {
                await authorize();
                const result = await readProductAnalysis(db, storeId, input);
                await authorize();
                return result;
              },
            }),
            authorize,
            allowMemorySuggestions:
              request.headers["x-copilot-memory-suggestions"] === "1",
            onActivity:
              streaming && request.headers["x-copilot-activity"] === "1"
                ? (activity) =>
                    emit({
                      type: "activity",
                      replyId: request.body.replyId,
                      conversationId: request.body.conversationId,
                      activity,
                    })
                : undefined,
            onProgress: streaming
              ? (text) => {
                  if (
                    text === lastText ||
                    (lastText && text.length - lastText.length < 48) ||
                    Date.now() - lastSent < 40
                  )
                    return;
                  lastText = text;
                  lastSent = Date.now();
                  emit({
                    type: "text",
                    replyId: request.body.replyId,
                    conversationId: request.body.conversationId,
                    text,
                  });
                }
              : undefined,
            loadContext: (parent) => loadContext(storeId, parent),
          },
          request.body,
          abort.signal,
        );
        if (streaming) {
          emit({ type: "result", result });
          stream?.end();
          return reply;
        }
        return result;
      } catch (error) {
        if (stream) {
          if (!abort.signal.aborted) emit({ type: "error" });
          stream.end();
          return reply;
        }
        if (error instanceof CopilotTurnLeaseError)
          throw new AuthError(
            409,
            error.code === "IN_PROGRESS"
              ? "COPILOT_TURN_PENDING"
              : "COPILOT_TURN_STALE",
            error.code === "IN_PROGRESS"
              ? "Une réponse est déjà en préparation. Réessayez dans un instant."
              : "Cette demande doit être actualisée.",
            error.code === "IN_PROGRESS",
          );
        if (error instanceof CopilotTurnError)
          throw new AuthError(
            error.code === "ACCESS_INVALID" ? 403 : 409,
            "COPILOT_TURN_INVALID",
            "Cette conversation doit être actualisée avant de continuer.",
          );
        throw error;
      }
    },
  );
  app.post(
    "/api/v1/copilot/import-classification",
    {
      schema: {
        body: importClassificationRequestSchema,
        response: { 200: importClassificationResultSchema },
      },
    },
    async (request) => {
      const token = request.headers.authorization,
        storeId = request.headers["x-store-id"];
      if (!token?.startsWith("Bearer "))
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      if (typeof storeId !== "string")
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué.",
        );
      const principal = await auth.authorizeStore(token.slice(7), storeId);
      if (principal.role !== "MANAGER")
        throw new AuthError(
          403,
          "STORE_ACCESS_DENIED",
          "Cette action demande les droits responsable.",
        );
      try {
        const result = validateImportClassification(
          await (
            dependencies.importClassifier ?? createImportClassifier(config)
          )(request.body),
          request.body.labels,
        );
        if (
          (await auth.authorizeStore(token.slice(7), storeId)).role !==
          "MANAGER"
        )
          throw new AuthError(
            403,
            "STORE_ACCESS_DENIED",
            "Cette action demande les droits responsable.",
          );
        return result;
      } catch {
        throw new AuthError(
          503,
          "IMPORT_CLASSIFICATION_UNAVAILABLE",
          "La classification reste à compléter ; l’import des chiffres peut continuer.",
          true,
        );
      }
    },
  );
  app.get(
    "/api/v1/copilot/history",
    {
      schema: {
        querystring: historyQuerySchema,
        response: { 200: historyPageSchema },
      },
    },
    async (request) => {
      const token = request.headers.authorization;
      if (!token?.startsWith("Bearer "))
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string")
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué.",
        );
      const store = await auth.authorizeStore(token.slice(7), storeId);
      return readCopilotHistory(
        await dependencies.database.getDb(),
        storeId,
        store.userId,
        request.query,
        request.headers["x-copilot-history-deletion"] === "1",
      );
    },
  );
  app.get(
    "/api/v1/store/context",
    {
      schema: {
        querystring: contextWeekQuerySchema,
        response: { 200: weeklyContextSchema },
      },
    },
    async (request) => {
      const token = request.headers.authorization;
      if (!token?.startsWith("Bearer "))
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      const storeId = request.headers["x-store-id"];
      if (
        typeof storeId !== "string" ||
        !z.string().uuid().safeParse(storeId).success
      )
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué.",
        );
      await auth.authorizeStore(token.slice(7), storeId);
      return (
        dependencies.weekContext ??
        createWeekContextService(dependencies.database)
      ).read(storeId, request.query.weekStart);
    },
  );
  app.get(
    "/api/v1/commercial/:id/processing",
    {
      schema: {
        params: z.strictObject({ id: z.uuid() }),
        response: { 200: commercialProcessingReviewSchema },
      },
    },
    async (request) => {
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
      await auth.authorizeStore(token.slice(7), storeId);
      const result = await commercialRecovery.review(
        storeId,
        request.params.id,
      );
      await auth.authorizeStore(token.slice(7), storeId);
      return result;
    },
  );
  app.post(
    "/api/v1/commercial/:id/resume",
    {
      schema: {
        params: z.strictObject({ id: z.uuid() }),
        body: commercialProcessingResumeSchema,
        response: { 200: commercialProcessingRequestedSchema },
      },
    },
    async (request) => {
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
      const context = await auth.authorizeStore(token.slice(7), storeId);
      const authorize = async () => {
        const current = await auth.authorizeStore(
          token.slice(7),
          storeId,
          context.deviceId,
        );
        if (current.role !== "MANAGER" || current.userId !== context.userId)
          throw new AuthError(
            403,
            "COMMERCIAL_ANALYSIS_FORBIDDEN",
            "Votre rôle ne permet pas de reprendre cette analyse.",
          );
      };
      return commercialRecovery.request(
        storeId,
        request.params.id,
        request.body,
        { userId: context.userId, deviceId: context.deviceId },
        authorize,
      );
    },
  );
  app.get(
    "/api/v1/commercial/:id/original-link",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: commercialOriginalLinkSchema },
      },
    },
    async (request) => {
      const token = request.headers.authorization;
      if (!token?.startsWith("Bearer "))
        throw new AuthError(401, "AUTH_REQUIRED", "Veuillez vous connecter.");
      const storeId = request.headers["x-store-id"];
      if (typeof storeId !== "string")
        throw new AuthError(
          400,
          "STORE_CONTEXT_REQUIRED",
          "Le magasin doit être indiqué.",
        );
      await auth.authorizeStore(token.slice(7), storeId);
      return createCommercialOriginalLinkService(dependencies.database).link(
        storeId,
        request.params.id,
      );
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
      const principal = await auth.authorizeStore(accessToken, storeId);
      try {
        return request.query.copilotHistory === "true"
          ? await syncPull.pull(
              storeId,
              request.query,
              principal.userId,
              request.headers["x-copilot-history-deletion"] === "1",
            )
          : await syncPull.pull(storeId, request.query);
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
      return request.headers["x-copilot-history-deletion"] === "1"
        ? syncBootstrap.bootstrap(store, request.query, true)
        : syncBootstrap.bootstrap(store, request.query);
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
