import { createHash } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import {
  layoutIllustrationPreparationSchema,
  sameLayoutIllustrationPreparation,
  copilotConversationSchema,
  copilotMessageSchema,
  copilotMessageIsDeleted,
  readStoreLayoutScenarioCard,
  type LayoutIllustrationPreparation,
} from "@fl-copilot/domain";
import { bindLayoutIllustrationSource } from "@fl-copilot/commercial-core";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import {
  serializeStoreLayoutRevision,
  type StoreLayoutRevisionDocument,
} from "../store-layout-sync";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
export type LayoutIllustrationDocument = LayoutIllustrationPreparation & {
  _id: string;
};
export function serializeLayoutIllustration(row: LayoutIllustrationDocument) {
  const { _id, ...payload } = row,
    value = layoutIllustrationPreparationSchema.parse(payload);
  if (value.id !== _id) throw Error("LAYOUT_ILLUSTRATION_ID_INVALID");
  return value;
}
/** Before cached command replay as well as mutation: revocation/deletion never exposes an old ACK. */
async function sources(
  db: Db,
  e: LayoutIllustrationPreparation,
  session?: ClientSession,
) {
  const scope = {
      storeId: e.storeId,
      ownerId: e.ownerId,
      conversationId: e.conversationId,
    },
    opts = { session };
  const member = await db
    .collection("storeMemberships")
    .findOne({ storeId: e.storeId, userId: e.ownerId, active: true }, opts);
  const topicRow = await db
    .collection<{ _id: string } & Record<string, unknown>>(
      "copilotConversations",
    )
    .findOne(
      { _id: e.conversationId, storeId: e.storeId, ownerId: e.ownerId },
      opts,
    );
  if (!member || !topicRow) return null;
  const { _id: tid, ...topicPayload } = topicRow;
  void tid;
  const parsedTopic = copilotConversationSchema.safeParse(topicPayload);
  if (!parsedTopic.success) return null;
  const topic = parsedTopic.data;
  if (topic.status !== "ACTIVE" || topic.deletedAt) return null;
  const cardRow = await db
    .collection<{ _id: string } & Record<string, unknown>>("copilotMessages")
    .findOne({ _id: e.scenarioMessageId, ...scope }, opts);
  const assistantRow = await db
    .collection<{ _id: string } & Record<string, unknown>>("copilotMessages")
    .findOne({ _id: e.assistantMessageId, ...scope }, opts);
  if (!cardRow || !assistantRow) return null;
  const { _id: cid, ...cardPayload } = cardRow,
    { _id: aid, ...assistantPayload } = assistantRow;
  void cid;
  void aid;
  const assistantParse = copilotMessageSchema.safeParse(assistantPayload);
  if (!assistantParse.success) return null;
  const assistant = assistantParse.data;
  let parsedCard: ReturnType<typeof readStoreLayoutScenarioCard>;
  try {
    parsedCard = readStoreLayoutScenarioCard(cardPayload);
  } catch {
    return null;
  }
  const { message, content } = parsedCard;
  if (
    copilotMessageIsDeleted(message, topic) ||
    copilotMessageIsDeleted(assistant, topic) ||
    assistant.role !== "ASSISTANT" ||
    assistant.replyToMessageId !== message.replyToMessageId ||
    content.assistantMessageId !== assistant.id ||
    message.createdAt < assistant.createdAt
  )
    return null;
  const row = await db
    .collection<StoreLayoutRevisionDocument>("storeLayoutRevisions")
    .findOne({ _id: e.physicalRevisionId, storeId: e.storeId }, opts);
  if (!row) return null;
  try {
    const { binding, source } = await bindLayoutIllustrationSource(
      scope,
      message,
      serializeStoreLayoutRevision(row).plan,
      async (text) =>
        `sha256:${createHash("sha256").update(text).digest("hex")}`,
    );
    const { schemaVersion, ...fields } = binding;
    void schemaVersion;
    const expected = layoutIllustrationPreparationSchema.parse({
      ...fields,
      id: e.id,
      version: 1,
      intent: "PREPARATION_ONLY",
      createdAt: e.createdAt,
    });
    return source.status === "READY" &&
      sameLayoutIllustrationPreparation(expected, e)
      ? expected
      : null;
  } catch {
    return null;
  }
}
export async function canAccessLayoutIllustration(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
  session?: ClientSession,
) {
  const p = layoutIllustrationPreparationSchema.safeParse(c.payload);
  if (
    !ownerId ||
    !p.success ||
    p.data.ownerId !== ownerId ||
    p.data.storeId !== storeId ||
    p.data.id !== c.entityId ||
    c.entityType !== "copilot_layout_illustration" ||
    c.type !== "COPILOT_LAYOUT_ILLUSTRATION_PREPARE" ||
    c.expectedRemoteVersion != null
  )
    return false;
  const old = await db
    .collection<LayoutIllustrationDocument>("copilotLayoutIllustrations")
    .findOne({ _id: c.entityId }, { session });
  if (
    old &&
    !sameLayoutIllustrationPreparation(serializeLayoutIllustration(old), p.data)
  )
    return false;
  return !!(await sources(db, p.data, session));
}
export async function applyLayoutIllustration(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string,
  c: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  if (
    !(await canAccessLayoutIllustration(
      ctx.database,
      storeId,
      ownerId,
      c,
      ctx.session,
    ))
  )
    return {
      resultStatus: "REJECTED",
      resultingVersion: null,
      responseJson: {
        error: {
          code: "LAYOUT_ILLUSTRATION_SOURCE_INVALID",
          messageFr:
            "La préparation reste sur cet appareil. Vérifiez la conversation et le plan d’origine ; aucune image n’a été générée.",
          retryable: false,
          requestId,
        },
      },
    };
  const e = layoutIllustrationPreparationSchema.parse(c.payload),
    col = ctx.database.collection<LayoutIllustrationDocument>(
      "copilotLayoutIllustrations",
    );
  if (!(await col.findOne({ _id: e.id }, { session: ctx.session }))) {
    await col.insertOne({ _id: e.id, ...e }, { session: ctx.session });
    await changes.append(ctx, {
      storeId,
      entityType: "copilot_layout_illustration",
      entityId: e.id,
      entityVersion: 1,
      operation: "UPSERT",
    });
  }
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: { remoteEntity: e },
  };
}
