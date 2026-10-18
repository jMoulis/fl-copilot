import {
  readIdentityReviewProposal,
  identityReviewResultSchema,
  identityReviewAfter,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import {
  checkIdentityReviewCurrent,
  CopilotIdentityReviewRuntime,
} from "./identity-review-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotIdentityReviewController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canManageProducts: boolean;
    },
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } = readIdentityReviewProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const journal = await this.db.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (journal) {
      const result = identityReviewResultSchema.parse(
        JSON.parse(journal.result_json),
      );
      if (
        journal.store_id !== message.storeId ||
        journal.owner_id !== message.ownerId ||
        journal.conversation_id !== message.conversationId ||
        journal.request_json !== JSON.stringify(request) ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        JSON.stringify(result.before) !== JSON.stringify(content.before) ||
        JSON.stringify(result.after) !==
          JSON.stringify(
            identityReviewAfter(
              content.input,
              content.before,
              result.appliedAt,
            ),
          )
      )
        throw Error("IDENTITY_REVIEW_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    await checkIdentityReviewCurrent(
      this.db,
      this.scope.storeId,
      content.input,
      content.before,
    );
    return { message, content, request, status: "READY" as const };
  }
  async confirm(
    message: CopilotMessage,
    reactivateRejectedAlias: boolean,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canManageProducts) throw Error("IDENTITY_REVIEW_FORBIDDEN");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    await new CopilotIdentityReviewRuntime(this.db, this.id).execute(
      state.request,
      {
        ...this.scope,
        reactivateRejectedAlias,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: JSON.stringify(state.request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
