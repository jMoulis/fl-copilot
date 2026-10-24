import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
/** Model selects a known document, never a local decision, correction or approval. */
export const transcriptionReviewInputSchema = z.strictObject({
  sourceDocumentId: z.uuid(),
});
export const transcriptionReviewSourceSchema = z.strictObject({
  storeId: z.uuid(),
  sourceDocumentId: z.uuid(),
  checksum: z.string().min(1).max(240),
  filename: z.string().min(1).max(240),
});
export const transcriptionReviewPreviewSchema = z.strictObject({
  input: transcriptionReviewInputSchema,
  source: transcriptionReviewSourceSchema.nullable(),
  status: z.enum(["REVIEW_LOCAL", "UNAVAILABLE"]),
  evidence: z.array(copilotEvidenceSchema).length(1),
});
export function validateTranscriptionReviewPreview(
  storeId: string,
  raw: unknown,
  expectedInput?: unknown,
) {
  const p = transcriptionReviewPreviewSchema.parse(raw);
  if (
    expectedInput !== undefined &&
    p.input.sourceDocumentId !==
      transcriptionReviewInputSchema.parse(expectedInput).sourceDocumentId
  )
    throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
  if (
    (p.status === "REVIEW_LOCAL") !== (p.source !== null) ||
    (p.source &&
      (p.source.storeId !== storeId ||
        p.source.sourceDocumentId !== p.input.sourceDocumentId))
  )
    throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
  return p;
}
export const transcriptionReviewProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_TRANSCRIPTION_REVIEW"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  source: transcriptionReviewSourceSchema,
});
export function readTranscriptionReviewProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("TRANSCRIPTION_REVIEW_PROPOSAL_INVALID");
  const content = transcriptionReviewProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.source.storeId !== message.storeId)
    throw Error("TRANSCRIPTION_REVIEW_SCOPE_INVALID");
  return { message, content };
}
export const transcriptionReviewRequestSchema = z.strictObject({
  operationId: z.uuid(),
  proposalMessageId: z.uuid(),
  localId: z.uuid(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const transcriptionReviewResultSchema =
  transcriptionReviewRequestSchema.extend({
    userMessageId: z.uuid(),
    appliedAt: z.iso.datetime(),
    sourceDocumentId: z.uuid(),
    remoteId: z.uuid(),
    pageId: z.uuid(),
    pageNumber: z.number().int().min(1).max(100),
    sourceBlockIndex: z.number().int().nonnegative(),
    decision: z.literal("ADOPT_REMOTE"),
  });
