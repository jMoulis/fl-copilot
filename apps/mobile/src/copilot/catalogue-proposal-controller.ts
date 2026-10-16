import {
  readCopilotCatalogueProposal,
  catalogueSnapshotIdentity,
  productCatalogueIntent,
  productCatalogueResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { loadProductEditorSnapshot } from "../products/product-editor-service";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotProductCatalogueRuntime } from "./product-catalogue-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotCatalogueProposalController {
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
    const { message, content, request } = readCopilotCatalogueProposal(raw);
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
      const r = productCatalogueResultSchema.parse(
        JSON.parse(previous.result_json),
      );
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        r.operationId !== message.id ||
        r.userMessageId !== message.replyToMessageId ||
        r.tool !== request.tool
      )
        throw Error("CATALOGUE_PROPOSAL_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const current = content.input.productId
      ? await loadProductEditorSnapshot(
          new ProductMasterRepository(this.db),
          content.input.productId,
        )
      : null;
    const stale =
      catalogueSnapshotIdentity(current) !==
        catalogueSnapshotIdentity(content.before) ||
      (!!current &&
        [current.product, ...current.identifiers, ...current.aliases].some(
          (r) => r.syncState === "ERROR" || r.syncState === "CONFLICT",
        ));
    return {
      message,
      content,
      request,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(message: CopilotMessage, signal?: AbortSignal) {
    if (!this.scope.canManageProducts)
      throw Error("CATALOGUE_PROPOSAL_FORBIDDEN");
    const s = await this.open(message);
    if (s.status === "COMPLETED") return s;
    if (s.status !== "READY") throw Error("CATALOGUE_PROPOSAL_STALE");
    await new CopilotProductCatalogueRuntime(this.db, this.id).execute(
      s.request,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: productCatalogueIntent(s.request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
