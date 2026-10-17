import {
  readCopilotReferenceProposal,
  referenceSaveIntent,
  referenceSaveResultSchema,
  referenceDesiredValue,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { commercialVersionDecisionId } from "@fl-copilot/commercial-core";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CommercialVersionDecisionRepository } from "../commercial/version-decision-repository";
import {
  CopilotReferenceRuntime,
  referenceReviewIsCurrent,
} from "./reference-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotReferenceController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canManageCommercialReferences: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } = readCopilotReferenceProposal(raw);
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
      const result = referenceSaveResultSchema.parse(
          JSON.parse(journal.result_json),
        ),
        { id, version, createdAt, updatedAt, ...business } = result.after;
      if (
        journal.store_id !== message.storeId ||
        journal.owner_id !== message.ownerId ||
        journal.conversation_id !== message.conversationId ||
        journal.request_json !== JSON.stringify(request) ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        JSON.stringify(result.before) !==
          JSON.stringify(content.basis.previous) ||
        id !==
          (await commercialVersionDecisionId(
            message.storeId,
            content.input.beforeDocumentId,
            content.input.afterDocumentId,
            this.digest,
          )) ||
        version !== (content.basis.previous?.version ?? 0) + 1 ||
        createdAt !== (content.basis.previous?.createdAt ?? result.appliedAt) ||
        updatedAt !== result.appliedAt ||
        JSON.stringify(business) !==
          JSON.stringify(referenceDesiredValue(content.input, content.basis))
      )
        throw Error("COMMERCIAL_REFERENCE_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const before = await new CommercialVersionDecisionRepository(
      this.db,
      this.digest,
    ).get(
      this.scope.storeId,
      content.input.beforeDocumentId,
      content.input.afterDocumentId,
    );
    const current =
      JSON.stringify(before?.entity ?? null) ===
        JSON.stringify(content.basis.previous) &&
      !(before && ["ERROR", "CONFLICT"].includes(before.syncState)) &&
      (await referenceReviewIsCurrent(this.db, content.basis));
    return {
      message,
      content,
      request,
      status: current ? ("READY" as const) : ("STALE" as const),
    };
  }
  async confirm(
    message: CopilotMessage,
    reviewed: boolean,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canManageCommercialReferences)
      throw Error("COMMERCIAL_REFERENCE_FORBIDDEN");
    if (reviewed !== true) throw Error("COMMERCIAL_REFERENCE_REVIEW_REQUIRED");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY") throw Error("COMMERCIAL_REFERENCE_STALE");
    await new CopilotReferenceRuntime(this.db, this.digest, this.id).execute(
      state.request,
      {
        ...this.scope,
        comparisonReviewed: true,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: referenceSaveIntent(state.request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
