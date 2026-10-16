import { readSupersededHistoryIds } from "./history-supersession.js";
import { copilotMessageSchema, type CopilotMessage } from "@fl-copilot/domain";
import type { Db } from "mongodb";
import type { CopilotGenerationRequest } from "./ai-provider.js";

/** Exact private topic only. Recent text is conversational context, never KPI evidence. */
export async function readConversationGenerationHistory(
  db: Db,
  rawParent: CopilotMessage,
): Promise<
  NonNullable<CopilotGenerationRequest["history"]> & {
    recentAttachmentReferences: CopilotMessage["attachments"];
    recentSourcesOmitted: boolean;
  }
> {
  const parent = copilotMessageSchema.parse(rawParent);
  if (parent.role !== "USER") throw new Error("COPILOT_HISTORY_PARENT_INVALID");
  const rows = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .find({
      storeId: parent.storeId,
      ownerId: parent.ownerId,
      conversationId: parent.conversationId,
      role: { $in: ["USER", "ASSISTANT"] },
      createdAt: { $lt: parent.createdAt },
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(21)
    .toArray();
  const superseded = await readSupersededHistoryIds(db, parent, rows);
  const messages: NonNullable<CopilotGenerationRequest["history"]>["messages"] =
    [];
  const references = new Map<string, CopilotMessage["attachments"][number]>();
  const currentIds = new Set(
    parent.attachments.map((ref) => ref.sourceDocumentId),
  );
  let remaining = 24000;
  for (const row of rows.slice(0, 20)) {
    const { _id, ...payload } = row;
    const message = copilotMessageSchema.parse(payload);
    if (
      _id !== message.id ||
      message.storeId !== parent.storeId ||
      message.ownerId !== parent.ownerId ||
      message.conversationId !== parent.conversationId ||
      (message.role !== "USER" && message.role !== "ASSISTANT") ||
      Date.parse(message.createdAt) >= Date.parse(parent.createdAt)
    )
      throw new Error("COPILOT_HISTORY_SCOPE_INVALID");
    if (
      superseded.has(message.id) ||
      (message.replyToMessageId && superseded.has(message.replyToMessageId))
    )
      continue;
    // Preserve whole messages; never silently cut a constraint or decimal value.
    if (message.text.length > remaining) break;
    remaining -= message.text.length;
    for (const reference of message.attachments) {
      if (!currentIds.has(reference.sourceDocumentId))
        references.set(reference.sourceDocumentId, reference);
    }
    messages.push({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    });
  }
  return {
    messages: messages.reverse(),
    earlierMessagesOmitted: rows.length > messages.length,
    recentAttachmentReferences: [...references.values()].slice(0, 10),
    recentSourcesOmitted: references.size > 10,
  };
}
