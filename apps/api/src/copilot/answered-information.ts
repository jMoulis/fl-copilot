import type { Db } from "mongodb";
import {
  copilotInformationInputSchema,
  copilotMessageSchema,
  readCopilotInformationRequest,
  type CopilotMessage,
} from "@fl-copilot/domain";
/** Current user declarations may answer a private earlier form; its context is not official evidence. */
export async function readAnsweredInformationContext(
  db: Db,
  parent: CopilotMessage,
) {
  if (!parent.replyToMessageId) return undefined;
  const scope = {
    storeId: parent.storeId,
    ownerId: parent.ownerId,
    conversationId: parent.conversationId,
  };
  const row = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne(
      { _id: parent.replyToMessageId, ...scope, role: "TOOL" },
      { maxTimeMS: 2000 },
    );
  if (!row) return undefined;
  const { _id, ...payload } = row;
  const message = copilotMessageSchema.parse(payload);
  if (
    _id !== message.id ||
    message.storeId !== scope.storeId ||
    message.ownerId !== scope.ownerId ||
    message.conversationId !== scope.conversationId
  )
    throw Error("COPILOT_INFORMATION_SCOPE_INVALID");
  let content: unknown;
  try {
    content = JSON.parse(message.text);
  } catch {
    return undefined;
  }
  if (
    !content ||
    typeof content !== "object" ||
    !("kind" in content) ||
    content.kind !== "MISSING_INFORMATION_REQUEST"
  )
    return undefined;
  const { definition } = readCopilotInformationRequest(message);
  const original = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne(
      { _id: definition.parentUserMessageId, ...scope, role: "USER" },
      { maxTimeMS: 2000 },
    );
  if (!original) throw Error("COPILOT_INFORMATION_PARENT_INVALID");
  const { _id: originalId, ...originalPayload } = original;
  const user = copilotMessageSchema.parse(originalPayload);
  if (
    originalId !== user.id ||
    user.storeId !== scope.storeId ||
    user.ownerId !== scope.ownerId ||
    user.conversationId !== scope.conversationId
  )
    throw Error("COPILOT_INFORMATION_SCOPE_INVALID");
  const superseded = await db
    .collection("copilotMessages")
    .findOne(
      { ...scope, role: "USER", supersedesMessageId: user.id },
      { projection: { _id: 1 }, maxTimeMS: 2000 },
    );
  return {
    formId: definition.id,
    sourceQuestionId: user.id,
    title: definition.title,
    reason: definition.reason,
    fields: copilotInformationInputSchema.parse({
      title: definition.title,
      reason: definition.reason,
      fields: definition.fields,
    }).fields,
    originalQuestion: user.text.length <= 6000 ? user.text : null,
    originalQuestionOmitted: user.text.length > 6000,
    superseded: !!superseded,
  };
}
