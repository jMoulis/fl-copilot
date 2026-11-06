import type {
  CopilotConversation,
  CopilotMessage,
} from "../packages/domain/src/index";
/** Migrate model transport fixtures only; stored/native response fixtures stay canonical. */
export function directReferenceModelFixture(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.language === "fr-FR" && Array.isArray(parsed.facts))
        return JSON.stringify(directReferenceModelFixture(parsed));
    } catch {
      /* Deliberately malformed transport fixtures stay malformed. */
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(directReferenceModelFixture);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  if (row.language === "fr-FR" && Array.isArray(row.facts)) {
    const {
      facts,
      language: _language,
      summary: _summary,
      interpretation: _interpretation,
      questions: _questions,
      ...output
    } = row;
    void [_language, _summary, _interpretation, _questions];
    if (typeof output.narrative === "string")
      output.narrative = output.narrative.replace(
        /\{\{(value|label|source|chart):(\d+)\}\}/g,
        (_token, kind: string, index: string) =>
          `{{${kind}:${(facts as Array<{ evidenceId: string }>)[Number(index)]?.evidenceId ?? `missing-index-${index}`}}}`,
      );
    return output;
  }
  return Object.fromEntries(
    Object.entries(row).map(([key, item]) => [
      key,
      directReferenceModelFixture(item),
    ]),
  );
}
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
