import { readCopilotChoiceReassociationProposal } from "@fl-copilot/domain";
import { readCopilotChoiceUpdateProposal } from "@fl-copilot/domain";
import { readCopilotChoiceWithdrawalProposal } from "@fl-copilot/domain";
import { readCopilotPreparationProposal } from "@fl-copilot/domain";
import { readCopilotOperationsProposal } from "@fl-copilot/domain";
import { readCopilotNeedProposal } from "@fl-copilot/domain";
import { readCopilotCatalogueProposal } from "@fl-copilot/domain";
import { readCopilotExecutionProposal } from "@fl-copilot/domain";
import { validateStoredContext } from "./context-checkpoint.js";
import { readContextCheckpoint } from "@fl-copilot/domain";
import {
  readKnowledgeSuggestion,
  validateKnowledgeSuggestionSources,
} from "@fl-copilot/domain";
import {
  readCopilotProductProposal,
  readCopilotInformationRequest,
} from "@fl-copilot/domain";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  type CopilotMessage,
  type CopilotConversation,
} from "@fl-copilot/domain";
import type { MongoCommandMutationContext } from "../sync/processed-command-service.js";
import type { createMongoSyncChangeService } from "../sync/sync-change-service.js";

/** Server producer only. Caller must run this inside a Mongo transaction and authenticate authority. */
export async function appendCopilotResponse(
  ctx: MongoCommandMutationContext,
  authority: { storeId: string; ownerId: string; canRespond: boolean },
  raw: CopilotMessage,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<{ message: CopilotMessage; alreadyApplied: boolean }> {
  if (!ctx.session.inTransaction())
    throw new Error("COPILOT_REPLY_TRANSACTION_REQUIRED");
  const message = copilotMessageSchema.parse(raw);
  if (
    !authority.canRespond ||
    message.role !== "ASSISTANT" ||
    message.storeId !== authority.storeId ||
    message.ownerId !== authority.ownerId ||
    !message.replyToMessageId
  )
    throw new Error("COPILOT_REPLY_ACCESS_INVALID");
  const scope = { storeId: authority.storeId, ownerId: authority.ownerId };
  const conversations = ctx.database.collection<
    CopilotConversation & { _id: string }
  >("copilotConversations");
  const parentConversation = await conversations.findOne(
    { _id: message.conversationId, ...scope },
    { session: ctx.session },
  );
  if (!parentConversation) throw new Error("COPILOT_REPLY_PARENT_INVALID");
  const { _id: conversationKey, ...conversationPayload } = parentConversation;
  void conversationKey;
  if (copilotConversationSchema.parse(conversationPayload).status !== "ACTIVE")
    throw new Error("COPILOT_REPLY_CONVERSATION_ARCHIVED");
  const messages = ctx.database.collection<CopilotMessage & { _id: string }>(
    "copilotMessages",
  );
  const parent = await messages.findOne(
    {
      _id: message.replyToMessageId,
      conversationId: message.conversationId,
      ...scope,
    },
    { session: ctx.session },
  );
  if (
    !parent ||
    parent.role !== "USER" ||
    Date.parse(message.createdAt) < Date.parse(parent.createdAt)
  )
    throw new Error("COPILOT_REPLY_PARENT_INVALID");
  // Authority and active parent are checked before replay; revocation cannot expose a cached private reply.
  const existing = await messages.findOne(
    { _id: message.id },
    { session: ctx.session },
  );
  if (existing) {
    const { _id, ...payload } = existing;
    void _id;
    const saved = copilotMessageSchema.parse(payload);
    if (JSON.stringify(saved) !== JSON.stringify(message))
      throw new Error("COPILOT_REPLY_IDENTITY_CONFLICT");
    return { message: saved, alreadyApplied: true };
  }
  await messages.insertOne(
    { _id: message.id, ...message },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId: message.storeId,
    entityType: "copilot_message",
    entityId: message.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return { message, alreadyApplied: false };
}

/** Atomic server tool producer; client push remains USER-only. */
export async function appendCopilotToolRecord(
  ctx: MongoCommandMutationContext,
  authority: { storeId: string; ownerId: string; canRespond: boolean },
  raw: CopilotMessage,
  changes: ReturnType<typeof createMongoSyncChangeService>,
) {
  if (!ctx.session.inTransaction() || !authority.canRespond)
    throw Error("COPILOT_PROPOSAL_FORBIDDEN");
  const decoded = copilotMessageSchema.parse(raw);
  const kind = JSON.parse(decoded.text).kind;
  const artifact =
    kind === "COMMERCIAL_CHOICE_UPDATE_PROPOSAL"
      ? readCopilotChoiceUpdateProposal(decoded)
      : kind === "COMMERCIAL_CHOICE_REASSOCIATION_PROPOSAL"
        ? readCopilotChoiceReassociationProposal(decoded)
        : kind === "COMMERCIAL_CHOICE_WITHDRAWAL_PROPOSAL"
          ? readCopilotChoiceWithdrawalProposal(decoded)
          : kind === "MISSING_INFORMATION_REQUEST"
            ? readCopilotInformationRequest(decoded)
            : kind === "CONTEXT_CHECKPOINT"
              ? readContextCheckpoint(decoded)
              : kind === "COMMERCIAL_PREPARATION_PROPOSAL"
                ? readCopilotPreparationProposal(decoded)
                : kind === "STORE_OPERATIONS_PROPOSAL"
                  ? readCopilotOperationsProposal(decoded)
                  : kind === "NEED_MUTATION_PROPOSAL"
                    ? readCopilotNeedProposal(decoded)
                    : kind === "PRODUCT_CATALOGUE_PROPOSAL"
                      ? readCopilotCatalogueProposal(decoded)
                      : kind === "COMMERCIAL_EXECUTION_PROPOSAL"
                        ? readCopilotExecutionProposal(decoded)
                        : kind === "KNOWLEDGE_SUGGESTION"
                          ? readKnowledgeSuggestion(decoded)
                          : readCopilotProductProposal(decoded);
  const message = artifact.message;
  const assistantMessageId =
    "content" in artifact
      ? artifact.content.assistantMessageId
      : artifact.proposal.assistantMessageId;
  if (
    message.storeId !== authority.storeId ||
    message.ownerId !== authority.ownerId
  )
    throw Error("COPILOT_PROPOSAL_FORBIDDEN");
  const assistantRow = await ctx.database
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne(
      {
        _id: assistantMessageId,
        storeId: message.storeId,
        ownerId: message.ownerId,
        conversationId: message.conversationId,
      },
      { session: ctx.session },
    );
  if (
    !assistantRow ||
    assistantRow.role !== "ASSISTANT" ||
    assistantRow.replyToMessageId !== message.replyToMessageId ||
    Date.parse(assistantRow.createdAt) > Date.parse(message.createdAt)
  )
    throw Error("COPILOT_PROPOSAL_PARENT_INVALID");
  const messages = ctx.database.collection<CopilotMessage & { _id: string }>(
    "copilotMessages",
  );
  if (kind === "CONTEXT_CHECKPOINT") {
    const parent = await messages.findOne(
      {
        _id: message.replyToMessageId!,
        storeId: message.storeId,
        ownerId: message.ownerId,
        conversationId: message.conversationId,
        role: "USER",
      },
      { session: ctx.session },
    );
    if (!parent) throw Error("COPILOT_CONTEXT_PARENT_INVALID");
    const { _id, ...parentPayload } = parent;
    if (_id !== parentPayload.id) throw Error("COPILOT_CONTEXT_PARENT_INVALID");
    await validateStoredContext(
      ctx.database,
      decoded,
      copilotMessageSchema.parse(parentPayload),
      ctx.session,
    );
  }
  if (kind === "KNOWLEDGE_SUGGESTION") {
    const suggestion = readKnowledgeSuggestion(decoded).content.suggestion;
    const sources = [];
    for (const reference of suggestion.sources) {
      const row = await messages.findOne(
        {
          _id: reference.messageId,
          storeId: message.storeId,
          ownerId: message.ownerId,
          conversationId: message.conversationId,
          role: "USER",
        },
        { session: ctx.session },
      );
      if (!row) throw Error("COPILOT_KNOWLEDGE_QUOTE_INVALID");
      const { _id, ...payload } = row;
      const source = copilotMessageSchema.parse(payload);
      if (_id !== source.id) throw Error("COPILOT_KNOWLEDGE_QUOTE_INVALID");
      if (
        await messages.findOne(
          {
            storeId: message.storeId,
            ownerId: message.ownerId,
            conversationId: message.conversationId,
            role: "USER",
            supersedesMessageId: source.id,
          },
          { session: ctx.session },
        )
      )
        throw Error("COPILOT_KNOWLEDGE_SOURCE_SUPERSEDED");
      sources.push(source);
    }
    validateKnowledgeSuggestionSources(
      suggestion,
      message.replyToMessageId!,
      sources,
    );
  }
  const existing = await messages.findOne(
    { _id: message.id },
    { session: ctx.session },
  );
  if (existing) {
    const { _id, ...saved } = existing;
    void _id;
    if (
      JSON.stringify(copilotMessageSchema.parse(saved)) !==
      JSON.stringify(message)
    )
      throw Error("COPILOT_PROPOSAL_IDENTITY_CONFLICT");
    return;
  }
  await messages.insertOne(
    { _id: message.id, ...message },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId: message.storeId,
    entityType: "copilot_message",
    entityId: message.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
}
