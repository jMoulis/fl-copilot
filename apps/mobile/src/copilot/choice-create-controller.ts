import { readCommercialChoiceSource } from "../commercial/choice-source";
import {
  readCopilotChoiceCreateProposal,
  choiceSaveIntent,
  choiceSaveResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { commercialChoiceId } from "@fl-copilot/commercial-core";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import { CopilotCommercialChoiceRuntime } from "./commercial-choice-runtime";
import { verifyPrivateToolRecord } from "./private-tool-record";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotChoiceCreateController {
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
    const { message, content, request } = readCopilotChoiceCreateProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const choiceId = await commercialChoiceId(
      this.scope.storeId,
      content.input.source,
      this.digest,
    );
    const previous = await this.db.getFirstAsync<{
      result_json: string;
      store_id: string;
      owner_id: string;
      conversation_id: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (previous) {
      const r = choiceSaveResultSchema.parse(JSON.parse(previous.result_json)),
        { id, storeId, version, createdAt, updatedAt, ...draft } = r.after;
      void createdAt;
      void updatedAt;
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        id !== choiceId ||
        storeId !== message.storeId ||
        version !== 1 ||
        r.before !== null ||
        r.operationId !== message.id ||
        r.userMessageId !== message.replyToMessageId ||
        JSON.stringify(draft) !== JSON.stringify(request.input.draft)
      )
        throw Error("CHOICE_CREATE_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const choice = await new CommercialChoiceRepository(
        this.db,
        this.digest,
      ).get(this.scope.storeId, choiceId),
      product = await new ProductMasterRepository(this.db).getProduct(
        content.input.productId,
      ),
      source = await readCommercialChoiceSource(this.db, {
        ...request.input.draft,
        storeId: this.scope.storeId,
      });
    const sourceMatches =
      source.offer !== null &&
      JSON.stringify(source.offer) === JSON.stringify(content.basis.offer);
    const stale =
      !!choice ||
      !sourceMatches ||
      !product ||
      ["ERROR", "CONFLICT"].includes(product.syncState) ||
      JSON.stringify(product.entity) !== JSON.stringify(content.basis.product);
    return {
      message,
      content,
      request,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(
    message: CopilotMessage,
    review: {
      criticalFieldsConfirmed: boolean;
      applicabilityConfirmed: boolean;
    },
    signal?: AbortSignal,
  ) {
    if (!this.scope.canManageCommercialChoices)
      throw Error("CHOICE_CREATE_FORBIDDEN");
    if (
      review.criticalFieldsConfirmed !== true ||
      review.applicabilityConfirmed !== true
    )
      throw Error("CHOICE_CREATE_REVIEW_REQUIRED");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY") throw Error("CHOICE_CREATE_STALE");
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
