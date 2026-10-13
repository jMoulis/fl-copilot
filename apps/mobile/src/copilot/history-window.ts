import type { CopilotConversationRepository } from "./conversation-repository";

export type CopilotHistoryPage = Awaited<
  ReturnType<CopilotConversationRepository["messages"]>
>;

/** Merge overlapping local pages without losing loaded history when the latest page refreshes. */
export function mergeCopilotHistory(
  current: CopilotHistoryPage,
  incoming: CopilotHistoryPage,
  direction: "OLDER" | "LATEST" = "LATEST",
): CopilotHistoryPage {
  const identity = current.messages[0]?.entity ?? incoming.messages[0]?.entity;
  for (const record of [...current.messages, ...incoming.messages]) {
    if (
      identity &&
      (record.entity.storeId !== identity.storeId ||
        record.entity.ownerId !== identity.ownerId ||
        record.entity.conversationId !== identity.conversationId)
    )
      throw Error("COPILOT_HISTORY_SCOPE_INVALID");
  }
  const records = new Map(
    current.messages.map((record) => [record.entity.id, record]),
  );
  for (const record of incoming.messages) {
    records.set(record.entity.id, record);
  }
  const messages = [...records.values()].sort((a, b) =>
    a.entity.createdAt < b.entity.createdAt
      ? -1
      : a.entity.createdAt > b.entity.createdAt
        ? 1
        : a.entity.id < b.entity.id
          ? -1
          : a.entity.id > b.entity.id
            ? 1
            : 0,
  );
  const older =
    direction === "OLDER" ||
    !current.before ||
    (incoming.before &&
      (incoming.before.createdAt < current.before.createdAt ||
        (incoming.before.createdAt === current.before.createdAt &&
          incoming.before.id < current.before.id)))
      ? incoming
      : current;
  return {
    messages,
    hasMore: older.hasMore,
    before: older.before ?? current.before,
  };
}
