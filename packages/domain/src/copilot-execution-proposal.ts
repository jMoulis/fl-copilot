import { z } from "zod";
import { copilotMessageSchema } from "./copilot-conversation";
import { copilotEvidenceSchema } from "./copilot-candidate";
import {
  executionProposalSchema,
  executionSaveInputSchema,
} from "./copilot-commercial-execution";
import {
  commercialExecutionTaskSchema,
  commercialExecutionActualsPatchSchema,
  executionActualsUpdate,
  commercialExecutionTargetMatches,
} from "./commercial-execution-task";
export const legacyCopilotExecutionPreviewInputSchema = z
  .strictObject({
    weekStart: executionSaveInputSchema.shape.weekStart,
    taskId: executionSaveInputSchema.shape.taskId,
    status: executionSaveInputSchema.shape.status,
    note: executionSaveInputSchema.shape.note,
  })
  .refine((v) => new Date(v.weekStart + "T00:00:00Z").getUTCDay() === 1)
  .refine((v) => !["SKIPPED", "NOT_APPLICABLE"].includes(v.status) || !!v.note);
export const copilotExecutionPreviewInputSchema =
  legacyCopilotExecutionPreviewInputSchema.safeExtend({
    actuals: commercialExecutionActualsPatchSchema.nullable().optional(),
  });
const preview = z.strictObject({
  proposal: executionProposalSchema,
  before: commercialExecutionTaskSchema.nullable(),
});
function coherent(
  input: z.infer<typeof copilotExecutionPreviewInputSchema>,
  p: z.infer<typeof preview>,
) {
  try {
    executionActualsUpdate(p.before, input);
  } catch {
    return false;
  }
  return (
    p.proposal.id === input.taskId &&
    (!p.before || commercialExecutionTargetMatches(p.before, p.proposal))
  );
}
export const copilotExecutionPreviewResultSchema = z
  .strictObject({
    input: copilotExecutionPreviewInputSchema,
    status: z.enum([
      "READY",
      "UNCHANGED",
      "NO_PLAN",
      "TASK_UNAVAILABLE",
      "LIMIT_EXCEEDED",
    ]),
    preview: preview.nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(2),
  })
  .superRefine((v, c) => {
    const p = v.preview;
    if (
      ["READY", "UNCHANGED"].includes(v.status) !== !!p ||
      (p && !coherent(v.input, p)) ||
      (v.status === "UNCHANGED" &&
        (!p?.before ||
          p.before.status !== v.input.status ||
          p.before.note !== v.input.note ||
          JSON.stringify(p.before.actuals ?? null) !==
            JSON.stringify(
              executionActualsUpdate(p.before, v.input).actuals ?? null,
            )))
    )
      c.addIssue({ code: "custom", message: "Invalid execution preview" });
  });
export const copilotExecutionProposalSchema = z.strictObject({
  kind: z.literal("COMMERCIAL_EXECUTION_PROPOSAL"),
  schemaVersion: z.literal(1),
  assistantMessageId: z.uuid(),
  input: copilotExecutionPreviewInputSchema,
  proposal: executionProposalSchema,
  before: commercialExecutionTaskSchema.nullable(),
});
export function readCopilotExecutionProposal(raw: unknown) {
  const message = copilotMessageSchema.parse(raw);
  if (
    message.role !== "TOOL" ||
    !message.replyToMessageId ||
    message.attachments.length
  )
    throw Error("COPILOT_EXECUTION_PROPOSAL_INVALID");
  const content = copilotExecutionProposalSchema.parse(
    JSON.parse(message.text),
  );
  if (!coherent(content.input, content))
    throw Error("COPILOT_EXECUTION_PROPOSAL_INVALID");
  if (content.proposal.storeId !== message.storeId)
    throw Error("COPILOT_EXECUTION_PROPOSAL_SCOPE_INVALID");
  return { message, content };
}
