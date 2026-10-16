import {
  readCopilotOperationsProposal,
  operationsBasisSchema,
  copilotVisibleStoreSettingsSchema,
  fieldToolIntent,
  fieldToolResultSchema,
  settingsSaveIntent,
  settingsSaveResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { StoreContextRepository } from "../store/context-repository";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotFieldMutationRuntime } from "./field-mutation-runtime";
import { CopilotStoreSettingsRuntime } from "./store-settings-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotOperationsProposalController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canCaptureStoreEvents: boolean;
      canManageStoreSettings: boolean;
    },
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } = readCopilotOperationsProposal(raw),
      input = content.input;
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
      const r =
        request.tool === "store.settings.save"
          ? settingsSaveResultSchema.parse(JSON.parse(previous.result_json))
          : fieldToolResultSchema.parse(JSON.parse(previous.result_json));
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        r.operationId !== message.id ||
        r.userMessageId !== message.replyToMessageId ||
        r.tool !== request.tool
      )
        throw Error("OPERATIONS_PROPOSAL_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const event =
      input.kind === "FIELD_CLOSE"
        ? await new StoreProductEventRepository(this.db).get(
            this.scope.storeId,
            input.eventId,
          )
        : null;
    const productId =
      input.kind === "FIELD_CAPTURE"
        ? input.productId
        : event?.entity.productId;
    const product = productId
      ? await new ProductMasterRepository(this.db).getProduct(productId)
      : null;
    const settings =
      input.kind === "SETTINGS"
        ? await new StoreContextRepository(this.db).get(this.scope.storeId)
        : null;
    const visible = settings
      ? (({ position, ...rest }) => {
          void position;
          return copilotVisibleStoreSettingsSchema.parse(rest);
        })(settings.entity)
      : null;
    const current = operationsBasisSchema.parse({
      product: product?.entity ?? null,
      event: event?.entity ?? null,
      settings: visible,
    });
    const stale =
      JSON.stringify(current) !== JSON.stringify(content.basis) ||
      [product, event, settings].some(
        (r) => r && ["ERROR", "CONFLICT"].includes(r.syncState),
      );
    return {
      message,
      content,
      request,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(message: CopilotMessage, signal?: AbortSignal) {
    const decoded = readCopilotOperationsProposal(message);
    if (
      decoded.content.input.kind === "SETTINGS"
        ? !this.scope.canManageStoreSettings
        : !this.scope.canCaptureStoreEvents
    )
      throw Error("OPERATIONS_PROPOSAL_FORBIDDEN");
    const s = await this.open(message);
    if (s.status === "COMPLETED") return s;
    if (s.status !== "READY") throw Error("OPERATIONS_PROPOSAL_STALE");
    const base = {
      storeId: this.scope.storeId,
      ownerId: this.scope.ownerId,
      deviceId: this.scope.deviceId,
      conversationId: message.conversationId,
      userMessageId: message.replyToMessageId!,
      decisionLevel: "REVIEWED" as const,
    };
    if (s.request.tool === "store.settings.save")
      await new CopilotStoreSettingsRuntime(this.db, this.id).execute(
        s.request,
        {
          ...base,
          canManageStoreSettings: this.scope.canManageStoreSettings,
          authorizedRequestJson: settingsSaveIntent(s.request),
        },
        signal,
      );
    else
      await new CopilotFieldMutationRuntime(this.db, this.id).execute(
        s.request,
        {
          ...base,
          canCaptureStoreEvents: this.scope.canCaptureStoreEvents,
          authorizedRequestJson: fieldToolIntent(s.request),
        },
        signal,
      );
    return this.open(message);
  }
}
