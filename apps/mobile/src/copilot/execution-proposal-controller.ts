import {
  readCopilotExecutionProposal,
  executionProposalSchema,
  executionSaveIntent,
  executionSaveResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  commercialExecutionChecklist,
  commercialExecutionSameTarget,
  commercialExecutionPlanChecksum,
} from "@fl-copilot/commercial-core";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import { CommercialExecutionRepository } from "../commercial/execution-repository";
import { CopilotCommercialExecutionRuntime } from "./commercial-execution-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotExecutionProposalController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canDeclareCommercialExecution: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content } = readCopilotExecutionProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const previous = await this.db.getFirstAsync<{
      result_json: string;
      store_id: string;
      owner_id: string;
      conversation_id: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (previous) {
      const result = executionSaveResultSchema.parse(
        JSON.parse(previous.result_json),
      );
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        !commercialExecutionSameTarget(result.after, content.proposal) ||
        result.after.status !== content.input.status ||
        result.after.note !== content.input.note
      )
        throw Error("COPILOT_EXECUTION_PROPOSAL_SCOPE_INVALID");
      return { message, content, status: "COMPLETED" as const };
    }
    const plan = await new CommercialPlanRepository(this.db, this.digest).get(
      this.scope.storeId,
      content.input.weekStart,
    );
    const record = await new CommercialExecutionRepository(
      this.db,
      this.digest,
    ).get(this.scope.storeId, content.proposal.id);
    const target = plan
      ? (await commercialExecutionChecklist(plan.entity, this.digest)).find(
          (t) => t.id === content.proposal.id,
        )
      : undefined;
    const stale =
      !plan ||
      !target ||
      ["ERROR", "CONFLICT"].includes(plan.syncState) ||
      plan.entity.id !== content.proposal.planId ||
      plan.entity.revisionId !== content.proposal.planRevisionId ||
      plan.entity.version !== content.proposal.planVersion ||
      (await commercialExecutionPlanChecksum(plan.entity, this.digest)) !==
        content.proposal.planChecksum ||
      JSON.stringify(executionProposalSchema.parse(target)) !==
        JSON.stringify(content.proposal) ||
      (record && ["ERROR", "CONFLICT"].includes(record.syncState)) ||
      JSON.stringify(record?.entity ?? null) !== JSON.stringify(content.before);
    return {
      message,
      content,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  /** Explicit local review only; the model cannot invoke the canonical writer. */
  async confirm(message: CopilotMessage, signal?: AbortSignal) {
    if (!this.scope.canDeclareCommercialExecution)
      throw Error("COPILOT_EXECUTION_PROPOSAL_FORBIDDEN");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY")
      throw Error("COPILOT_EXECUTION_PROPOSAL_STALE");
    const request = {
      operationId: message.id,
      schemaVersion: 1,
      tool: "commercial.execution.save",
      input: {
        ...state.content.input,
        planVersion: state.content.proposal.planVersion,
        expectedVersion: state.content.before?.version ?? null,
      },
    };
    await new CopilotCommercialExecutionRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      request,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: executionSaveIntent(request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
