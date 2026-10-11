import { readCopilotContext, readOnlyToolDatabase } from "./context-readers";
import {
  copilotToolRequestSchema,
  copilotToolScopeSchema,
  copilotToolResultSchema,
  CopilotToolError,
  type CopilotToolScope,
  type CopilotToolResult,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { ProductMasterRepository } from "../products/product-master-repository";
import { loadProductEditorSnapshot } from "../products/product-editor-service";

/** Device-local read adapter. Not exposed to the model or activated by global UI. */
export class CopilotToolRuntime {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(
    raw: unknown,
    trustedScope: CopilotToolScope,
    signal?: AbortSignal,
  ): Promise<CopilotToolResult> {
    const parsed = copilotToolRequestSchema.safeParse(raw);
    if (!parsed.success) throw new CopilotToolError("INVALID_INPUT");
    const scope = copilotToolScopeSchema.safeParse(trustedScope);
    if (!scope.success || !scope.data.canReadStore)
      throw new CopilotToolError("FORBIDDEN");
    const request = parsed.data,
      ctx = scope.data;
    let result: CopilotToolResult | undefined;
    try {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        if (signal?.aborted) throw new CopilotToolError("CANCELLED");
        // Recheck authority before cached replay; no cached foreign conversation disclosure.
        const parent = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM copilot_conversations WHERE id = ? AND store_id = ? AND owner_id = ?",
          ctx.conversationId,
          ctx.storeId,
          ctx.ownerId,
        );
        if (!parent) throw new CopilotToolError("FORBIDDEN");
        const previous = await tx.getFirstAsync<{
          store_id: string;
          owner_id: string;
          conversation_id: string;
          request_json: string;
          result_json: string;
        }>(
          "SELECT * FROM copilot_tool_results WHERE operation_id = ?",
          request.operationId,
        );
        const requestJson = JSON.stringify(request);
        if (previous) {
          if (
            previous.store_id !== ctx.storeId ||
            previous.owner_id !== ctx.ownerId ||
            previous.conversation_id !== ctx.conversationId
          )
            throw new CopilotToolError("FORBIDDEN");
          if (previous.request_json !== requestJson)
            throw new CopilotToolError("OPERATION_CONFLICT");
          result = copilotToolResultSchema.parse(
            JSON.parse(previous.result_json),
          );
          return;
        }
        let content;
        if (request.tool === "product.inspect") {
          const snapshot = await loadProductEditorSnapshot(
            new ProductMasterRepository(readOnlyToolDatabase(tx)),
            request.input.productId,
          );
          const visible =
            snapshot?.product.entity.storeId === ctx.storeId ? snapshot : null;
          if (
            visible &&
            (visible.identifiers.some(
              (r) => r.entity.storeId !== ctx.storeId,
            ) ||
              visible.aliases.some((r) => r.entity.storeId !== ctx.storeId))
          )
            throw new CopilotToolError("FORBIDDEN");
          content = {
            snapshot: visible,
            message: visible
              ? "Fiche produit consultée."
              : "Produit introuvable dans ce magasin.",
          };
        } else content = await readCopilotContext(tx, ctx.storeId, request);
        if (signal?.aborted) throw new CopilotToolError("CANCELLED");
        result = copilotToolResultSchema.parse({
          ...content,
          schemaVersion: 1,
          operationId: request.operationId,
          tool: request.tool,
          status: "COMPLETED",
          observedAt: this.now(),
        });
        await tx.runAsync(
          `INSERT INTO copilot_tool_results
          (operation_id, store_id, owner_id, conversation_id, request_json, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          request.operationId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
          requestJson,
          JSON.stringify(result),
          result.observedAt,
        );
      });
    } catch (error) {
      if (error instanceof CopilotToolError) throw error;
      throw new CopilotToolError("UNAVAILABLE");
    }
    if (!result) throw new CopilotToolError("UNAVAILABLE");
    return result;
  }
}
