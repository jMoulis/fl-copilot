import { z } from "zod";
import { commercialOfferChoiceSchema } from "./commercial-offer-choice";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { choiceSaveRequestSchema } from "./copilot-commercial-choice";
export const copilotChoiceWithdrawalInputSchema = z.strictObject({
  choiceId: z.uuid(),
});
export const copilotChoiceWithdrawalPreviewSchema = z
  .strictObject({
    input: copilotChoiceWithdrawalInputSchema,
    status: z.enum(["READY", "UNCHANGED", "UNAVAILABLE", "LIMIT_EXCEEDED"]),
    before: commercialOfferChoiceSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .refine((v) =>
    ["UNAVAILABLE", "LIMIT_EXCEEDED"].includes(v.status)
      ? v.before === null
      : v.before?.id === v.input.choiceId &&
        v.before.status === (v.status === "READY" ? "RETAINED" : "WITHDRAWN"),
  );
export function choiceWithdrawalRequest(
  before: z.infer<typeof commercialOfferChoiceSchema>,
  operationId: string,
) {
  if (before.status !== "RETAINED") throw Error("CHOICE_WITHDRAWAL_INVALID");
  const { id, storeId, version, createdAt, updatedAt, ...draft } = before;
  void id;
  void storeId;
  void createdAt;
  void updatedAt;
  return choiceSaveRequestSchema.parse({
    operationId,
    schemaVersion: 1,
    tool: "commercial.choice.save",
    input: {
      expectedVersion: version,
      productVersion: null,
      draft: { ...draft, status: "WITHDRAWN" },
    },
  });
}
export const copilotChoiceWithdrawalProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_CHOICE_WITHDRAWAL_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotChoiceWithdrawalInputSchema,
  before: commercialOfferChoiceSchema,
});
export function readCopilotChoiceWithdrawalProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("CHOICE_WITHDRAWAL_INVALID");
  const content = copilotChoiceWithdrawalProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (
    content.before.storeId !== message.storeId ||
    content.before.id !== content.input.choiceId
  )
    throw Error("CHOICE_WITHDRAWAL_SCOPE");
  return {
    message,
    content,
    request: choiceWithdrawalRequest(content.before, message.id),
  };
}
