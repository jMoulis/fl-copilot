import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import { commercialExecutionTaskSchema } from "./commercial-execution-task";
import {
  recommendationDecisionRevisionSchema,
  recommendationTrackingBasisSchema,
} from "./copilot-recommendation-decision";
import { contextWeekQuerySchema } from "./weekly-context";
const id = z.uuid(),
  time = z
    .string()
    .datetime()
    .transform((s) => new Date(s).toISOString());
export const executionLinkInputSchema = z
  .strictObject({
    recommendationId: id,
    decisionVersion: z.number().int().min(1).max(50),
    weekStart: contextWeekQuerySchema.shape.weekStart,
    taskId: id,
    taskVersion: z.number().int().positive(),
  })
  .refine(
    (v) => new Date(v.weekStart + "T00:00:00Z").getUTCDay() === 1,
    "La semaine commence un lundi.",
  );
export const executionLinkSnapshotSchema = z
  .strictObject({
    decision: z.strictObject({
      id,
      version: z.number().int().min(1).max(50),
      conversationId: id,
      revision: recommendationDecisionRevisionSchema,
      basis: recommendationTrackingBasisSchema,
    }),
    weekStart: contextWeekQuerySchema.shape.weekStart,
    task: commercialExecutionTaskSchema,
  })
  .superRefine((v, c) => {
    if (
      v.decision.version !== v.decision.revision.version ||
      new Date(v.weekStart + "T00:00:00Z").getUTCDay() !== 1
    )
      c.addIssue({ code: "custom", message: "Invalid linked revision" });
  });
export function executionLinkSnapshotMatches(
  input: z.infer<typeof executionLinkInputSchema>,
  snapshot: z.infer<typeof executionLinkSnapshotSchema>,
) {
  return (
    input.recommendationId === snapshot.decision.id &&
    input.decisionVersion === snapshot.decision.version &&
    input.weekStart === snapshot.weekStart &&
    input.taskId === snapshot.task.id &&
    input.taskVersion === snapshot.task.version
  );
}
export const executionLinkPreviewSchema = z
  .strictObject({
    input: executionLinkInputSchema,
    status: z.enum([
      "READY",
      "DECISION_UNAVAILABLE",
      "DECISION_CHANGED",
      "SOURCE_UNAVAILABLE",
      "TASK_UNAVAILABLE",
      "TASK_CHANGED",
    ]),
    snapshot: executionLinkSnapshotSchema.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(3),
  })
  .superRefine((v, c) => {
    if (
      (v.status === "READY") !== !!v.snapshot ||
      (v.snapshot && !executionLinkSnapshotMatches(v.input, v.snapshot))
    )
      c.addIssue({ code: "custom", message: "Invalid execution link preview" });
  });
export const executionLinkProposalSchema = z.strictObject({
  kind: z.literal("EXECUTION_LINK_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: id,
  input: executionLinkInputSchema,
  snapshot: executionLinkSnapshotSchema,
});
export function readExecutionLinkProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw),
    content = executionLinkProposalSchema.parse(JSON.parse(message.text));
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length ||
    content.snapshot.task.storeId !== message.storeId ||
    !executionLinkSnapshotMatches(content.input, content.snapshot)
  )
    throw Error("COPILOT_EXECUTION_LINK_INVALID");
  return { message, content };
}
export const copilotExecutionLinkSchema = z
  .strictObject({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    proposalMessageId: id,
    snapshot: executionLinkSnapshotSchema,
    createdAt: time,
    withdrawnAt: time.nullable(),
    version: z.union([z.literal(1), z.literal(2)]),
  })
  .superRefine((v, c) => {
    if (
      v.id !== v.proposalMessageId ||
      v.snapshot.task.storeId !== v.storeId ||
      (v.version === 2) !== !!v.withdrawnAt ||
      (v.withdrawnAt && v.withdrawnAt < v.createdAt) ||
      v.createdAt < v.snapshot.decision.revision.decidedAt ||
      v.createdAt < v.snapshot.task.updatedAt
    )
      c.addIssue({ code: "custom", message: "Invalid execution association" });
  });
export type CopilotExecutionLink = z.infer<typeof copilotExecutionLinkSchema>;
/** Confirmation timestamps can differ when two devices confirm the same immutable card. */
export function sameExecutionLinkIdentity(
  a: CopilotExecutionLink,
  b: CopilotExecutionLink,
) {
  return (
    JSON.stringify([
      a.id,
      a.storeId,
      a.ownerId,
      a.conversationId,
      a.proposalMessageId,
      a.snapshot,
    ]) ===
    JSON.stringify([
      b.id,
      b.storeId,
      b.ownerId,
      b.conversationId,
      b.proposalMessageId,
      b.snapshot,
    ])
  );
}
export const executionLinksReadInputSchema = z.strictObject({
  recommendationId: id.nullable(),
  afterId: id.nullable(),
  limit: z.number().int().min(1).max(5),
});
export const executionLinksReadResultSchema = z
  .strictObject({
    input: executionLinksReadInputSchema,
    entries: z.array(copilotExecutionLinkSchema).max(5),
    hasMore: z.boolean(),
    nextAfterId: id.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(6),
  })
  .superRefine((v, c) => {
    if (
      v.hasMore !== !!v.nextAfterId ||
      v.entries.length > v.input.limit ||
      v.entries.some(
        (e) =>
          (v.input.recommendationId &&
            e.snapshot.decision.id !== v.input.recommendationId) ||
          (v.input.afterId && e.id <= v.input.afterId),
      )
    )
      c.addIssue({ code: "custom", message: "Invalid link coverage" });
  });
