import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  copilotHistoryReadInputSchema,
  copilotHistoryReadResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { readSupersededHistoryIds } from "./history-supersession.js";
import { readAttachedSources } from "./attached-sources.js";
const scopeSchema = z.strictObject({
  storeId: z.string().uuid(),
  ownerId: z.string().uuid(),
  conversationId: z.string().uuid(),
  parentMessageId: z.string().uuid(),
});
/** Scope comes from the authenticated turn, never model-controlled arguments. */
export async function readConversationContext(
  db: Db,
  rawScope: z.infer<typeof scopeSchema>,
  raw: unknown,
) {
  const scope = scopeSchema.parse(rawScope);
  const input = copilotHistoryReadInputSchema.parse(raw);
  const privateScope = {
    storeId: scope.storeId,
    ownerId: scope.ownerId,
    conversationId: scope.conversationId,
  };
  const conversation = await db
    .collection<{ _id: string }>("copilotConversations")
    .findOne(
      {
        _id: scope.conversationId,
        storeId: scope.storeId,
        ownerId: scope.ownerId,
        status: "ACTIVE",
      },
      { maxTimeMS: 2000 },
    );
  const parentRow = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne(
      { _id: scope.parentMessageId, ...privateScope, role: "USER" },
      { maxTimeMS: 2000 },
    );
  if (!conversation || !parentRow) throw Error("COPILOT_CONTEXT_UNAVAILABLE");
  const { _id: conversationKey, ...conversationPayload } = conversation;
  const topic = copilotConversationSchema.parse(conversationPayload);
  const { _id: parentKey, ...parentPayload } = parentRow;
  const parent = copilotMessageSchema.parse(parentPayload);
  if (
    conversationKey !== topic.id ||
    topic.id !== scope.conversationId ||
    topic.storeId !== scope.storeId ||
    topic.ownerId !== scope.ownerId ||
    topic.status !== "ACTIVE" ||
    parentKey !== parent.id ||
    parent.id !== scope.parentMessageId ||
    parent.role !== "USER" ||
    parent.storeId !== scope.storeId ||
    parent.ownerId !== scope.ownerId ||
    parent.conversationId !== scope.conversationId
  )
    throw Error("COPILOT_CONTEXT_SCOPE_INVALID");
  const cursorFilter = input.before
    ? {
        $or: [
          { createdAt: { $lt: input.before.createdAt } },
          { createdAt: input.before.createdAt, _id: { $lt: input.before.id } },
        ],
      }
    : {};
  const escaped = input.query?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .find({
      ...privateScope,
      ...(input.messageId ? { _id: input.messageId } : {}),
      role: { $in: ["USER", "ASSISTANT"] },
      $and: [{ createdAt: { $lt: parent.createdAt } }, cursorFilter],
      ...(escaped ? { text: { $regex: escaped, $options: "i" } } : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .maxTimeMS(2000)
    .limit(51)
    .toArray();
  const superseded = await readSupersededHistoryIds(db, parent, rows);
  const messages: z.infer<typeof copilotHistoryReadResultSchema>["messages"] =
    [];
  let lastScanned: CopilotMessage | null = null,
    remaining = 18000;
  let hasMore = rows.length > 50;
  for (const row of rows.slice(0, 50)) {
    const { _id, ...payload } = row;
    const m = copilotMessageSchema.parse(payload);
    if (
      _id !== m.id ||
      (input.messageId !== null && input.messageId !== m.id) ||
      m.storeId !== scope.storeId ||
      m.ownerId !== scope.ownerId ||
      m.conversationId !== scope.conversationId ||
      m.role === "TOOL" ||
      Date.parse(m.createdAt) >= Date.parse(parent.createdAt)
    )
      throw Error("COPILOT_CONTEXT_SCOPE_INVALID");
    // A page cursor advances past examined obsolete entries, but never past an
    // eligible whole message that did not fit this page's count/character budget.
    if (
      superseded.has(m.id) ||
      (m.replyToMessageId && superseded.has(m.replyToMessageId))
    ) {
      lastScanned = m;
      continue;
    }
    if (messages.length >= input.limit || m.text.length > remaining) {
      hasMore = true;
      break;
    }
    messages.push({
      id: m.id,
      role: m.role,
      text: m.text,
      createdAt: m.createdAt,
      attachments: m.attachments,
    });
    lastScanned = m;
    remaining -= m.text.length;
  }
  const references = new Map<string, CopilotMessage["attachments"][number]>();
  for (const m of messages)
    for (const ref of m.attachments) references.set(ref.sourceDocumentId, ref);
  const sources = await readAttachedSources(
    db,
    scope.storeId,
    [...references.values()].slice(0, 10),
  );
  return copilotHistoryReadResultSchema.parse({
    messages: messages.reverse(),
    hasMore,
    nextBefore:
      hasMore && lastScanned
        ? { id: lastScanned.id, createdAt: lastScanned.createdAt }
        : null,
    sources,
    sourcesOmitted: references.size > 10,
    evidence: [],
  });
}
