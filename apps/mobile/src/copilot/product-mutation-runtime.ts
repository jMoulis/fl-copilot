import { productMutationExpectedRemoteVersion } from "../products/product-editor-service";
import {
  enqueueAnalyticsRecomputationJob,
  type ProductDateScope,
} from "../analytics/local-recomputation";
import {
  compareProductClassification,
  productClassificationRequestSchema,
  productClassificationAuthoritySchema,
  productClassificationResultSchema,
  ProductClassificationError,
  type ProductClassificationAuthority,
  type ProductClassificationResult,
  productSchema,
  copilotMessageSchema,
  copilotConversationSchema,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
/** Internal trusted write adapter. Model arguments never provide authority or user confirmation. */
export class CopilotProductMutationRuntime {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ProductClassificationAuthority,
    signal?: AbortSignal,
  ): Promise<ProductClassificationResult> {
    const parsed = productClassificationRequestSchema.safeParse(raw),
      scope = productClassificationAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!scope.success || !scope.data.canManageProducts)
      throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      ctx = scope.data,
      requestJson = JSON.stringify(request);
    if (ctx.authorizedRequestJson !== requestJson)
      throw new ProductClassificationError("FORBIDDEN");
    let result: ProductClassificationResult | undefined;
    try {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        if (signal?.aborted) throw new ProductClassificationError("CANCELLED");
        const parent = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
          ctx.conversationId,
          ctx.storeId,
          ctx.ownerId,
        );
        if (!parent) throw new ProductClassificationError("FORBIDDEN");
        const conversation = copilotConversationSchema.parse(
          JSON.parse(parent.payload_json),
        );
        if (
          conversation.id !== ctx.conversationId ||
          conversation.storeId !== ctx.storeId ||
          conversation.ownerId !== ctx.ownerId ||
          conversation.status !== "ACTIVE"
        )
          throw new ProductClassificationError("FORBIDDEN");
        const message = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          ctx.userMessageId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
        const userMessage = message
          ? copilotMessageSchema.parse(JSON.parse(message.payload_json))
          : null;
        if (
          !userMessage ||
          userMessage.role !== "USER" ||
          userMessage.id !== ctx.userMessageId ||
          userMessage.storeId !== ctx.storeId ||
          userMessage.ownerId !== ctx.ownerId ||
          userMessage.conversationId !== ctx.conversationId
        )
          throw new ProductClassificationError("FORBIDDEN");
        if (
          request.input.allowOverwriteConfirmed &&
          ctx.decisionLevel !== "REVIEWED"
        )
          throw new ProductClassificationError("REVIEW_REQUIRED");
        const previous = await tx.getFirstAsync<{
          store_id: string;
          owner_id: string;
          conversation_id: string;
          request_json: string;
          result_json: string;
        }>(
          "SELECT * FROM copilot_tool_results WHERE operation_id=?",
          request.operationId,
        );
        if (previous) {
          if (
            previous.store_id !== ctx.storeId ||
            previous.owner_id !== ctx.ownerId ||
            previous.conversation_id !== ctx.conversationId
          )
            throw new ProductClassificationError("FORBIDDEN");
          if (previous.request_json !== requestJson)
            throw new ProductClassificationError("OPERATION_CONFLICT");
          result = productClassificationResultSchema.parse(
            JSON.parse(previous.result_json),
          );
          if (result.userMessageId !== ctx.userMessageId)
            throw new ProductClassificationError("FORBIDDEN");
          return;
        }
        // Nested repository transactions join this already-exclusive transaction.
        // This adapter is private to this scope; it must never be used without its outer transaction.
        const repo = new ProductMasterRepository({
          getFirstAsync: tx.getFirstAsync.bind(tx),
          getAllAsync: tx.getAllAsync.bind(tx),
          runAsync: tx.runAsync.bind(tx),
          withExclusiveTransactionAsync: (task) => task(tx),
        });
        const changes: ProductClassificationResult["changes"] = [];
        const appliedAt = this.now();
        const scopes: ProductDateScope[] = [];
        for (const change of request.input.changes) {
          const current = await repo.getProduct(change.productId);
          if (
            !current ||
            current.entity.storeId !== ctx.storeId ||
            current.entity.deletedAt ||
            current.entity.status === "INACTIVE"
          )
            throw new ProductClassificationError("PRODUCT_UNAVAILABLE", {
              productId: change.productId,
            });
          if (current.syncState === "CONFLICT" || current.syncState === "ERROR")
            throw new ProductClassificationError("SYNC_CONFLICT", {
              productId: change.productId,
            });
          if (current.entity.version !== change.expectedVersion)
            throw new ProductClassificationError("VERSION_CONFLICT", {
              productId: change.productId,
              expectedVersion: change.expectedVersion,
              actualVersion: current.entity.version,
            });
          const before = current.entity;
          const preview = compareProductClassification(before, change.patch);
          const changed = preview.changedFields.length > 0;
          if (
            preview.reviewFields.length &&
            !request.input.allowOverwriteConfirmed
          )
            throw new ProductClassificationError("REVIEW_REQUIRED", {
              productId: change.productId,
              fields: preview.reviewFields,
            });
          const after = changed
            ? productSchema.parse({
                ...before,
                ...change.patch,
                version: before.version + 1,
                updatedAt: appliedAt,
              })
            : before;
          const commandId = changed ? this.generateId() : null;
          if (commandId)
            await repo.upsertProduct(after, {
              commandId,
              deviceId: ctx.deviceId,
              expectedRemoteVersion:
                productMutationExpectedRemoteVersion(current),
            });
          if (commandId) {
            const dates = await tx.getAllAsync<{ business_date: string }>(
              `SELECT business_date FROM sales_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL
               UNION SELECT business_date FROM waste_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL
               UNION SELECT business_date FROM product_daily_performance WHERE store_id=? AND product_id=?`,
              ctx.storeId,
              before.id,
              ctx.storeId,
              before.id,
              ctx.storeId,
              before.id,
            );
            scopes.push(
              ...dates.map((d) => ({
                productId: before.id,
                businessDate: d.business_date,
              })),
            );
          }
          changes.push({ before, after, commandId });
        }
        if (signal?.aborted) throw new ProductClassificationError("CANCELLED");
        const recomputationJobId = scopes.length ? this.generateId() : null;
        if (recomputationJobId)
          await enqueueAnalyticsRecomputationJob(tx, {
            jobId: recomputationJobId,
            storeId: ctx.storeId,
            scopes,
            createdAt: appliedAt,
          });
        result = productClassificationResultSchema.parse({
          operationId: request.operationId,
          schemaVersion: 1,
          tool: request.tool,
          status: "COMPLETED",
          message:
            "Corrections enregistrées localement. La synchronisation reste distincte.",
          appliedAt,
          userMessageId: ctx.userMessageId,
          recomputationJobId,
          changes,
        });
        await tx.runAsync(
          "INSERT INTO copilot_tool_results(operation_id,store_id,owner_id,conversation_id,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?)",
          request.operationId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
          requestJson,
          JSON.stringify(result),
          appliedAt,
        );
      });
    } catch (error) {
      if (error instanceof ProductClassificationError) throw error;
      throw new ProductClassificationError("UNAVAILABLE");
    }
    if (!result) throw new ProductClassificationError("UNAVAILABLE");
    return result;
  }
}
