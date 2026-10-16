import {
  readCopilotNeedProposal,
  needProposalBasisSchema,
  needProposalRefused,
  prepareNeedProposalRequest,
  needToolIntent,
  needToolResultSchema,
  needMembershipId,
  productSubstitutionId,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { NeedUnitRepository } from "../needs/repository";
import { NeedMembershipRepository } from "../needs/membership-repository";
import { ProductSubstitutionRepository } from "../needs/substitution-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotNeedMutationRuntime } from "./need-mutation-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotNeedProposalController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canManageProducts: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } = readCopilotNeedProposal(raw);
    const input = content.input;
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
      const r = needToolResultSchema.parse(JSON.parse(previous.result_json));
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        r.operationId !== message.id ||
        r.userMessageId !== message.replyToMessageId ||
        r.tool !== request.tool
      )
        throw Error("NEED_PROPOSAL_SCOPE");
      return {
        message,
        content,
        request,
        reactivationRequired: needProposalRefused(input, content.basis),
        status: "COMPLETED" as const,
      };
    }
    const needs = new NeedUnitRepository(this.db),
      products = new ProductMasterRepository(this.db);
    const need = input.needUnitId
      ? await needs.get(this.scope.storeId, input.needUnitId)
      : null;
    const product =
      input.kind !== "NEED" ? await products.getProduct(input.productId) : null;
    const substitute =
      input.kind === "SUBSTITUTION"
        ? await products.getProduct(input.substituteProductId)
        : null;
    const membership =
      input.kind === "MEMBERSHIP"
        ? await new NeedMembershipRepository(this.db, this.digest).get(
            this.scope.storeId,
            await needMembershipId(
              this.scope.storeId,
              input.productId,
              input.needUnitId!,
              this.digest,
            ),
          )
        : null;
    const substitution =
      input.kind === "SUBSTITUTION"
        ? await new ProductSubstitutionRepository(this.db, this.digest).get(
            this.scope.storeId,
            await productSubstitutionId(
              this.scope.storeId,
              input.productId,
              input.substituteProductId,
              input.needUnitId!,
              this.digest,
            ),
          )
        : null;
    const current = needProposalBasisSchema.parse({
      need: need?.entity ?? null,
      product: product?.entity ?? null,
      substitute: substitute?.entity ?? null,
      membership: membership?.entity ?? null,
      substitution: substitution?.entity ?? null,
    });
    const stale =
      JSON.stringify(current) !== JSON.stringify(content.basis) ||
      [need, product, substitute, membership, substitution].some(
        (r) => r && ["ERROR", "CONFLICT"].includes(r.syncState),
      );
    return {
      message,
      content,
      request,
      reactivationRequired: needProposalRefused(input, content.basis),
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(
    message: CopilotMessage,
    reactivateRejected = false,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canManageProducts) throw Error("NEED_PROPOSAL_FORBIDDEN");
    const s = await this.open(message);
    if (s.status === "COMPLETED") return s;
    if (s.status !== "READY") throw Error("NEED_PROPOSAL_STALE");
    if (s.reactivationRequired && !reactivateRejected)
      throw Error("RELATION_REFUSAL_REQUIRED");
    const request = prepareNeedProposalRequest(
      s.content.input,
      s.content.basis,
      message.id,
      s.reactivationRequired && reactivateRejected,
    );
    await new CopilotNeedMutationRuntime(this.db, this.id, this.digest).execute(
      request,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: needToolIntent(request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
