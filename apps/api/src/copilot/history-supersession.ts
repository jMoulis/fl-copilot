import type { CopilotMessage, CopilotConversation } from "@fl-copilot/domain";
import type { Db, ClientSession } from "mongodb";
/** Bounded candidate IDs; no foreign, future or cross-topic correction applies. */
export async function readSupersededHistoryIds(
  db: Db,
  parent: CopilotMessage,
  rows: CopilotMessage[],
  session?: ClientSession,
) {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.role === "USER"
          ? [row.id]
          : row.replyToMessageId
            ? [row.replyToMessageId]
            : [],
      ),
    ),
  ];
  const superseded = new Set(
    ids.length
      ? await db
          .collection<CopilotMessage & { _id: string }>("copilotMessages")
          .distinct(
            "supersedesMessageId",
            {
              storeId: parent.storeId,
              ownerId: parent.ownerId,
              conversationId: parent.conversationId,
              role: "USER",
              createdAt: { $lte: parent.createdAt },
              supersedesMessageId: { $in: ids },
            },
            { maxTimeMS: 2000, ...(session ? { session } : {}) },
          )
      : [],
  );
  if (parent.supersedesMessageId) superseded.add(parent.supersedesMessageId);
  const conversation = await db
    .collection<CopilotConversation & { _id: string }>("copilotConversations")
    .findOne(
      {
        _id: parent.conversationId,
        storeId: parent.storeId,
        ownerId: parent.ownerId,
      },
      {
        projection: { deletedMessageIds: 1, deletedAt: 1 },
        maxTimeMS: 2000,
        ...(session ? { session } : {}),
      },
    );
  for (const id of conversation?.deletedMessageIds ?? []) superseded.add(id);
  if (conversation?.deletedAt)
    for (const row of rows) {
      superseded.add(row.id);
      if (row.replyToMessageId) superseded.add(row.replyToMessageId);
    }
  return superseded;
}
