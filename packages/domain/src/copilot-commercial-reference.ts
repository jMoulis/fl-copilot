import { z } from "zod";
import { commercialVersionDecisionSchema } from "./commercial-version-decision";
import { copilotDocumentComparisonResultSchema } from "./copilot-document-comparison";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
export const copilotReferenceInputSchema = z
  .strictObject({
    beforeDocumentId: z.uuid(),
    afterDocumentId: z.uuid(),
    preference: commercialVersionDecisionSchema.shape.preference,
    note: commercialVersionDecisionSchema.shape.note.optional(),
  })
  .refine((v) => v.beforeDocumentId !== v.afterDocumentId);
export const copilotReferenceBasisSchema = z.strictObject({
  storeId: z.uuid(),
  sources: z.strictObject({
    before: commercialVersionDecisionSchema.shape.before,
    after: commercialVersionDecisionSchema.shape.after,
  }),
  beforeFilename: z.string().min(1).max(240),
  afterFilename: z.string().min(1).max(240),
  counts: copilotDocumentComparisonResultSchema.shape.counts.unwrap(),
  warningCount: z.number().int().nonnegative(),
  previous: commercialVersionDecisionSchema.nullable(),
});
export function referenceDesiredValue(
  rawInput: z.infer<typeof copilotReferenceInputSchema>,
  rawBasis: z.infer<typeof copilotReferenceBasisSchema>,
) {
  const input = copilotReferenceInputSchema.parse(rawInput),
    b = copilotReferenceBasisSchema.parse(rawBasis);
  if (
    b.sources.before.documentId !== input.beforeDocumentId ||
    b.sources.after.documentId !== input.afterDocumentId ||
    b.sources.before.checksum === b.sources.after.checksum ||
    (b.previous &&
      (b.previous.storeId !== b.storeId ||
        JSON.stringify(b.previous.before) !==
          JSON.stringify(b.sources.before) ||
        JSON.stringify(b.previous.after) !== JSON.stringify(b.sources.after)))
  )
    throw Error("COMMERCIAL_REFERENCE_SCOPE");
  return {
    storeId: b.storeId,
    ...b.sources,
    preference: input.preference,
    comparisonReviewed: true as const,
    note: input.note ?? b.previous?.note ?? "",
  };
}
export const copilotReferencePreviewSchema = z
  .strictObject({
    storeId: z.uuid(),
    input: copilotReferenceInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "BLOCKED",
      "UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    basis: copilotReferenceBasisSchema.nullable(),
    issue: z
      .enum(["SAME_BINARY", "INCOMPLETE", "ORIENTATION", "SOURCE_CHANGED"])
      .nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(3),
  })
  .refine((v) => {
    if (v.status !== "READY")
      return (
        v.basis === null &&
        (v.status === "BLOCKED" ? v.issue !== null : v.issue === null)
      );
    if (!v.basis || v.issue !== null || v.basis.storeId !== v.storeId)
      return false;
    try {
      const desired = referenceDesiredValue(v.input, v.basis);
      return (
        !v.basis.previous ||
        v.basis.previous.preference !== desired.preference ||
        v.basis.previous.note !== desired.note
      );
    } catch {
      return false;
    }
  });
export const referenceSaveRequestSchema = z
  .strictObject({
    operationId: z.uuid(),
    schemaVersion: z.literal(1),
    tool: z.literal("commercial.reference.save"),
    input: z.strictObject({
      intent: copilotReferenceInputSchema,
      basis: copilotReferenceBasisSchema,
    }),
  })
  .refine((v) => {
    try {
      const desired = referenceDesiredValue(v.input.intent, v.input.basis),
        previous = v.input.basis.previous;
      return (
        !previous ||
        previous.preference !== desired.preference ||
        previous.note !== desired.note
      );
    } catch {
      return false;
    }
  });
export function referenceSaveIntent(raw: unknown) {
  return JSON.stringify(referenceSaveRequestSchema.parse(raw));
}
export const referenceSaveAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({
    canManageCommercialReferences: z.boolean(),
    comparisonReviewed: z.boolean(),
  });
export type ReferenceSaveAuthority = z.infer<
  typeof referenceSaveAuthoritySchema
>;
export const referenceSaveResultSchema = z.strictObject({
  operationId: z.uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("commercial.reference.save"),
  status: z.literal("COMPLETED"),
  userMessageId: z.uuid(),
  appliedAt: z.string().datetime(),
  before: commercialVersionDecisionSchema.nullable(),
  after: commercialVersionDecisionSchema,
  commandId: z.uuid(),
  syncState: z.literal("PENDING"),
  message: z.string(),
});
export const copilotReferenceProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_REFERENCE_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotReferenceInputSchema,
  basis: copilotReferenceBasisSchema,
});
export function readCopilotReferenceProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("COMMERCIAL_REFERENCE_INVALID");
  const content = copilotReferenceProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.storeId !== message.storeId)
    throw Error("COMMERCIAL_REFERENCE_SCOPE");
  return {
    message,
    content,
    request: referenceSaveRequestSchema.parse({
      operationId: message.id,
      schemaVersion: 1,
      tool: "commercial.reference.save",
      input: { intent: content.input, basis: content.basis },
    }),
  };
}
export const copilotReferenceMutationRegistry = [
  {
    name: "commercial.reference.save",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Enregistrer le choix revu de référence entre deux PDF complets, sans modifier les offres, plans ou exécutions.",
    progress: "Enregistrement du choix de référence…",
    inputSchema: referenceSaveRequestSchema.shape.input,
    outputSchema: referenceSaveResultSchema,
  },
] as const;
