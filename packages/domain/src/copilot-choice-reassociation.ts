import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { productSchema } from "./products";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { choiceSaveRequestSchema } from "./copilot-commercial-choice";
export const copilotChoiceReassociationInputSchema = z.strictObject({
  choiceId: z.uuid(),
  productId: z.uuid(),
});
export const choiceReassociationBasisSchema = z.strictObject({
  before: commercialOfferChoiceSchema,
  product: productSchema,
  previousProduct: productSchema.nullable(),
});
export function choiceReassociationRequest(
  input: z.infer<typeof copilotChoiceReassociationInputSchema>,
  basis: z.infer<typeof choiceReassociationBasisSchema>,
  operationId: string,
) {
  const { before, product, previousProduct } =
    choiceReassociationBasisSchema.parse(basis);
  if (
    before.id !== input.choiceId ||
    before.status !== "RETAINED" ||
    product.id !== input.productId ||
    product.storeId !== before.storeId ||
    product.status !== "ACTIVE" ||
    product.deletedAt ||
    (previousProduct &&
      (previousProduct.id !== before.productId ||
        previousProduct.storeId !== before.storeId))
  )
    throw Error("CHOICE_REASSOCIATION_SCOPE");
  const after = commercialOfferChoiceSchema.parse({
    ...before,
    productId: input.productId,
  });
  const { id, storeId, version, createdAt, updatedAt, ...draft } = after;
  void id;
  void storeId;
  void createdAt;
  void updatedAt;
  return choiceSaveRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "commercial.choice.save",
    input: { expectedVersion: version, productVersion: product.version, draft },
  });
}
export function choiceReassociationHasChanges(
  input: z.infer<typeof copilotChoiceReassociationInputSchema>,
  before: z.infer<typeof commercialOfferChoiceSchema>,
) {
  return input.productId !== before.productId;
}
export const copilotChoiceReassociationPreviewSchema = z
  .strictObject({
    input: copilotChoiceReassociationInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "BLOCKED",
      "UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    basis: choiceReassociationBasisSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((v) => {
    if (!["READY", "UNCHANGED"].includes(v.status)) return v.basis === null;
    if (!v.basis || v.basis.before.id !== v.input.choiceId) return false;
    try {
      choiceReassociationRequest(
        v.input,
        v.basis,
        "00000000-0000-4000-8000-000000000001",
      );
    } catch {
      return false;
    }
    return (
      choiceReassociationHasChanges(v.input, v.basis.before) ===
      (v.status === "READY")
    );
  });
export const copilotChoiceReassociationProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_CHOICE_REASSOCIATION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotChoiceReassociationInputSchema,
  basis: choiceReassociationBasisSchema,
});
export function readCopilotChoiceReassociationProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("CHOICE_REASSOCIATION_INVALID");
  const content = copilotChoiceReassociationProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.before.storeId !== message.storeId)
    throw Error("CHOICE_REASSOCIATION_SCOPE");
  return {
    message,
    content,
    request: choiceReassociationRequest(
      content.input,
      content.basis,
      message.id,
    ),
  };
}
