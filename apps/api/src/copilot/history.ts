import {
  copilotHistoryQuerySchema as historyQuerySchema,
  copilotHistoryPageSchema as historyPageSchema,
} from "@fl-copilot/sync-contracts";
export {
  copilotHistoryQuerySchema as historyQuerySchema,
  copilotHistoryPageSchema as historyPageSchema,
} from "@fl-copilot/sync-contracts";
import { z } from "zod";
import { serializeChat, type ChatRecordDocument } from "./conversation-store";
import type { Db } from "mongodb";
export async function readCopilotHistory(
  db: Db,
  storeId: string,
  ownerId: string,
  query: z.infer<typeof historyQuerySchema>,
) {
  const scope = { storeId, ownerId };
  if (
    query.conversationId &&
    !(await db
      .collection<ChatRecordDocument>("copilotConversations")
      .findOne({ _id: query.conversationId, ...scope }))
  )
    return historyPageSchema.parse({
      ...scope,
      conversationId: query.conversationId,
      conversations: [],
      messages: [],
      hasMore: false,
      before: null,
    });
  const cursor = query.beforeId
    ? {
        $or: [
          { createdAt: { $lt: query.beforeCreatedAt } },
          { createdAt: query.beforeCreatedAt, _id: { $lt: query.beforeId } },
        ],
      }
    : {};
  const type = query.conversationId
    ? "copilot_message"
    : "copilot_conversation";
  const rows = await db
    .collection<ChatRecordDocument>(
      query.conversationId ? "copilotMessages" : "copilotConversations",
    )
    .find({
      ...scope,
      ...cursor,
      ...(query.conversationId ? { conversationId: query.conversationId } : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .toArray();
  const selected = rows.slice(0, query.limit),
    last = selected.at(-1),
    data = selected.map((r) => serializeChat(type, r));
  return historyPageSchema.parse({
    ...scope,
    conversationId: query.conversationId ?? null,
    conversations: query.conversationId ? [] : data,
    messages: query.conversationId ? data.reverse() : [],
    hasMore: rows.length > query.limit,
    before: last ? { createdAt: last.createdAt, id: last.id } : null,
  });
}
