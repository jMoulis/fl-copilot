import { ProductMasterRepository } from "../products/product-master-repository";
import {
  readCopilotChoiceRetentionProposal,
  choiceSaveIntent,
  choiceSaveResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import { CopilotCommercialChoiceRuntime } from "./commercial-choice-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotChoiceRetentionController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canManageCommercialChoices: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } =
      readCopilotChoiceRetentionProposal(raw);
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
      const r = choiceSaveResultSchema.parse(JSON.parse(previous.result_json));
      const { id, storeId, version, createdAt, updatedAt, ...draft } = r.after;
      void id;
      void storeId;
      void version;
      void createdAt;
      void updatedAt;
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        r.after.id !== content.basis.before.id ||
        r.after.storeId !== message.storeId ||
        r.after.version !== content.basis.before.version + 1 ||
        r.operationId !== message.id ||
        r.userMessageId !== message.replyToMessageId ||
        JSON.stringify(r.before) !== JSON.stringify(content.basis.before) ||
        JSON.stringify(draft) !== JSON.stringify(request.input.draft)
      )
        throw Error("CHOICE_RETENTION_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const choice = await new CommercialChoiceRepository(
      this.db,
      this.digest,
    ).get(this.scope.storeId, content.input.choiceId);
    const product = await new ProductMasterRepository(this.db).getProduct(
      content.basis.product.id,
    );
    const stale =
      !product ||
      ["ERROR", "CONFLICT"].includes(product.syncState) ||
      JSON.stringify(product.entity) !==
        JSON.stringify(content.basis.product) ||
      !choice ||
      ["ERROR", "CONFLICT"].includes(choice.syncState) ||
      JSON.stringify(choice.entity) !== JSON.stringify(content.basis.before);
    return {
      message,
      content,
      request,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(message: CopilotMessage, signal?: AbortSignal) {
    if (!this.scope.canManageCommercialChoices)
      throw Error("CHOICE_RETENTION_FORBIDDEN");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY") throw Error("CHOICE_RETENTION_STALE");
    await new CopilotCommercialChoiceRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      state.request,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: choiceSaveIntent(state.request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
