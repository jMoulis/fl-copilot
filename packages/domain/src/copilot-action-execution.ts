import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import {
  recommendationTrackingInputSchema,
  recommendationTrackingBasisSchema,
} from "./copilot-recommendation-decision";
import { commercialExecutionActualsSchema } from "./commercial-execution-task";
const id = z.uuid(),
  time = z
    .string()
    .datetime()
    .transform((s) => new Date(s).toISOString());
export const actionExecutionInputSchema =
  recommendationTrackingInputSchema.extend({
    action: z.string().trim().min(1).max(1200),
    actuals: commercialExecutionActualsSchema.nullable(),
    notes: z.string().trim().min(1).max(1200).nullable(),
  });
export const actionExecutionSnapshotSchema = z.strictObject({
  basis: recommendationTrackingBasisSchema,
  action: actionExecutionInputSchema.shape.action,
  actuals: actionExecutionInputSchema.shape.actuals,
  notes: actionExecutionInputSchema.shape.notes,
});
function matches(
  input: z.infer<typeof actionExecutionInputSchema>,
  s: z.infer<typeof actionExecutionSnapshotSchema>,
) {
  return (
    input.sourceMessageId === s.basis.sourceMessageId &&
    input.quote === s.basis.quote &&
    input.action === s.action &&
    JSON.stringify(input.actuals) === JSON.stringify(s.actuals) &&
    input.notes === s.notes
  );
}
export const actionExecutionPreviewSchema = z
  .strictObject({
    input: actionExecutionInputSchema,
    status: z.enum(["READY", "SOURCE_UNAVAILABLE"]),
    snapshot: actionExecutionSnapshotSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(1),
  })
  .superRefine((v, c) => {
    if (
      (v.status === "READY") !== !!v.snapshot ||
      (v.snapshot && !matches(v.input, v.snapshot))
    )
      c.addIssue({
        code: "custom",
        message: "Invalid action execution preview",
      });
  });
export const actionExecutionProposalSchema = z.strictObject({
  kind: z.literal("ACTION_EXECUTION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: id,
  recommendationId: id,
  input: actionExecutionInputSchema,
  snapshot: actionExecutionSnapshotSchema,
});
export function readActionExecutionProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw),
    content = actionExecutionProposalSchema.parse(JSON.parse(message.text));
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length ||
    message.id === content.snapshot.basis.sourceMessageId ||
    content.assistantMessageId === content.snapshot.basis.sourceMessageId ||
    !matches(content.input, content.snapshot)
  )
    throw Error("COPILOT_ACTION_EXECUTION_INVALID");
  return { message, content };
}
export const actionExecutionSchema = z
  .strictObject({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    proposalMessageId: id,
    recommendationId: id,
    decisionId: z.null(),
    actionType: z.literal("USER_DECLARED"),
    plannedStart: z.null(),
    plannedEnd: z.null(),
    snapshot: actionExecutionSnapshotSchema,
    status: z.enum(["DECLARED_DONE", "WITHDRAWN"]),
    createdAt: time,
    withdrawnAt: time.nullable(),
    version: z.union([z.literal(1), z.literal(2)]),
  })
  .superRefine((v, c) => {
    if (
      v.id !== v.proposalMessageId ||
      (v.version === 2) !== !!v.withdrawnAt ||
      (v.version === 2) !== (v.status === "WITHDRAWN") ||
      (v.withdrawnAt && v.withdrawnAt < v.createdAt) ||
      v.createdAt < v.snapshot.basis.sourceCreatedAt
    )
      c.addIssue({
        code: "custom",
        message: "Invalid action execution declaration",
      });
  });
export type ActionExecution = z.infer<typeof actionExecutionSchema>;
export function sameActionExecutionIdentity(
  a: ActionExecution,
  b: ActionExecution,
) {
  return (
    JSON.stringify([
      a.id,
      a.storeId,
      a.ownerId,
      a.conversationId,
      a.proposalMessageId,
      a.recommendationId,
      a.snapshot,
    ]) ===
    JSON.stringify([
      b.id,
      b.storeId,
      b.ownerId,
      b.conversationId,
      b.proposalMessageId,
      b.recommendationId,
      b.snapshot,
    ])
  );
}
export const actionExecutionsReadInputSchema = z.strictObject({
  recommendationId: id.nullable(),
  afterId: id.nullable(),
  limit: z.number().int().min(1).max(5),
});
export const actionExecutionsReadResultSchema = z
  .strictObject({
    input: actionExecutionsReadInputSchema,
    entries: z.array(actionExecutionSchema).max(5),
    hasMore: z.boolean(),
    nextAfterId: id.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(6),
  })
  .superRefine((v, c) => {
    if (
      v.entries.length > v.input.limit ||
      v.hasMore !== (v.nextAfterId !== null) ||
      (v.nextAfterId && v.nextAfterId !== v.entries.at(-1)?.id) ||
      v.entries.some(
        (e, i) =>
          !!(
            v.input.recommendationId &&
            e.recommendationId !== v.input.recommendationId
          ) ||
          !!(v.input.afterId && e.id <= v.input.afterId) ||
          (i > 0 && e.id <= v.entries[i - 1]!.id),
      )
    )
      c.addIssue({ code: "custom", message: "Invalid execution page" });
  });
