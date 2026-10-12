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
