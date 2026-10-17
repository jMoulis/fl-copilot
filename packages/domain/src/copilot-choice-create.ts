import { z } from "zod";
import {
  commercialOfferChoiceSchema,
  commercialOfferSourceSchema,
} from "./commercial-offer-choice";
import { productSchema } from "./products";
import { copilotSourceOfferSchema } from "./copilot-source-offers";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
import { choiceSaveRequestSchema } from "./copilot-commercial-choice";
const fields = commercialOfferChoiceSchema.shape;
export const copilotChoiceCreateInputSchema = z.strictObject({
  source: commercialOfferSourceSchema,
  productId: z.uuid(),
  saleStart: fields.saleStart,
  saleEnd: fields.saleEnd,
  mechanism: z.union(fields.mechanism.options),
  note: fields.note,
});
export const choiceCreateBasisSchema = z.strictObject({
  storeId: z.uuid(),
  offer: copilotSourceOfferSchema,
  product: productSchema,
});
export function choiceCreateRequest(
  input: z.infer<typeof copilotChoiceCreateInputSchema>,
  rawBasis: z.infer<typeof choiceCreateBasisSchema>,
  operationId: string,
) {
  const basis = choiceCreateBasisSchema.parse(rawBasis);
  if (
    JSON.stringify(input.source) !== JSON.stringify(basis.offer.source) ||
    basis.product.id !== input.productId ||
    basis.product.storeId !== basis.storeId ||
    basis.product.status !== "ACTIVE" ||
    basis.product.deletedAt
  )
    throw Error("CHOICE_CREATE_SCOPE");
  // Validation scaffold only; the canonical runtime owns the real identity and timestamps.
  const proposed = {
    source: basis.offer.source,
    operationKind: basis.offer.operationKind,
    operationLabel: basis.offer.operationLabel,
    rawProductLabel: basis.offer.rawProductLabel,
    productId: input.productId,
    saleStart: input.saleStart,
    saleEnd: input.saleEnd,
    mechanism: input.mechanism,
    note: input.note || null,
    status: "RETAINED" as const,
    applicabilityConfirmed: true as const,
    criticalFieldsConfirmed: true as const,
  };
  commercialOfferChoiceSchema.parse({
    ...proposed,
    id: input.source.readingId,
    storeId: basis.storeId,
    version: 1,
    createdAt: "2000-01-01T00:00:00Z",
    updatedAt: "2000-01-01T00:00:00Z",
  });
  return choiceSaveRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "commercial.choice.save",
    input: {
      expectedVersion: null,
      productVersion: basis.product.version,
      draft: proposed,
    },
  });
}
export const copilotChoiceCreatePreviewSchema = z
  .strictObject({
    input: copilotChoiceCreateInputSchema,
    status: z.enum([
      "READY",
      "ALREADY_EXISTS",
      "BLOCKED",
      "UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    basis: choiceCreateBasisSchema.nullable(),
    existingChoice: z
      .strictObject({
        id: z.uuid(),
        status: fields.status,
        version: fields.version,
      })
      .nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((v) => {
    if (v.status !== "READY")
      return (
        v.basis === null &&
        (v.status === "ALREADY_EXISTS") === (v.existingChoice !== null)
      );
    if (!v.basis || v.existingChoice) return false;
    try {
      choiceCreateRequest(
        v.input,
        v.basis,
        "00000000-0000-4000-8000-000000000001",
      );
      return true;
    } catch {
      return false;
    }
  });
export const copilotChoiceCreateProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_CHOICE_CREATE_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotChoiceCreateInputSchema,
  basis: choiceCreateBasisSchema,
});
export function readCopilotChoiceCreateProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("CHOICE_CREATE_INVALID");
  const content = copilotChoiceCreateProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.storeId !== message.storeId)
    throw Error("CHOICE_CREATE_SCOPE");
  return {
    message,
    content,
    request: choiceCreateRequest(content.input, content.basis, message.id),
  };
}
