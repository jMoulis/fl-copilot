import type {
  CopilotConversation,
  CopilotMessage,
} from "../packages/domain/src/index";
export function chatFixture(uuid: () => string) {
  const storeId = uuid(),
    ownerId = uuid(),
    deviceId = uuid(),
    time = "2026-10-11T12:00:00.000Z";
  const conversation: CopilotConversation = {
    id: uuid(),
    storeId,
    ownerId,
    title: "Préparer la semaine",
    status: "ACTIVE",
    version: 1,
    createdAt: time,
    updatedAt: time,
  };
  const message: CopilotMessage = {
    id: uuid(),
    storeId,
    ownerId,
    conversationId: conversation.id,
    role: "USER",
    text: "Prépare les offres",
    attachments: [
      {
        sourceDocumentId: uuid(),
        filename: "pense-bete.pdf",
        mediaType: "application/pdf",
      },
    ],
    replyToMessageId: null,
    supersedesMessageId: null,
    version: 1,
    createdAt: time,
  };
  return { storeId, ownerId, deviceId, conversation, message };
}
