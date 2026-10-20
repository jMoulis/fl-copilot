import {
  copilotMessageIsDeleted,
  type CopilotConversation,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  copilotHistoryQuerySchema as historyQuerySchema,
  copilotHistoryPageSchema as historyPageSchema,
} from "@fl-copilot/sync-contracts";
export {
  copilotHistoryQuerySchema as historyQuerySchema,
  copilotHistoryPageSchema as historyPageSchema,
} from "@fl-copilot/sync-contracts";
import { z } from "zod";
import {
  serializeChatForClient,
  type ChatRecordDocument,
} from "./conversation-store";
import type { Db } from "mongodb";
import {
  serializeLayoutIllustration,
  type LayoutIllustrationDocument,
} from "./layout-illustration-store";
export async function readCopilotHistory(
  db: Db,
  storeId: string,
  ownerId: string,
  query: z.infer<typeof historyQuerySchema>,
  supportsDeletion = false,
  supportsAnalyticsDestinations = false,
) {
  const scope = { storeId, ownerId };
  if (query.recordType === "LAYOUT_ILLUSTRATIONS") {
    const rows = await db
      .collection<LayoutIllustrationDocument>("copilotLayoutIllustrations")
      .find(
        {
          ...scope,
          ...(query.beforeId
            ? {
                $or: [
                  { createdAt: { $lt: query.beforeCreatedAt } },
                  {
                    createdAt: query.beforeCreatedAt,
                    _id: { $lt: query.beforeId },
                  },
                ],
              }
            : {}),
        },
        { maxTimeMS: 2000 },
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .toArray();
    const selected = rows.slice(0, query.limit),
      last = selected.at(-1);
    return historyPageSchema.parse({
      ...scope,
      conversationId: null,
      conversations: [],
      messages: [],
      layoutIllustrations: selected.map(serializeLayoutIllustration),
      hasMore: rows.length > query.limit,
      before: last ? { createdAt: last.createdAt, id: last.id } : null,
    });
  }
  const topic = query.conversationId
    ? await db
        .collection<CopilotConversation & { _id: string }>(
          "copilotConversations",
        )
        .findOne({ _id: query.conversationId, ...scope })
    : null;
  if (
    query.conversationId &&
    (!topic ||
      topic.deletedAt ||
      (!supportsDeletion && topic.deletedMessageIds?.length))
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
    data = selected
      .map((r) =>
        serializeChatForClient(
          type,
          r,
          supportsDeletion,
          supportsAnalyticsDestinations,
        ),
      )
      .filter(
        (record) =>
          !topic || !copilotMessageIsDeleted(record as CopilotMessage, topic),
      );
  return historyPageSchema.parse({
    ...scope,
    conversationId: query.conversationId ?? null,
    conversations: query.conversationId ? [] : data,
    messages: query.conversationId ? data.reverse() : [],
    hasMore: rows.length > query.limit,
    before: last ? { createdAt: last.createdAt, id: last.id } : null,
  });
}
