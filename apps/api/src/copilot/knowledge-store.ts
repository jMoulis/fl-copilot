import {
  copilotKnowledgeSchema,
  type CopilotKnowledge,
} from "@fl-copilot/domain";
import type { Db } from "mongodb";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
export class KnowledgeParentPendingError extends Error {}
export type KnowledgeDocument = CopilotKnowledge & { _id: string };
export function serializeKnowledge(row: KnowledgeDocument) {
  const { _id, ...value } = row;
  const parsed = copilotKnowledgeSchema.parse(value);
  if (_id !== parsed.id) throw Error("COPILOT_KNOWLEDGE_IDENTITY_INVALID");
  return parsed;
}
export async function canAccessKnowledge(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
) {
  const p = copilotKnowledgeSchema.safeParse(c.payload);
  if (
    !p.success ||
    !ownerId ||
    c.type !== "COPILOT_KNOWLEDGE_UPSERT" ||
    c.entityType !== "copilot_knowledge" ||
    p.data.id !== c.entityId ||
    p.data.ownerId !== ownerId ||
    p.data.storeId !== storeId
  )
    return false;
  const old = await db
    .collection<KnowledgeDocument>("copilotKnowledge")
    .findOne({ _id: c.entityId });
  return !old || (old.storeId === storeId && old.ownerId === ownerId);
}
export async function applyKnowledge(
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
        messageFr: "Cette connaissance doit être vérifiée.",
        retryable: false,
        requestId,
      },
    },
  });
  if (!(await canAccessKnowledge(ctx.database, storeId, ownerId, c)))
    return reject("COPILOT_KNOWLEDGE_SCOPE_INVALID");
  const e = copilotKnowledgeSchema.parse(c.payload),
    col = ctx.database.collection<KnowledgeDocument>("copilotKnowledge");
  const old = await col.findOne({ _id: e.id }, { session: ctx.session });
  if ((c.expectedRemoteVersion ?? null) !== (old?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: old?.version ?? null,
      responseJson: {
        ...(old ? { remoteEntity: serializeKnowledge(old) } : {}),
        error: {
          code: "COPILOT_KNOWLEDGE_CONFLICT",
          messageFr:
            "Cette connaissance a changé sur un autre appareil. Comparez les versions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    e.version !== (old?.version ?? 0) + 1 ||
    (old &&
      (old.createdAt !== e.createdAt ||
        old.sourceMessageId !== e.sourceMessageId))
  )
    return reject("COPILOT_KNOWLEDGE_REVISION_INVALID");
  if (e.sourceMessageId && !old) {
    const source = await ctx.database
      .collection<{
        _id: string;
        storeId: string;
        ownerId: string;
        role: string;
      }>("copilotMessages")
      .findOne({ _id: e.sourceMessageId }, { session: ctx.session });
    if (!source)
      throw new KnowledgeParentPendingError("COPILOT_KNOWLEDGE_SOURCE_PENDING");
    if (
      source.storeId !== storeId ||
      source.ownerId !== ownerId ||
      source.role !== "USER"
    )
      return reject("COPILOT_KNOWLEDGE_SOURCE_UNAVAILABLE");
  }
  if (
    !old &&
    (await col.countDocuments(
      { storeId, ownerId },
      { session: ctx.session, limit: 200 },
    )) >= 200
  )
    return reject("COPILOT_KNOWLEDGE_LIMIT");
  await col.replaceOne({ _id: e.id, storeId, ownerId }, e, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("copilotKnowledgeHistory").insertOne(
    {
      storeId,
      ownerId,
      knowledgeId: e.id,
      version: e.version,
      commandId: c.commandId,
      status: e.status,
      confirmedBy: e.confirmedBy,
      updatedAt: e.updatedAt,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "copilot_knowledge",
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
export async function readKnowledge(db: Db, storeId: string, ownerId: string) {
  const rows = await db
    .collection<KnowledgeDocument>("copilotKnowledge")
    .find({ storeId, ownerId, status: "ACTIVE" })
    .sort({ updatedAt: -1, _id: 1 })
    .maxTimeMS(2000)
    .limit(21)
    .toArray();
  const entries = rows.slice(0, 20).map(serializeKnowledge);
  if (
    entries.some(
      (e) =>
        e.storeId !== storeId || e.ownerId !== ownerId || e.status !== "ACTIVE",
    )
  )
    throw Error("COPILOT_KNOWLEDGE_SCOPE_INVALID");
  return { status: "AVAILABLE" as const, partial: rows.length > 20, entries };
}
