import {
  canAccessIllustrationGeneration,
  serializeIllustrationGeneration,
  type IllustrationGenerationDocument,
  type LayoutIllustrationGenerationService,
} from "./layout-illustration-generation";
import {
  applyEmailDecision,
  canAccessEmailDecision,
  serializeEmailDecision,
  type EmailDecisionDocument,
} from "../intake/email-decision-sync";
import {
  applyLayoutIllustration,
  canAccessLayoutIllustration,
  serializeLayoutIllustration,
  type LayoutIllustrationDocument,
} from "./layout-illustration-store";
import {
  canAccessDecision,
  applyDecision,
  serializeDecision,
  type DecisionDocument,
} from "./decision-store";
import {
  canAccessKnowledge,
  applyKnowledge,
  serializeKnowledge,
  type KnowledgeDocument,
} from "./knowledge-store";
import {
  copilotConversationSchema,
  copilotConversationCommandSchema,
  copilotConversationFromCommand,
  copilotConversationMetadataEqual,
  copilotMessageIsDeleted,
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
import { createMongoSyncChangeService } from "../sync/sync-change-service";
import {
  canAccessActionExecution,
  applyActionExecution,
  serializeActionExecution,
  type ActionExecutionDocument,
} from "./action-execution-store";
export const chatCollections = {
  copilot_layout_illustration_generation:
    "copilotLayoutIllustrationGenerations",
  copilot_layout_illustration: "copilotLayoutIllustrations",
  email_intake_decision: "emailIntakeDecisions",
  copilot_action_execution: "actionExecutions",
  copilot_conversation: "copilotConversations",
  copilot_message: "copilotMessages",
  copilot_knowledge: "copilotKnowledge",
  copilot_decision: "copilotDecisions",
  copilot_execution_link: "copilotExecutionLinks",
};
export const isChatType = (type: string) =>
  Object.hasOwn(chatCollections, type);
export type ChatRecordDocument = (
  | IllustrationGenerationDocument
  | LayoutIllustrationDocument
  | EmailDecisionDocument
  | CopilotConversation
  | CopilotMessage
  | KnowledgeDocument
  | DecisionDocument
  | ExecutionLinkDocument
  | ActionExecutionDocument
) & {
  _id: string;
};
export function serializeChat(type: string, row: ChatRecordDocument) {
  if (type === "copilot_layout_illustration_generation")
    return serializeIllustrationGeneration(
      row as IllustrationGenerationDocument,
    );
  if (type === "copilot_layout_illustration")
    return serializeLayoutIllustration(row as LayoutIllustrationDocument);
  if (type === "email_intake_decision")
    return serializeEmailDecision(row as EmailDecisionDocument);
  if (type === "copilot_action_execution")
    return serializeActionExecution(row as ActionExecutionDocument);
  if (type === "copilot_execution_link")
    return serializeExecutionLink(row as ExecutionLinkDocument);
  if (type === "copilot_decision")
    return serializeDecision(row as DecisionDocument);
  if (type === "copilot_knowledge")
    return serializeKnowledge(row as KnowledgeDocument);
  const { _id, ...payload } = row;
  void _id;
  return type === "copilot_conversation"
    ? copilotConversationSchema.parse(payload)
    : copilotMessageSchema.parse(payload);
}
/** Older clients cannot parse deletion metadata or honour per-message hiding.
 * Project affected topics as archived without changing canonical business state. */
export function serializeChatForClient(
  type: string,
  row: ChatRecordDocument,
  supportsDeletion = false,
  supportsAnalyticsDestinations: boolean | 2 = false,
) {
  const record = serializeChat(type, row);
  if (type === "copilot_message") {
    const { analyticsDestinations, answerSources, ...body } =
      record as CopilotMessage;
    return {
      ...body,
      ...(supportsAnalyticsDestinations && analyticsDestinations
        ? { analyticsDestinations }
        : {}),
      ...(supportsAnalyticsDestinations === 2 && answerSources
        ? { answerSources }
        : {}),
    };
  }
  if (type !== "copilot_conversation" || supportsDeletion) return record;
  const { deletedAt, deletedMessageIds, ...legacy } =
    record as CopilotConversation;
  return {
    ...legacy,
    ...(deletedAt || deletedMessageIds?.length
      ? { status: "ARCHIVED" as const }
      : {}),
  };
}
/** Runs before processed-command replay: cached private responses never bypass actor checks. */
export async function canAccessChatCommand(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  if (c.entityType === "copilot_layout_illustration_generation")
    return canAccessIllustrationGeneration(db, storeId, ownerId, c);
  if (c.entityType === "copilot_layout_illustration")
    return canAccessLayoutIllustration(db, storeId, ownerId, c);
  if (c.entityType === "email_intake_decision")
    return canAccessEmailDecision(db, storeId, ownerId, c);
  if (c.entityType === "copilot_action_execution")
    return canAccessActionExecution(db, storeId, ownerId, c);
  if (c.entityType === "copilot_execution_link")
    return canAccessExecutionLink(db, storeId, ownerId, c);
  if (c.entityType === "copilot_decision")
    return canAccessDecision(db, storeId, ownerId, c);
  if (c.entityType === "copilot_knowledge")
    return canAccessKnowledge(db, storeId, ownerId, c);
  if (!ownerId || !isChatType(c.entityType)) return false;
  const parsed = (
    c.entityType === "copilot_conversation"
      ? copilotConversationCommandSchema
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
  now: () => Date = () => new Date(),
  illustrationGeneration?: Pick<LayoutIllustrationGenerationService, "apply">,
): Promise<CommandMutationResult> {
  if (c.entityType === "copilot_layout_illustration_generation")
    return illustrationGeneration
      ? illustrationGeneration.apply(ctx, storeId, ownerId, c, requestId)
      : {
          resultStatus: "REJECTED",
          resultingVersion: null,
          responseJson: {
            error: {
              code: "LAYOUT_ILLUSTRATION_DISABLED",
              messageFr:
                "La génération d’illustrations n’est pas activée. Aucune image n’a été demandée.",
              retryable: false,
              requestId,
            },
          },
        };
  if (c.entityType === "copilot_layout_illustration")
    return applyLayoutIllustration(
      ctx,
      storeId,
      ownerId,
      c,
      requestId,
      changes,
    );
  if (c.entityType === "email_intake_decision")
    return applyEmailDecision(
      ctx,
      storeId,
      ownerId,
      c,
      requestId,
      changes,
      now,
    );
  if (c.entityType === "copilot_action_execution")
    return applyActionExecution(ctx, storeId, ownerId, c, requestId, changes);
  if (c.entityType === "copilot_execution_link")
    return applyExecutionLink(ctx, storeId, ownerId, c, requestId, changes);
  if (c.entityType === "copilot_decision")
    return applyDecision(ctx, storeId, ownerId, c, requestId, changes);
  if (c.entityType === "copilot_knowledge")
    return applyKnowledge(ctx, storeId, ownerId, c, requestId, changes);
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
    parsedCommand = (
      type === "copilot_conversation"
        ? copilotConversationCommandSchema
        : copilotMessageSchema
    ).parse(c.payload);
  let e =
    type === "copilot_conversation"
      ? copilotConversationFromCommand(parsedCommand)
      : (parsedCommand as CopilotMessage);
  const collection = ctx.database.collection<ChatRecordDocument>(
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
    let v = e as CopilotConversation;
    let expectedVersion = c.expectedRemoteVersion ?? null;
    const previous = old
      ? (serializeChat(type, old) as CopilotConversation)
      : null;
    if (
      previous &&
      ((previous.deletedAt &&
        (previous.deletedAt !== v.deletedAt || v.status !== "ARCHIVED")) ||
        (previous.deletedMessageIds ?? []).some(
          (id) => !v.deletedMessageIds?.includes(id),
        ))
    )
      return reject("COPILOT_DELETION_IMMUTABLE");
    const added = (v.deletedMessageIds ?? []).filter(
      (id) => !previous?.deletedMessageIds?.includes(id),
    );
    if (added.length) {
      const count = await ctx.database
        .collection<CopilotMessage & { _id: string }>("copilotMessages")
        .countDocuments(
          {
            _id: { $in: added },
            storeId,
            ownerId,
            conversationId: v.id,
            role: { $in: ["USER", "ASSISTANT"] },
          },
          { session: ctx.session },
        );
      if (count !== added.length)
        return reject("COPILOT_DELETION_TARGET_INVALID");
    }

    // An explicit manual rename can supersede only intervening automatic titles.
    // Archive/deletion/other-device edits retain their ordinary conflict handling.
    if (
      previous &&
      expectedVersion !== null &&
      expectedVersion !== previous.version &&
      "titleIntent" in parsedCommand &&
      parsedCommand.titleIntent === "MANUAL" &&
      v.version === expectedVersion + 1
    ) {
      const history = ctx.database.collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        conversationId: string;
        version: number;
        titleOrigin?: string;
        conversation: CopilotConversation;
      }>("copilotConversationHistory");
      const scope = { storeId, ownerId, conversationId: v.id };
      const base = await history.findOne(
        { ...scope, version: expectedVersion },
        { session: ctx.session },
      );
      if (
        base &&
        v.createdAt === base.conversation.createdAt &&
        copilotConversationMetadataEqual(
          { ...v, title: base.conversation.title },
          base.conversation,
        ) &&
        (await history.countDocuments(
          {
            ...scope,
            version: { $gt: expectedVersion, $lte: previous.version },
            titleOrigin: "AUTOMATIC",
          },
          { session: ctx.session },
        )) ===
          previous.version - expectedVersion
      ) {
        v = copilotConversationSchema.parse({
          ...previous,
          title: v.title,
          version: previous.version + 1,
          updatedAt: new Date(
            Math.max(Date.parse(previous.updatedAt), Date.parse(v.updatedAt)),
          ).toISOString(),
        });
        e = v;
        expectedVersion = previous.version;
      }
    }
    if (expectedVersion !== (old?.version ?? null))
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
    await writeConversationVersion(
      ctx,
      v,
      c.commandId,
      ("titleIntent" in parsedCommand &&
        parsedCommand.titleIntent === "MANUAL") ||
        (previous && previous.title !== v.title)
        ? "MANUAL"
        : undefined,
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
/** Shared canonical metadata/history writer; caller owns the authenticated transaction and version check. */
async function writeConversationVersion(
  ctx: MongoCommandMutationContext,
  conversation: CopilotConversation,
  actionId: string,
  titleOrigin?: "MANUAL" | "AUTOMATIC",
) {
  if (!ctx.session.inTransaction())
    throw Error("COPILOT_TITLE_TRANSACTION_REQUIRED");
  await ctx.database
    .collection<ChatRecordDocument>("copilotConversations")
    .replaceOne({ _id: conversation.id }, conversation, {
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
      titleOrigin?: "MANUAL" | "AUTOMATIC";
    }>("copilotConversationHistory")
    .insertOne(
      {
        _id: actionId,
        storeId: conversation.storeId,
        ownerId: conversation.ownerId,
        conversationId: conversation.id,
        version: conversation.version,
        conversation,
        ...(titleOrigin ? { titleOrigin } : {}),
      },
      { session: ctx.session },
    );
}

/** Presentation only: canonical title/history/change stream, never a business writer or a new entity. */
export async function updateGeneratedConversationTitle(
  db: Db,
  authorize: () => Promise<{
    storeId: string;
    ownerId: string;
    canRespond: boolean;
  }>,
  reply: CopilotMessage,
  title: string,
  expectedTitle: string,
) {
  const name = title.trim();
  if (!name || name.length > 80 || /[\r\n\p{Cc}]/u.test(name)) return false;
  const authority = await authorize();
  if (
    !authority.canRespond ||
    authority.storeId !== reply.storeId ||
    authority.ownerId !== reply.ownerId
  )
    return false;
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const scope = { storeId: authority.storeId, ownerId: authority.ownerId };
      const row = await db
        .collection<ChatRecordDocument>("copilotConversations")
        .findOne({ _id: reply.conversationId, ...scope }, { session });
      if (!row) return false;
      const conversation = serializeChat(
        "copilot_conversation",
        row,
      ) as CopilotConversation;
      if (
        conversation.status !== "ACTIVE" ||
        conversation.title !== expectedTitle ||
        conversation.title === name ||
        copilotMessageIsDeleted(reply, conversation)
      )
        return false;
      const messages = db.collection<CopilotMessage & { _id: string }>(
        "copilotMessages",
      );
      const savedReply = await messages.findOne(
        { _id: reply.id, conversationId: reply.conversationId, ...scope },
        { session },
      );
      if (
        !savedReply ||
        savedReply.role !== "ASSISTANT" ||
        savedReply.replyToMessageId !== reply.replyToMessageId
      )
        return false;
      const history = db.collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        conversationId: string;
        version: number;
        titleOrigin?: "MANUAL" | "AUTOMATIC";
        conversation: CopilotConversation;
      }>("copilotConversationHistory");
      if (await history.findOne({ _id: reply.id }, { session })) return false;
      const lastTitle = await history.findOne(
        {
          conversationId: conversation.id,
          ...scope,
          titleOrigin: { $exists: true },
        },
        { session, sort: { version: -1 } },
      );
      if (
        lastTitle?.titleOrigin === "MANUAL" ||
        (!lastTitle && conversation.title !== "Nouvelle conversation") ||
        (lastTitle && lastTitle.conversation.title !== conversation.title)
      )
        return false;
      const updated = copilotConversationSchema.parse({
        ...conversation,
        title: name,
        version: conversation.version + 1,
        updatedAt: new Date(
          Math.max(
            Date.parse(reply.createdAt),
            Date.parse(conversation.updatedAt),
          ),
        ).toISOString(),
      });
      const ctx = { database: db, session };
      await writeConversationVersion(ctx, updated, reply.id, "AUTOMATIC");
      await createMongoSyncChangeService().append(ctx, {
        storeId: updated.storeId,
        entityType: "copilot_conversation",
        entityId: updated.id,
        entityVersion: updated.version,
        operation: "UPSERT",
      });
      return true;
    });
  } finally {
    await session.endSession();
  }
}

export async function chatBootstrap(
  db: Db,
  storeId: string,
  ownerId: string,
  session: ClientSession,
  supportsDeletion = false,
  supportsAnalyticsDestinations: boolean | 2 = false,
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
    ].map((c) =>
      serializeChatForClient("copilot_conversation", c, supportsDeletion),
    ),
    copilotMessages: messages
      .reverse()
      .map((m) =>
        serializeChatForClient(
          "copilot_message",
          m,
          supportsDeletion,
          supportsAnalyticsDestinations,
        ),
      ),
    copilotHistoryPartial: true,
  };
}
import {
  canAccessExecutionLink,
  applyExecutionLink,
  serializeExecutionLink,
  type ExecutionLinkDocument,
} from "./execution-link-store";

/** Version two adds independently bounded citation snapshots to analytical navigation. */
export function copilotPresentationVersion(value: unknown): boolean | 2 {
  return value === "2" ? 2 : value === "1";
}
