import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { commercialValidatedOfferSchema } from "./commercial-validated-offer";
import { productSchema } from "./products";
import { copilotSourceOfferSchema } from "./copilot-source-offers";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { copilotMessageSchema } from "./copilot-conversation";
import { offerValidationRequestSchema } from "./copilot-offer-validation";
export const copilotOfferValidationInputSchema = z.strictObject({
  choiceIds: z
    .array(z.uuid())
    .min(1)
    .max(25)
    .refine((v) => new Set(v).size === v.length),
});
export const offerValidationPreviewBasisSchema = z.strictObject({
  storeId: z.uuid(),
  entries: z
    .array(
      z.strictObject({
        choice: commercialOfferChoiceSchema,
        product: productSchema,
        offer: copilotSourceOfferSchema,
        validation: commercialValidatedOfferSchema.nullable(),
      }),
    )
    .min(1)
    .max(25),
});
export function offerValidationPreviewRequest(
  input: z.infer<typeof copilotOfferValidationInputSchema>,
  raw: z.infer<typeof offerValidationPreviewBasisSchema>,
  operationId: string,
) {
  const basis = offerValidationPreviewBasisSchema.parse(raw);
  if (
    basis.entries.length !== input.choiceIds.length ||
    basis.entries.some(
      (e, i) =>
        e.choice.id !== input.choiceIds[i] ||
        e.choice.storeId !== basis.storeId ||
        e.choice.status !== "RETAINED" ||
        e.product.id !== e.choice.productId ||
        e.product.storeId !== basis.storeId ||
        e.product.status !== "ACTIVE" ||
        e.product.deletedAt ||
        JSON.stringify(e.offer.source) !== JSON.stringify(e.choice.source) ||
        e.offer.operationKind !== e.choice.operationKind ||
        e.offer.operationLabel !== e.choice.operationLabel ||
        e.offer.rawProductLabel !== e.choice.rawProductLabel ||
        (e.validation &&
          (e.validation.storeId !== basis.storeId ||
            JSON.stringify(e.validation.choice) !== JSON.stringify(e.choice))),
    )
  )
    throw Error("OFFER_VALIDATION_SCOPE");
  return offerValidationRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "commercial.offer.validate",
    input: {
      selection: basis.entries.map((e) => ({
        choiceId: e.choice.id,
        choiceVersion: e.choice.version,
        productVersion: e.product.version,
      })),
    },
  });
}
export function offerValidationReviewedSources(
  basis: z.infer<typeof offerValidationPreviewBasisSchema>,
) {
  return basis.entries.map((e) => ({
    choiceId: e.choice.id,
    choiceVersion: e.choice.version,
    readingId: e.choice.source.readingId,
    checksum: e.choice.source.checksum,
  }));
}
export const copilotOfferValidationPreviewSchema = z
  .strictObject({
    storeId: z.uuid(),
    input: copilotOfferValidationInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "BLOCKED",
      "UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    basis: offerValidationPreviewBasisSchema.nullable(),
    alreadyValidatedIds: z.array(z.uuid()).max(25),
    issue: z
      .strictObject({
        choiceId: z.uuid(),
        label: z.string().max(240).nullable(),
        code: z.enum([
          "MISSING_CHOICE",
          "WITHDRAWN",
          "PRODUCT_UNAVAILABLE",
          "SOURCE_UNAVAILABLE",
          "SOURCE_CHANGED",
          "UNIT_MISMATCH",
        ]),
      })
      .nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((v) => {
    if (v.issue && !v.input.choiceIds.includes(v.issue.choiceId)) return false;
    if (
      ["READY", "UNCHANGED", "LIMIT_EXCEEDED"].includes(v.status) &&
      v.issue !== null
    )
      return false;
    if (
      ["BLOCKED", "UNAVAILABLE"].includes(v.status) &&
      (!v.issue || v.alreadyValidatedIds.length)
    )
      return false;
    if (
      new Set(v.alreadyValidatedIds).size !== v.alreadyValidatedIds.length ||
      v.alreadyValidatedIds.some((id) => !v.input.choiceIds.includes(id))
    )
      return false;
    if (v.status !== "READY")
      return (
        v.basis === null &&
        (v.status !== "UNCHANGED" ||
          v.alreadyValidatedIds.length === v.input.choiceIds.length)
      );
    if (
      !v.basis ||
      v.basis.storeId !== v.storeId ||
      v.alreadyValidatedIds.length === v.input.choiceIds.length
    )
      return false;
    try {
      offerValidationPreviewRequest(
        v.input,
        v.basis,
        "00000000-0000-4000-8000-000000000001",
      );
      return (
        JSON.stringify(
          v.basis.entries.filter((e) => e.validation).map((e) => e.choice.id),
        ) === JSON.stringify(v.alreadyValidatedIds)
      );
    } catch {
      return false;
    }
  });
export const copilotOfferValidationProposalSchema = z.strictObject({
  kind: z.literal("OFFER_VALIDATION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotOfferValidationInputSchema,
  basis: offerValidationPreviewBasisSchema,
});
export function readCopilotOfferValidationProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("OFFER_VALIDATION_INVALID");
  const content = copilotOfferValidationProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.storeId !== message.storeId)
    throw Error("OFFER_VALIDATION_SCOPE");
  return {
    message,
    content,
    request: offerValidationPreviewRequest(
      content.input,
      content.basis,
      message.id,
    ),
  };
}
