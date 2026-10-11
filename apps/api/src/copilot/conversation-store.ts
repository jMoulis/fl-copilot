import {
  copilotConversationSchema,
  copilotMessageSchema,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { Db, ClientSession } from "mongodb";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
export const chatCollections = {
  copilot_conversation: "copilotConversations",
  copilot_message: "copilotMessages",
};
export const isChatType = (type: string) =>
  Object.hasOwn(chatCollections, type);
export type ChatRecordDocument = (CopilotConversation | CopilotMessage) & {
  _id: string;
};
export function serializeChat(type: string, row: ChatRecordDocument) {
  const { _id, ...payload } = row;
  void _id;
  return type === "copilot_conversation"
    ? copilotConversationSchema.parse(payload)
    : copilotMessageSchema.parse(payload);
}
/** Runs before processed-command replay: cached private responses never bypass actor checks. */
export async function canAccessChatCommand(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  if (!ownerId || !isChatType(c.entityType)) return false;
  const parsed = (
    c.entityType === "copilot_conversation"
      ? copilotConversationSchema
      : copilotMessageSchema
  ).safeParse(c.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.ownerId !== ownerId ||
    parsed.data.id !== c.entityId
  )
    return false;
  if (
    c.entityType === "copilot_message" &&
    (parsed.data as CopilotMessage).role !== "USER"
  )
    return false;
  const expected =
    c.entityType === "copilot_conversation"
      ? "COPILOT_CONVERSATION_UPSERT"
      : "COPILOT_MESSAGE_APPEND";
  if (c.type !== expected) return false;
  const old = await db
    .collection<ChatRecordDocument>(
      chatCollections[c.entityType as keyof typeof chatCollections],
    )
    .findOne({ _id: c.entityId });
  if (
    old &&
    c.entityType === "copilot_message" &&
    JSON.stringify(serializeChat(c.entityType, old)) !==
      JSON.stringify(parsed.data)
  )
    return false;
  return !old || (old.storeId === storeId && old.ownerId === ownerId);
}
export class ChatParentPendingError extends Error {}
export async function applyChatCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string,
  c: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr: "Cette modification de conversation doit être vérifiée.",
        retryable: false,
        requestId,
      },
    },
  });
  if (!(await canAccessChatCommand(ctx.database, storeId, ownerId, c)))
    return reject("COPILOT_HISTORY_ACCESS_INVALID");
  const type = c.entityType as keyof typeof chatCollections,
    e = (
      type === "copilot_conversation"
        ? copilotConversationSchema
        : copilotMessageSchema
    ).parse(c.payload),
    collection = ctx.database.collection<ChatRecordDocument>(
      chatCollections[type],
    );
  const old = await collection.findOne({ _id: e.id }, { session: ctx.session });
  if (old && (old.storeId !== storeId || old.ownerId !== ownerId))
    return reject("COPILOT_HISTORY_ACCESS_INVALID");
  if (type === "copilot_message") {
    const m = e as CopilotMessage;
    if (old) {
      if (JSON.stringify(serializeChat(type, old)) !== JSON.stringify(m))
        return reject("COPILOT_MESSAGE_IMMUTABLE");
      return {
        resultStatus: "APPLIED",
        resultingVersion: 1,
        responseJson: { remoteEntity: m },
      };
    }
    if (c.expectedRemoteVersion != null)
      return reject("COPILOT_MESSAGE_VERSION_INVALID");
    const parent = await ctx.database
      .collection<CopilotConversation & { _id: string }>("copilotConversations")
      .findOne({ _id: m.conversationId }, { session: ctx.session });
    if (!parent)
      throw new ChatParentPendingError("COPILOT_CONVERSATION_PENDING");
    if (parent.storeId !== storeId || parent.ownerId !== ownerId)
      return reject("COPILOT_HISTORY_ACCESS_INVALID");
    if (parent.status !== "ACTIVE")
      return reject("COPILOT_CONVERSATION_ARCHIVED");
    for (const ref of [m.replyToMessageId, m.supersedesMessageId].filter(
      Boolean,
    )) {
      const p = await ctx.database
        .collection<CopilotMessage & { _id: string }>("copilotMessages")
        .findOne({ _id: ref! }, { session: ctx.session });
      if (!p)
        throw new ChatParentPendingError("COPILOT_MESSAGE_PARENT_PENDING");
      if (
        p.ownerId !== ownerId ||
        p.storeId !== storeId ||
        p.conversationId !== m.conversationId ||
        (ref === m.supersedesMessageId && p.role !== "USER")
      )
        return reject("COPILOT_MESSAGE_PARENT_INVALID");
    }
    for (const a of m.attachments) {
      const source = await ctx.database
        .collection<{ _id: string; storeId: string }>("sourceDocuments")
        .findOne({ _id: a.sourceDocumentId }, { session: ctx.session });
      if (source && source.storeId !== storeId)
        return reject("COPILOT_ATTACHMENT_SCOPE_INVALID");
    }
    await collection.insertOne({ _id: e.id, ...m }, { session: ctx.session });
  } else {
    const v = e as CopilotConversation;
    if ((c.expectedRemoteVersion ?? null) !== (old?.version ?? null))
      return {
        resultStatus: "CONFLICT",
        resultingVersion: old?.version ?? null,
        responseJson: {
          ...(old ? { remoteEntity: serializeChat(type, old) } : {}),
          error: {
            code: "COPILOT_CONVERSATION_VERSION_CONFLICT",
            messageFr:
              "Le titre ou l’archivage a changé sur un autre appareil. Votre version est conservée.",
            retryable: false,
            requestId,
          },
        },
      };
    if (
      v.version !== (old?.version ?? 0) + 1 ||
      (old && (old.createdAt !== v.createdAt || old.ownerId !== v.ownerId))
    )
      return reject("COPILOT_CONVERSATION_VERSION_INVALID");
    await collection.replaceOne({ _id: e.id }, v, {
      upsert: true,
      session: ctx.session,
    });
    await ctx.database
      .collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        conversationId: string;
        version: number;
        conversation: CopilotConversation;
      }>("copilotConversationHistory")
      .insertOne(
        {
          _id: c.commandId,
          storeId,
          ownerId,
          conversationId: e.id,
          version: e.version,
          conversation: v,
        },
        { session: ctx.session },
      );
  }
  await changes.append(ctx, {
    storeId,
    entityType: type,
    entityId: e.id,
    entityVersion: e.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: e.version,
    responseJson: { remoteEntity: e },
  };
}
export async function chatBootstrap(
  db: Db,
  storeId: string,
  ownerId: string,
  session: ClientSession,
) {
  const scope = { storeId, ownerId };
  const messages = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .find(scope, { session })
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .toArray();
  const recent = await db
    .collection<CopilotConversation & { _id: string }>("copilotConversations")
    .find(scope, { session })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(100)
    .toArray();
  const extra = await db
    .collection<CopilotConversation & { _id: string }>("copilotConversations")
    .find(
      {
        ...scope,
        _id: { $in: [...new Set(messages.map((m) => m.conversationId))] },
      },
      { session },
    )
    .toArray();
  return {
    copilotHistoryOwnerId: ownerId,
    copilotConversations: [
      ...new Map([...recent, ...extra].map((c) => [c.id, c])).values(),
    ].map((c) => serializeChat("copilot_conversation", c)),
    copilotMessages: messages
      .reverse()
      .map((m) => serializeChat("copilot_message", m)),
    copilotHistoryPartial: true,
  };
}
