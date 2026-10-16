import type { CopilotMessage } from "@fl-copilot/domain";
import type { Db } from "mongodb";
/** Bounded candidate IDs; no foreign, future or cross-topic correction applies. */
export async function readSupersededHistoryIds(
  db: Db,
  parent: CopilotMessage,
  rows: CopilotMessage[],
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
            { maxTimeMS: 2000 },
          )
      : [],
  );
  if (parent.supersedesMessageId) superseded.add(parent.supersedesMessageId);
  return superseded;
}
