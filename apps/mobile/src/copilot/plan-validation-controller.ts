import {
  readCopilotPlanValidationProposal,
  planValidateIntent,
  planValidateResultSchema,
  planReviewBusinessSignature,
  copilotMessageSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { readCopilotContext } from "./context-readers";
import { CopilotCommercialPlanRuntime } from "./commercial-plan-runtime";
import { CopilotConversationRepository } from "./conversation-repository";
import { joinedProductToolDatabase } from "./product-tool-transaction";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotPlanValidationController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canValidateCommercialPlan: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } =
      readCopilotPlanValidationProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const row = await this.db.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (row) {
      const result = planValidateResultSchema.parse(
        JSON.parse(row.result_json),
      );
      const acceptedRow = await this.db.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
        result.userMessageId,
        message.storeId,
        message.ownerId,
        message.conversationId,
      );
      const accepted = acceptedRow
        ? copilotMessageSchema.parse(JSON.parse(acceptedRow.payload_json))
        : null;
      if (
        row.store_id !== message.storeId ||
        row.owner_id !== message.ownerId ||
        row.conversation_id !== message.conversationId ||
        row.request_json !== JSON.stringify(request) ||
        result.operationId !== message.id ||
        result.previewOperationId !== content.preview.operationId ||
        planReviewBusinessSignature(result.after) !==
          planReviewBusinessSignature(content.preview.candidate!) ||
        !accepted ||
        accepted.role !== "USER" ||
        accepted.replyToMessageId !== content.assistantMessageId ||
        Date.parse(accepted.createdAt) < Date.parse(content.preview.observedAt)
      )
        throw Error("PLAN_VALIDATION_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const current = await readCopilotContext(
      this.db,
      this.scope.storeId,
      {
        operationId: content.preview.operationId,
        schemaVersion: 1,
        tool: "commercial.plan.preview",
        input: {
          weekStart: content.preview.candidate!.weekStart,
          ...(content.preview.reviewBasis ? { groupOfferReview: true } : {}),
        },
      },
      content.preview.observedAt,
      this.digest,
    );
    if (!("candidate" in current)) throw Error("PLAN_VALIDATION_INVALID");
    return {
      message,
      content,
      request,
      status:
        JSON.stringify(current.candidate) ===
          JSON.stringify(content.preview.candidate) &&
        current.expectedPlanVersion === content.preview.expectedPlanVersion &&
        JSON.stringify(current.reviewBasis) ===
          JSON.stringify(content.preview.reviewBasis) &&
        !current.issues.length
          ? ("READY" as const)
          : ("STALE" as const),
    };
  }
  async confirm(
    message: CopilotMessage,
    reviewed: boolean,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canValidateCommercialPlan)
      throw Error("PLAN_VALIDATION_FORBIDDEN");
    if (reviewed !== true) throw Error("PLAN_VALIDATION_REVIEW_REQUIRED");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (signal?.aborted) throw Error("PLAN_VALIDATION_CANCELLED");
      const joined = joinedProductToolDatabase(tx),
        controller = new CopilotPlanValidationController(
          joined,
          this.scope,
          this.digest,
          this.id,
          this.now,
        ),
        state = await controller.open(message);
      if (state.status === "COMPLETED") return;
      if (state.status !== "READY") throw Error("PLAN_VALIDATION_STALE");
      const createdAt = this.now();
      if (Date.parse(createdAt) < Date.parse(state.content.preview.observedAt))
        throw Error("PLAN_VALIDATION_CLOCK");
      const userMessageId = this.id();
      await new CopilotConversationRepository(joined, this.scope).append(
        {
          ...message,
          id: userMessageId,
          role: "USER",
          text: `Je confirme le plan de la semaine du ${state.content.preview.candidate!.weekStart}, avec les offres et les TG affichées.`,
          attachments: [],
          replyToMessageId: state.content.assistantMessageId,
          supersedesMessageId: null,
          createdAt,
        },
        {
          commandId: this.id(),
          deviceId: this.scope.deviceId,
          preserveDraft: true,
        },
      );
      const existing = await tx.getFirstAsync<{ result_json: string }>(
        "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
        state.content.preview.operationId,
      );
      if (existing) throw Error("PLAN_VALIDATION_PREVIEW_CONFLICT");
      await tx.runAsync(
        "INSERT INTO copilot_tool_results(operation_id,store_id,owner_id,conversation_id,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?)",
        state.content.preview.operationId,
        message.storeId,
        message.ownerId,
        message.conversationId,
        JSON.stringify({
          operationId: state.content.preview.operationId,
          schemaVersion: 1,
          tool: "commercial.plan.preview",
          input: {
            weekStart: state.content.preview.candidate!.weekStart,
            ...(state.content.preview.reviewBasis
              ? { groupOfferReview: true }
              : {}),
          },
        }),
        JSON.stringify(state.content.preview),
        state.content.preview.observedAt,
      );
      await new CopilotCommercialPlanRuntime(
        joined,
        this.digest,
        this.id,
        this.now,
      ).execute(
        state.request,
        {
          ...this.scope,
          conversationId: message.conversationId,
          userMessageId,
          authorizedRequestJson: planValidateIntent(state.request),
          decisionLevel: "REVIEWED",
        },
        signal,
      );
      if (signal?.aborted) throw Error("PLAN_VALIDATION_CANCELLED");
    });
    return this.open(message);
  }
}
