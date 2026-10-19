import { buildStoreLayoutScenarioMessages } from "./store-layout-scenario-messages";
import { buildStoreLayoutEditMessages } from "./store-layout-edit-messages";
import { appendFactContext } from "./fact-context";
import { buildActionExecutionMessages } from "./action-execution-messages";
import { buildExecutionLinkMessages } from "./execution-link-messages";
import { buildRecommendationTrackingMessages } from "./recommendation-tracking-messages.js";
import { buildStoreConflictMessages } from "./store-conflict-messages.js";
import { buildReceiptRecoveryMessages } from "./receipt-recovery-messages.js";
import { buildPriceScenarioFormMessages } from "./price-scenario-messages.js";
import { buildReferenceProposalMessages } from "./reference-messages.js";
import { buildPlanValidationProposalMessages } from "./plan-validation-messages.js";
import { copilotMessageIsDeleted } from "@fl-copilot/domain";
import { buildOfferValidationProposalMessages } from "./offer-validation-messages.js";
import { buildChoiceCreateProposalMessages } from "./choice-create-messages.js";
import { buildChoiceRetentionProposalMessages } from "./choice-retention-messages.js";
import { buildChoiceReassociationProposalMessages } from "./choice-reassociation-messages.js";
import { buildChoiceUpdateProposalMessages } from "./choice-update-messages.js";
import { buildChoiceWithdrawalProposalMessages } from "./choice-withdrawal-messages.js";
import { buildPreparationProposalMessages } from "./preparation-proposal-messages.js";
import { buildOperationsProposalMessages } from "./operations-proposal-messages.js";
import { buildNeedProposalMessages } from "./need-proposal-messages.js";
import { buildReceiptCorrectionMessages } from "./receipt-correction-messages.js";
import { buildReceiptPublicationMessages } from "./receipt-publication-messages.js";
import { buildIdentityReviewMessages } from "./identity-review-messages.js";
import { buildCatalogueProposalMessages } from "./catalogue-proposal-messages.js";
import { buildExecutionProposalMessages } from "./execution-proposal-messages.js";
import {
  readConversationCheckpoint,
  buildContextCheckpoint,
} from "./context-checkpoint.js";
import { buildKnowledgeSuggestionMessages } from "./knowledge-suggestion-messages";
import { readKnowledge } from "./knowledge-store";
import type { CopilotActivity } from "@fl-copilot/sync-contracts";
import { readAnsweredInformationContext } from "./answered-information.js";
import { buildInformationRequestMessages } from "./information-request-messages.js";
import { buildProductProposalMessages } from "./product-proposal-messages.js";
import { readAttachedSources } from "./attached-sources.js";
import { readConversationGenerationHistory } from "./generation-history.js";
import { readLatestDepartmentEvidence } from "./daily-evidence.js";
import { acquireTurnLease } from "./turn-lease.js";
import { randomUUID } from "node:crypto";
import {
  isContextCheckpointUnchanged,
  copilotTurnRequestSchema,
  type CopilotTurnRequest,
  copilotConversationSchema,
  copilotMessageSchema,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { Db } from "mongodb";
import type {
  CopilotAiProvider,
  CopilotGenerationRequest,
} from "./ai-provider.js";
import {
  generateCopilotResponse,
  type CopilotGenerationFailure,
} from "./response-service.js";
import { buildCopilotResponseMessage } from "./response-message.js";
import {
  appendCopilotResponse,
  appendCopilotToolRecord,
} from "./response-store.js";
import { createMongoSyncChangeService } from "../sync/sync-change-service.js";

export class CopilotTurnError extends Error {
  constructor(
    readonly code:
      "ACCESS_INVALID" | "PARENT_INVALID" | "IDENTITY_CONFLICT" | "CANCELLED",
  ) {
    super(code);
    this.name = "CopilotTurnError";
  }
}
/** Internal orchestration; authenticated application supplies authority and trusted context loader. */
export async function runCopilotTurn(
  dependencies: {
    db: Db;
    provider: CopilotAiProvider;
    authorize: () => Promise<{
      storeId: string;
      ownerId: string;
      canRespond: boolean;
    }>;
    loadContext: (
      parent: CopilotMessage,
    ) => Promise<CopilotGenerationRequest["context"]>;
    now?: () => Date;
    onProgress?: (text: string) => void;
    onActivity?: (activity: CopilotActivity) => void;
    onGenerationFailure?: (failure: CopilotGenerationFailure) => void;
    allowMemorySuggestions?: boolean;
    supportsAnalyticsDestinations?: boolean;
  },
  raw: CopilotTurnRequest,
  signal?: AbortSignal,
): Promise<{ message: CopilotMessage; alreadyApplied: boolean }> {
  const input = copilotTurnRequestSchema.parse(raw);
  const cancelled = () => {
    if (signal?.aborted) throw new CopilotTurnError("CANCELLED");
  };
  cancelled();
  const authority = await dependencies.authorize();
  if (!authority.canRespond) throw new CopilotTurnError("ACCESS_INVALID");
  const read = async () => {
    const scope = { storeId: authority.storeId, ownerId: authority.ownerId };
    const conversation = await dependencies.db
      .collection<CopilotConversation & { _id: string }>("copilotConversations")
      .findOne({ _id: input.conversationId, ...scope });
    if (!conversation) throw new CopilotTurnError("PARENT_INVALID");
    const { _id, ...payload } = conversation;
    void _id;
    if (copilotConversationSchema.parse(payload).status !== "ACTIVE")
      throw new CopilotTurnError("PARENT_INVALID");
    const row = await dependencies.db
      .collection<CopilotMessage & { _id: string }>("copilotMessages")
      .findOne({
        _id: input.userMessageId,
        conversationId: input.conversationId,
        ...scope,
      });
    if (!row) throw new CopilotTurnError("PARENT_INVALID");
    const { _id: parentKey, ...parentPayload } = row;
    void parentKey;
    const parent = copilotMessageSchema.parse(parentPayload);
    if (copilotMessageIsDeleted(parent, payload))
      throw new CopilotTurnError("PARENT_INVALID");
    if (
      parent.role !== "USER" ||
      parent.id !== input.userMessageId ||
      parent.storeId !== authority.storeId ||
      parent.ownerId !== authority.ownerId ||
      parent.conversationId !== input.conversationId
    )
      throw new CopilotTurnError("PARENT_INVALID");
    const cached = await dependencies.db
      .collection<CopilotMessage & { _id: string }>("copilotMessages")
      .findOne({ _id: input.replyId });
    if (cached) {
      const { _id: key, ...data } = cached;
      void key;
      const message = copilotMessageSchema.parse(data);
      if (
        message.storeId !== authority.storeId ||
        message.ownerId !== authority.ownerId ||
        message.conversationId !== input.conversationId ||
        message.replyToMessageId !== input.userMessageId ||
        message.role !== "ASSISTANT"
      )
        throw new CopilotTurnError("IDENTITY_CONFLICT");
      if (copilotMessageIsDeleted(message, payload))
        throw new CopilotTurnError("PARENT_INVALID");
      return { parent, cached: message };
    }
    return { parent, cached: null };
  };
  const initial = await read();
  cancelled();
  if (initial.cached) return { message: initial.cached, alreadyApplied: true };
  const lease = await acquireTurnLease(dependencies.db, {
    ...input,
    storeId: authority.storeId,
    ownerId: authority.ownerId,
  });
  try {
    const afterLease = await read();
    cancelled();
    if (afterLease.cached)
      return { message: afterLease.cached, alreadyApplied: true };
    dependencies.onActivity?.({
      id: "preparing",
      stage: "PREPARING",
      status: "RUNNING",
    });
    const context = await dependencies.loadContext(initial.parent);
    cancelled();
    const evidence = await readLatestDepartmentEvidence(
      dependencies.db,
      authority.storeId,
    );
    cancelled();
    const { recentAttachmentReferences, recentSourcesOmitted, ...history } =
      await readConversationGenerationHistory(dependencies.db, initial.parent);
    cancelled();
    const attachedSources = await readAttachedSources(
      dependencies.db,
      authority.storeId,
      initial.parent.attachments,
    );
    cancelled();
    const recentSources = await readAttachedSources(
      dependencies.db,
      authority.storeId,
      recentAttachmentReferences,
    );
    cancelled();
    const answeredInformation = await readAnsweredInformationContext(
      dependencies.db,
      initial.parent,
    );
    cancelled();
    const storeKnowledge = await readKnowledge(
      dependencies.db,
      authority.storeId,
      authority.ownerId,
    ).catch(() => ({
      status: "UNAVAILABLE" as const,
      partial: true,
      entries: [],
    }));
    cancelled();
    const retainedContext = history.earlierMessagesOmitted
      ? await readConversationCheckpoint(dependencies.db, initial.parent)
      : undefined;
    cancelled();
    const recentById = new Map(
      [...recentSources, ...(retainedContext?.sources ?? [])]
        .filter(
          (s) =>
            !initial.parent.attachments.some(
              (a) => a.sourceDocumentId === s.sourceDocumentId,
            ),
        )
        .map((s) => [s.sourceDocumentId, s]),
    );
    const request = {
      requestId: randomUUID(),
      storeId: authority.storeId,
      context,
      evidence,
      history,
      attachedSources,
      recentSources: [...recentById.values()].slice(0, 10),
      recentSourcesOmitted:
        recentSourcesOmitted ||
        !!retainedContext?.sourcesOmitted ||
        recentById.size > 10,
      ...(retainedContext
        ? { conversationCheckpoint: retainedContext.checkpoint }
        : {}),
      answeredInformation,
      storeKnowledge,
      userQuestion: initial.parent.text || null,
      ...(dependencies.allowMemorySuggestions
        ? { memorySuggestion: { currentUserMessageId: initial.parent.id } }
        : {}),
    };
    dependencies.onActivity?.({
      id: "preparing",
      stage: "PREPARING",
      status: "DONE",
    });
    const generation = await generateCopilotResponse(
      dependencies.provider,
      request,
      signal,
      dependencies.onProgress,
      dependencies.onActivity,
      dependencies.onGenerationFailure,
    );
    cancelled();
    const renewed = await dependencies.authorize();
    if (
      !renewed.canRespond ||
      renewed.storeId !== authority.storeId ||
      renewed.ownerId !== authority.ownerId
    )
      throw new CopilotTurnError("ACCESS_INVALID");
    const latest = await read();
    cancelled();
    if (latest.cached) return { message: latest.cached, alreadyApplied: true };
    const message = buildCopilotResponseMessage({
      id: input.replyId,
      createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
      parent: latest.parent,
      request,
      generation,
      supportsAnalyticsDestinations: dependencies.supportsAnalyticsDestinations,
    });
    // TOOL builders inherit identity/time only, never assistant presentation metadata.
    const { analyticsDestinations: _destinations, ...toolParent } = message;
    void _destinations;
    const session = dependencies.db.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        cancelled();
        await lease.fence(session);
        const changes = createMongoSyncChangeService();
        const reply = await appendCopilotResponse(
          { database: dependencies.db, session },
          renewed,
          message,
          changes,
        );
        if (generation.mode === "AI" && generation.factTrace)
          await appendFactContext(
            dependencies.db,
            session,
            message,
            generation.factTrace,
            evidence,
            context.batch.candidates.length > 0 ||
              attachedSources.length > 0 ||
              (request.recentSources?.length ?? 0) > 0 ||
              !!request.conversationCheckpoint,
          );
        if (
          generation.mode === "AI" &&
          generation.contextCheckpoint &&
          !(
            request.conversationCheckpoint?.status === "AVAILABLE" &&
            isContextCheckpointUnchanged(
              request.conversationCheckpoint.content,
              generation.contextCheckpoint,
              latest.parent.attachments.map((a) => a.sourceDocumentId),
            )
          )
        ) {
          const checkpoint = await buildContextCheckpoint(
            dependencies.db,
            toolParent,
            latest.parent,
            generation.contextCheckpoint,
            request.conversationCheckpoint?.status === "AVAILABLE"
              ? request.conversationCheckpoint.checkpointId
              : null,
            session,
          );
          await appendCopilotToolRecord(
            { database: dependencies.db, session },
            renewed,
            checkpoint,
            changes,
          );
        }
        if (
          generation.mode === "FALLBACK" &&
          generation.productPreviews?.length
        ) {
          for (const card of buildProductProposalMessages(
            toolParent,
            generation.productPreviews,
          ))
            await appendCopilotToolRecord(
              { database: dependencies.db, session },
              renewed,
              card,
              changes,
            );
        }
        if (generation.mode === "FALLBACK")
          for (const card of buildStoreConflictMessages(
            toolParent,
            generation.storeConflictPreviews ?? [],
          ))
            await appendCopilotToolRecord(
              { database: dependencies.db, session },
              renewed,
              card,
              changes,
            );
        if (generation.mode === "FALLBACK")
          for (const card of buildReceiptRecoveryMessages(
            toolParent,
            generation.receiptRecoveryPreviews ?? [],
          ))
            await appendCopilotToolRecord(
              { database: dependencies.db, session },
              renewed,
              card,
              changes,
            );
        if (generation.mode === "AI")
          for (const proposal of [
            ...buildChoiceUpdateProposalMessages(
              toolParent,
              generation.choiceUpdates ?? [],
            ),
            ...buildChoiceRetentionProposalMessages(
              toolParent,
              generation.choiceRetentions ?? [],
            ),
            ...buildChoiceCreateProposalMessages(
              toolParent,
              generation.choiceCreates ?? [],
            ),
            ...buildReferenceProposalMessages(
              toolParent,
              generation.referencePreviews ?? [],
            ),
            ...buildPlanValidationProposalMessages(
              toolParent,
              generation.planValidations ?? [],
            ),
            ...buildOfferValidationProposalMessages(
              toolParent,
              generation.offerValidations ?? [],
            ),
            ...buildChoiceReassociationProposalMessages(
              toolParent,
              generation.choiceReassociations ?? [],
            ),
            ...buildChoiceWithdrawalProposalMessages(
              toolParent,
              generation.choiceWithdrawals ?? [],
            ),
            ...buildPreparationProposalMessages(
              toolParent,
              generation.preparationPreviews ?? [],
            ),
            ...buildStoreLayoutScenarioMessages(
              toolParent,
              generation.layoutScenarios ?? [],
            ),
            ...buildStoreLayoutEditMessages(
              toolParent,
              generation.layoutEditPreviews ?? [],
            ),
            ...buildOperationsProposalMessages(
              toolParent,
              generation.operationsPreviews ?? [],
            ),
            ...buildNeedProposalMessages(
              toolParent,
              generation.needPreviews ?? [],
            ),
            ...buildStoreConflictMessages(
              toolParent,
              generation.storeConflictPreviews ?? [],
            ),
            ...buildReceiptRecoveryMessages(
              toolParent,
              generation.receiptRecoveryPreviews ?? [],
            ),
            ...buildReceiptCorrectionMessages(
              toolParent,
              generation.receiptCorrectionPreviews ?? [],
            ),
            ...buildReceiptPublicationMessages(
              toolParent,
              generation.receiptPublicationPreviews ?? [],
            ),
            ...buildIdentityReviewMessages(
              toolParent,
              generation.identityReviews ?? [],
            ),
            ...buildCatalogueProposalMessages(
              toolParent,
              generation.cataloguePreviews ?? [],
            ),
            ...buildRecommendationTrackingMessages(
              toolParent,
              generation.recommendationTrackingPreviews ?? [],
            ),
            ...buildActionExecutionMessages(
              toolParent,
              generation.actionExecutionPreviews ?? [],
            ),
            ...buildExecutionLinkMessages(
              toolParent,
              generation.executionLinkPreviews ?? [],
            ),
            ...buildExecutionProposalMessages(
              toolParent,
              generation.executionPreviews ?? [],
            ),
            ...buildKnowledgeSuggestionMessages(
              toolParent,
              generation.knowledgeSuggestions ?? [],
              request,
            ),
            ...buildProductProposalMessages(
              toolParent,
              generation.productPreviews ?? [],
            ),
            ...buildPriceScenarioFormMessages(
              toolParent,
              generation.priceScenarioForms ?? [],
            ),
            ...buildInformationRequestMessages(
              toolParent,
              generation.priceScenarioForms?.length
                ? []
                : (generation.informationRequests ?? []),
            ),
          ])
            await appendCopilotToolRecord(
              { database: dependencies.db, session },
              renewed,
              proposal,
              changes,
            );
        cancelled();
        return reply;
      });
      if (!result) throw new Error("COPILOT_REPLY_COMMIT_FAILED");
      return result;
    } finally {
      await session.endSession();
    }
  } finally {
    await lease.release();
  }
}
