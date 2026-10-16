import { createHash } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import {
  copilotMessageSchema,
  contextCheckpointInputSchema,
  contextCheckpointContentSchema,
  validateContextNotes,
  readContextCheckpoint,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { readSupersededHistoryIds } from "./history-supersession.js";
import { readAttachedSources } from "./attached-sources.js";
function fingerprint(source: CopilotMessage) {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}
function sourceManifest(
  sources: readonly CopilotMessage[],
  previous?: ReturnType<typeof readContextCheckpoint>["content"],
) {
  const direct = [
    ...new Set(
      sources.flatMap((s) => s.attachments.map((a) => a.sourceDocumentId)),
    ),
  ].sort();
  const all = [...new Set([...direct, ...(previous?.sourceDocumentIds ?? [])])];
  return {
    sourceDocumentIds: all.slice(0, 90),
    sourceReferencesOmitted:
      !!previous?.sourceReferencesOmitted || all.length > 90,
  };
}
async function readPrevious(
  db: Db,
  parent: CopilotMessage,
  id: string | null,
  session?: ClientSession,
) {
  if (!id) return undefined;
  const row = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne(
      {
        _id: id,
        storeId: parent.storeId,
        ownerId: parent.ownerId,
        conversationId: parent.conversationId,
        role: "TOOL",
        createdAt: { $lte: parent.createdAt },
      },
      { session, maxTimeMS: 2000 },
    );
  if (!row) throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  const { _id, ...payload } = row;
  const previous = readContextCheckpoint(payload);
  if (_id !== previous.message.id)
    throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  return previous.content;
}
/** Server-owned sources only, with exact private scope and current-turn cutoff. */
async function readNoteSources(
  db: Db,
  parent: CopilotMessage,
  raw: unknown,
  session?: ClientSession,
) {
  if (parent.role !== "USER") throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  const input = contextCheckpointInputSchema.parse(raw);
  const ids = [...new Set(input.notes.map((n) => n.sourceMessageId))];
  const rows = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .find(
      {
        _id: { $in: ids },
        storeId: parent.storeId,
        ownerId: parent.ownerId,
        conversationId: parent.conversationId,
        role: { $in: ["USER", "ASSISTANT"] },
        createdAt: { $lte: parent.createdAt },
      },
      { session },
    )
    .maxTimeMS(2000)
    .limit(8)
    .toArray();
  const sources = rows.map(({ _id, ...payload }) => {
    const m = copilotMessageSchema.parse(payload);
    if (
      _id !== m.id ||
      !ids.includes(m.id) ||
      m.storeId !== parent.storeId ||
      m.ownerId !== parent.ownerId ||
      m.conversationId !== parent.conversationId ||
      Date.parse(m.createdAt) > Date.parse(parent.createdAt)
    )
      throw Error("COPILOT_CONTEXT_SCOPE_INVALID");
    return m;
  });
  validateContextNotes(input, sources);
  const superseded = await readSupersededHistoryIds(
    db,
    parent,
    sources,
    session,
  );
  if (
    sources.some(
      (m) =>
        superseded.has(m.id) ||
        (m.replyToMessageId && superseded.has(m.replyToMessageId)),
    )
  )
    throw Error("COPILOT_CONTEXT_STALE");
  return { input, sources };
}
/** Read-only preparation; commit revalidates this independently inside the reply transaction. */
export async function prepareContextCheckpoint(
  db: Db,
  parent: CopilotMessage,
  raw: unknown,
) {
  const { input } = await readNoteSources(
    db,
    copilotMessageSchema.parse(parent),
    raw,
  );
  return { ...input, evidence: [] as never[] };
}
export async function buildContextCheckpoint(
  db: Db,
  assistant: CopilotMessage,
  parent: CopilotMessage,
  raw: unknown,
  previousCheckpointId: string | null,
  session: ClientSession,
) {
  const { input, sources } = await readNoteSources(db, parent, raw, session);
  if (
    assistant.role !== "ASSISTANT" ||
    assistant.replyToMessageId !== parent.id ||
    assistant.storeId !== parent.storeId ||
    assistant.ownerId !== parent.ownerId ||
    assistant.conversationId !== parent.conversationId ||
    !session.inTransaction()
  )
    throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  const manifest = sourceManifest(
    [...sources, parent],
    await readPrevious(db, parent, previousCheckpointId, session),
  );
  const content = contextCheckpointContentSchema.parse({
    kind: "CONTEXT_CHECKPOINT",
    schemaVersion: 1,
    assistantMessageId: assistant.id,
    throughUserMessageId: parent.id,
    throughSourceHash: fingerprint(parent),
    previousCheckpointId,
    partial: true,
    notes: input.notes.map((n) => ({
      ...n,
      sourceHash: fingerprint(sources.find((s) => s.id === n.sourceMessageId)!),
    })),
    ...manifest,
  });
  const h = createHash("sha256")
    .update(`context-checkpoint/${assistant.id}`)
    .digest("hex");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return copilotMessageSchema.parse({
    ...assistant,
    id,
    role: "TOOL",
    attachments: [],
    createdAt: new Date(Date.parse(assistant.createdAt) + 4).toISOString(),
    text: JSON.stringify(content),
  });
}
/** Recheck complete source fingerprints, not just matching quotations. Never reuse stale notes. */
export async function validateStoredContext(
  db: Db,
  raw: unknown,
  parent: CopilotMessage,
  session?: ClientSession,
) {
  const artifact = readContextCheckpoint(raw);
  if (
    artifact.message.storeId !== parent.storeId ||
    artifact.message.ownerId !== parent.ownerId ||
    artifact.message.conversationId !== parent.conversationId
  )
    throw Error("COPILOT_CONTEXT_SCOPE_INVALID");
  const messages = db.collection<CopilotMessage & { _id: string }>(
    "copilotMessages",
  );
  const throughRow = await messages.findOne(
    {
      _id: artifact.content.throughUserMessageId,
      storeId: parent.storeId,
      ownerId: parent.ownerId,
      conversationId: parent.conversationId,
      role: "USER",
      createdAt: { $lte: parent.createdAt },
    },
    { session, maxTimeMS: 2000 },
  );
  if (!throughRow) throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  const { _id: throughKey, ...throughPayload } = throughRow;
  const through = copilotMessageSchema.parse(throughPayload);
  if (
    throughKey !== through.id ||
    through.id !== artifact.content.throughUserMessageId ||
    through.storeId !== parent.storeId ||
    through.ownerId !== parent.ownerId ||
    through.conversationId !== parent.conversationId ||
    through.role !== "USER" ||
    Date.parse(through.createdAt) > Date.parse(artifact.message.createdAt)
  )
    throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  const throughSuperseded = await readSupersededHistoryIds(
    db,
    parent,
    [through],
    session,
  );
  if (
    fingerprint(through) !== artifact.content.throughSourceHash ||
    throughSuperseded.has(through.id)
  )
    throw Error("COPILOT_CONTEXT_STALE");
  const previous = await readPrevious(
    db,
    through,
    artifact.content.previousCheckpointId,
    session,
  );
  const draft = {
    notes: artifact.content.notes.map((n) => ({
      topic: n.topic,
      sourceMessageId: n.sourceMessageId,
      quote: n.quote,
    })),
  };
  const { sources } = await readNoteSources(db, parent, draft, session);
  if (
    sources.some((s) => Date.parse(s.createdAt) > Date.parse(through.createdAt))
  )
    throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  if (
    artifact.content.notes.some(
      (n) =>
        fingerprint(sources.find((s) => s.id === n.sourceMessageId)!) !==
        n.sourceHash,
    )
  )
    throw Error("COPILOT_CONTEXT_STALE");
  const manifest = sourceManifest([...sources, through], previous);
  if (
    JSON.stringify(manifest.sourceDocumentIds) !==
      JSON.stringify(artifact.content.sourceDocumentIds) ||
    manifest.sourceReferencesOmitted !==
      artifact.content.sourceReferencesOmitted
  )
    throw Error("COPILOT_CONTEXT_STALE");
  return {
    artifact,
    sources: [
      ...sources,
      ...(sources.some((s) => s.id === through.id) ? [] : [through]),
    ],
  };
}
export async function readConversationCheckpoint(
  db: Db,
  rawParent: CopilotMessage,
) {
  const parent = copilotMessageSchema.parse(rawParent);
  if (parent.role !== "USER") throw Error("COPILOT_CONTEXT_PARENT_INVALID");
  try {
    const row = await db
      .collection<CopilotMessage & { _id: string }>("copilotMessages")
      .find({
        storeId: parent.storeId,
        ownerId: parent.ownerId,
        conversationId: parent.conversationId,
        role: "TOOL",
        createdAt: { $lt: parent.createdAt },
        text: { $regex: '^\\{"kind":"CONTEXT_CHECKPOINT",' },
      })
      .sort({ createdAt: -1, _id: -1 })
      .maxTimeMS(2000)
      .limit(1)
      .next();
    if (!row)
      return {
        checkpoint: { status: "ABSENT" as const },
        sources: [],
        sourcesOmitted: false,
      };
    const { _id, ...payload } = row;
    if (_id !== payload.id) throw Error("COPILOT_CONTEXT_SCOPE_INVALID");
    const { artifact } = await validateStoredContext(db, payload, parent);
    const messages = db.collection<CopilotMessage & { _id: string }>(
      "copilotMessages",
    );
    const assistant = await messages.findOne(
      {
        _id: artifact.content.assistantMessageId,
        storeId: parent.storeId,
        ownerId: parent.ownerId,
        conversationId: parent.conversationId,
        role: "ASSISTANT",
        replyToMessageId: artifact.content.throughUserMessageId,
        createdAt: { $lte: artifact.message.createdAt },
      },
      { maxTimeMS: 2000 },
    );
    const through = await messages.findOne(
      {
        _id: artifact.content.throughUserMessageId,
        storeId: parent.storeId,
        ownerId: parent.ownerId,
        conversationId: parent.conversationId,
        role: "USER",
        createdAt: { $lt: parent.createdAt },
      },
      { maxTimeMS: 2000 },
    );
    if (!assistant || !through) throw Error("COPILOT_CONTEXT_PARENT_INVALID");
    const { _id: assistantKey, ...assistantPayload } = assistant;
    const originalAssistant = copilotMessageSchema.parse(assistantPayload);
    if (
      assistantKey !== originalAssistant.id ||
      originalAssistant.id !== artifact.content.assistantMessageId
    )
      throw Error("COPILOT_CONTEXT_PARENT_INVALID");
    return {
      checkpoint: {
        status: "AVAILABLE" as const,
        checkpointId: artifact.message.id,
        content: artifact.content,
      },
      sources: await readAttachedSources(
        db,
        parent.storeId,
        artifact.content.sourceDocumentIds
          .slice(0, 10)
          .map((sourceDocumentId) => ({
            sourceDocumentId,
            filename: "Source du contexte",
            mediaType: "application/octet-stream",
          })),
      ),
      sourcesOmitted:
        artifact.content.sourceReferencesOmitted ||
        artifact.content.sourceDocumentIds.length > 10,
    };
  } catch (error) {
    return {
      checkpoint: {
        status:
          error instanceof Error &&
          [
            "COPILOT_CONTEXT_STALE",
            "COPILOT_CONTEXT_QUOTE_INVALID",
            "COPILOT_CONTEXT_PARENT_INVALID",
          ].includes(error.message)
            ? ("STALE" as const)
            : ("UNAVAILABLE" as const),
      },
      sources: [],
      sourcesOmitted: false,
    };
  }
}
