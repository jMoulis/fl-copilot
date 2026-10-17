import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { productSchema } from "./products";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { choiceSaveRequestSchema } from "./copilot-commercial-choice";
const fields = commercialOfferChoiceSchema.shape;
export const copilotChoiceUpdateInputSchema = z.strictObject({
  choiceId: z.uuid(),
  patch: z
    .strictObject({
      saleStart: fields.saleStart.optional(),
      saleEnd: fields.saleEnd.optional(),
      mechanism: z.union(fields.mechanism.options).optional(),
      note: fields.note.optional(),
    })
    .refine((v) => Object.keys(v).length > 0),
});
export const choiceUpdateBasisSchema = z.strictObject({
  before: commercialOfferChoiceSchema,
  product: productSchema,
});
export function choiceUpdateRequest(
  input: z.infer<typeof copilotChoiceUpdateInputSchema>,
  basis: z.infer<typeof choiceUpdateBasisSchema>,
  operationId: string,
) {
  const { before, product } = choiceUpdateBasisSchema.parse(basis);
  if (
    before.id !== input.choiceId ||
    before.status !== "RETAINED" ||
    product.id !== before.productId ||
    product.storeId !== before.storeId ||
    product.status !== "ACTIVE" ||
    product.deletedAt
  )
    throw Error("CHOICE_UPDATE_SCOPE");
  const after = commercialOfferChoiceSchema.parse({
    ...before,
    ...input.patch,
    ...(input.patch.note !== undefined
      ? { note: input.patch.note || null }
      : {}),
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
export function choiceUpdateHasChanges(
  input: z.infer<typeof copilotChoiceUpdateInputSchema>,
  before: z.infer<typeof commercialOfferChoiceSchema>,
) {
  return Object.entries(input.patch).some(
    ([key, value]) =>
      JSON.stringify(before[key as keyof typeof before]) !==
      JSON.stringify(key === "note" && value === "" ? null : value),
  );
}
export const copilotChoiceUpdatePreviewSchema = z
  .strictObject({
    input: copilotChoiceUpdateInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "BLOCKED",
      "UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    basis: choiceUpdateBasisSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((v) => {
    if (!["READY", "UNCHANGED"].includes(v.status)) return v.basis === null;
    if (!v.basis || v.basis.before.id !== v.input.choiceId) return false;
    try {
      choiceUpdateRequest(
        v.input,
        v.basis,
        "00000000-0000-4000-8000-000000000001",
      );
    } catch {
      return false;
    }
    return (
      choiceUpdateHasChanges(v.input, v.basis.before) === (v.status === "READY")
    );
  });
export const copilotChoiceUpdateProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_CHOICE_UPDATE_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotChoiceUpdateInputSchema,
  basis: choiceUpdateBasisSchema,
});
export function readCopilotChoiceUpdateProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("CHOICE_UPDATE_INVALID");
  const content = copilotChoiceUpdateProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (content.basis.before.storeId !== message.storeId)
    throw Error("CHOICE_UPDATE_SCOPE");
  return {
    message,
    content,
    request: choiceUpdateRequest(content.input, content.basis, message.id),
  };
}
