import {
  copilotAttachmentReferenceSchema,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  copilotGenerationRequestSchema,
  type CopilotGenerationRequest,
} from "./ai-provider.js";
import {
  validateCopilotResponse,
  copilotRequestEvidence,
  copilotResponseFallback,
  type generateCopilotResponse,
} from "./response-service.js";

type Generation = Awaited<ReturnType<typeof generateCopilotResponse>>;
/** Application supplies identities and time; the model cannot assign actors or parent messages. */
export function buildCopilotResponseMessage(input: {
  id: string;
  createdAt: string;
  parent: CopilotMessage;
  request: CopilotGenerationRequest;
  generation: Generation;
}): CopilotMessage {
  const parent = copilotMessageSchema.parse(input.parent);
  const request = copilotGenerationRequestSchema.parse({
    ...input.request,
    ...(input.generation.evidence
      ? { evidence: input.generation.evidence }
      : {}),
  });
  if (
    parent.role !== "USER" ||
    parent.storeId !== request.storeId ||
    request.storeId !== request.context.batch.storeId
  )
    throw new Error("COPILOT_REPLY_SCOPE_INVALID");
  if (
    (request.userQuestion !== null && request.userQuestion !== parent.text) ||
    Date.parse(input.createdAt) < Date.parse(parent.createdAt)
  )
    throw new Error("COPILOT_REPLY_CONTEXT_INVALID");
  const response =
    input.generation.mode === "AI"
      ? validateCopilotResponse(input.generation.response, request)
      : copilotResponseFallback(request);
  const evidence = new Map(
    copilotRequestEvidence(request).map((e) => [e.id, e] as const),
  );
  const referenced = [
    ...new Set([
      ...response.facts.map((f) => f.evidenceId),
      ...response.recommendations.flatMap((r) => [
        ...r.evidenceIds,
        ...r.measurement.evidenceIds,
      ]),
    ]),
  ];
  // Resolve only server-produced commercial source metadata; never store a model URL.
  const citedDocuments = new Set(
    referenced.map((id) => evidence.get(id)?.sourceId),
  );
  const originals = new Map<
    string,
    ReturnType<typeof copilotAttachmentReferenceSchema.parse>
  >();
  for (const item of evidence.values()) {
    if (
      item.id.startsWith("commercial-pdf-source/") &&
      item.sourceType === "SOURCE_DOCUMENT" &&
      citedDocuments.has(item.sourceId)
    ) {
      const source = copilotAttachmentReferenceSchema.safeParse({
        sourceDocumentId: item.sourceId,
        filename: item.value,
        mediaType: "application/pdf",
      });
      if (source.success)
        originals.set(source.data.sourceDocumentId, source.data);
    }
  }
  const facts = referenced.map((id) => {
    const item = evidence.get(id);
    if (!item) throw new Error("COPILOT_REPLY_EVIDENCE_INVALID");
    return `${item.label} : ${item.value === null ? "indisponible" : String(item.value)}`;
  });
  const text = [
    response.summary,
    ...(facts.length ? ["Faits disponibles", ...facts] : []),
    ...(response.interpretation.length
      ? ["Lecture", ...response.interpretation]
      : []),
    ...response.recommendations.map((r) =>
      [
        r.title,
        r.explanation,
        `Confiance : ${{ LOW: "limitée", MEDIUM: "modérée", HIGH: "élevée" }[r.confidence]}`,
        ...r.risks.map((v) => `Vigilance : ${v}`),
        ...r.missingData.map((v) => `Information manquante : ${v}`),
        `Suivi : ${r.measurement.objective}`,
        r.measurement.reviewWhen,
      ].join("\n"),
    ),
    ...response.questions,
  ].join("\n\n");
  // Reject overflow rather than silently losing source/qualification information.
  return copilotMessageSchema.parse({
    id: input.id,
    storeId: parent.storeId,
    ownerId: parent.ownerId,
    conversationId: parent.conversationId,
    role: "ASSISTANT",
    text,
    attachments: [...originals.values()],
    replyToMessageId: parent.id,
    supersedesMessageId: null,
    version: 1,
    createdAt: input.createdAt,
  });
}
