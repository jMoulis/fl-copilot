import { z } from "zod";
import {
  copilotPlanReadinessInputSchema,
  copilotPlanReadinessResultSchema,
} from "./copilot-plan-readiness";
import {
  planPreviewResultSchema,
  planValidateRequestSchema,
} from "./copilot-commercial-plan";
import { copilotMessageSchema } from "./copilot-conversation";
export const copilotPlanValidationPreviewSchema = z
  .strictObject({
    storeId: z.uuid(),
    input: copilotPlanReadinessInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "BLOCKED",
      "NO_DRAFT",
      "LIMIT_EXCEEDED",
    ]),
    preview: planPreviewResultSchema.nullable(),
    issues: copilotPlanReadinessResultSchema.shape.issues,
    evidence: copilotPlanReadinessResultSchema.shape.evidence,
  })
  .refine((v) => {
    if (v.status !== "READY")
      return (
        v.preview === null &&
        (v.status === "BLOCKED" ? v.issues.length > 0 : !v.issues.length)
      );
    const p = v.preview;
    return (
      !!p?.candidate &&
      !v.issues.length &&
      !p.issues.length &&
      p.candidate.storeId === v.storeId &&
      p.candidate.weekStart === v.input.weekStart &&
      p.candidate.version === (p.expectedPlanVersion ?? 0) + 1
    );
  });
export const copilotPlanValidationProposalSchema = z
  .strictObject({
    kind: z.literal("PLAN_VALIDATION_PROPOSAL"),
    schemaVersion: z.literal(1),
    assistantMessageId: z.uuid(),
    preview: planPreviewResultSchema,
  })
  .refine(
    (v) =>
      !!v.preview.candidate &&
      !v.preview.issues.length &&
      v.preview.candidate.version === (v.preview.expectedPlanVersion ?? 0) + 1,
  );
export function readCopilotPlanValidationProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("PLAN_VALIDATION_INVALID");
  const content = copilotPlanValidationProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (
    content.preview.candidate!.storeId !== message.storeId ||
    content.preview.operationId === message.id
  )
    throw Error("PLAN_VALIDATION_SCOPE");
  return {
    message,
    content,
    request: planValidateRequestSchema.parse({
      operationId: message.id,
      schemaVersion: 1,
      tool: "commercial.plan.validate",
      input: { previewOperationId: content.preview.operationId },
    }),
  };
}
/** Only application-time fields differ between reviewed candidate and saved plan. */
export function planReviewBusinessSignature(
  p: NonNullable<z.infer<typeof planPreviewResultSchema>["candidate"]>,
) {
  const { createdAt, updatedAt, validatedAt, ...rest } = p;
  void createdAt;
  void updatedAt;
  void validatedAt;
  return JSON.stringify({
    ...rest,
    operations: p.operations.map(({ createdAt, updatedAt, ...o }) => {
      void createdAt;
      void updatedAt;
      return o;
    }),
    offers: p.offers.map(({ createdAt, updatedAt, ...o }) => {
      void createdAt;
      void updatedAt;
      return o;
    }),
  });
}
