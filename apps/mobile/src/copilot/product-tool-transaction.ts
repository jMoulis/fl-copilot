import { z } from "zod";
import {
  productClassificationAuthoritySchema,
  ProductClassificationError,
  copilotConversationSchema,
  copilotMessageSchema,
  type ProductClassificationAuthority,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { ProductMasterRepository } from "../products/product-master-repository";
import { enqueueAnalyticsRecomputationJob } from "../analytics/local-recomputation";
export function joinedProductToolDatabase(tx: OutboxDatabase) {
  return {
    getFirstAsync: tx.getFirstAsync.bind(tx),
    getAllAsync: tx.getAllAsync.bind(tx),
    runAsync: tx.runAsync.bind(tx),
    withExclusiveTransactionAsync: (
      task: (transaction: OutboxDatabase) => Promise<void>,
    ) => task(tx),
  };
}
export function productToolRepository(tx: OutboxDatabase) {
  return new ProductMasterRepository(joinedProductToolDatabase(tx));
}
export async function queueProductToolRecomputation(
  tx: OutboxDatabase,
  storeId: string,
  productId: string,
  jobId: string,
  createdAt: string,
) {
  const dates = await tx.getAllAsync<{ business_date: string }>(
    `SELECT business_date FROM sales_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL UNION SELECT business_date FROM waste_observations WHERE store_id=? AND product_id=? AND deleted_at IS NULL UNION SELECT business_date FROM product_daily_performance WHERE store_id=? AND product_id=?`,
    storeId,
    productId,
    storeId,
    productId,
    storeId,
    productId,
  );
  if (!dates.length) return null;
  await enqueueAnalyticsRecomputationJob(tx, {
    jobId,
    storeId,
    scopes: dates.map((d) => ({ productId, businessDate: d.business_date })),
    createdAt,
  });
  return jobId;
}
export const reviewedStoreOperationAuthoritySchema =
  productClassificationAuthoritySchema
    .omit({ canManageProducts: true })
    .extend({ canExecute: z.boolean() });
export type ReviewedStoreOperationAuthority = z.infer<
  typeof reviewedStoreOperationAuthoritySchema
>;
/** Request must already be parsed by its strict tool schema. Authority is trusted app context. */
export async function runReviewedStoreOperation<
  T extends { operationId: string; userMessageId: string; appliedAt: string },
>(
  db: OutboxDatabase & AtomicMutationDatabase,
  request: { operationId: string },
  rawAuthority: ReviewedStoreOperationAuthority,
  schema: z.ZodType<T>,
  work: (
    tx: OutboxDatabase,
    ctx: ReviewedStoreOperationAuthority,
  ) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const scope = reviewedStoreOperationAuthoritySchema.safeParse(rawAuthority),
    requestJson = JSON.stringify(request);
  if (
    !scope.success ||
    !scope.data.canExecute ||
    scope.data.authorizedRequestJson !== requestJson
  )
    throw new ProductClassificationError("FORBIDDEN");
  const ctx = scope.data;
  if (ctx.decisionLevel !== "REVIEWED")
    throw new ProductClassificationError("REVIEW_REQUIRED");
  let result: T | undefined;
  try {
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (signal?.aborted) throw new ProductClassificationError("CANCELLED");
      const parent = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
          ctx.conversationId,
          ctx.storeId,
          ctx.ownerId,
        ),
        message = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          ctx.userMessageId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
      const c = parent
          ? copilotConversationSchema.parse(JSON.parse(parent.payload_json))
          : null,
        m = message
          ? copilotMessageSchema.parse(JSON.parse(message.payload_json))
          : null;
      if (
        !c ||
        c.id !== ctx.conversationId ||
        c.storeId !== ctx.storeId ||
        c.ownerId !== ctx.ownerId ||
        c.status !== "ACTIVE" ||
        !m ||
        m.id !== ctx.userMessageId ||
        m.storeId !== ctx.storeId ||
        m.ownerId !== ctx.ownerId ||
        m.conversationId !== ctx.conversationId ||
        m.role !== "USER"
      )
        throw new ProductClassificationError("FORBIDDEN");
      const old = await tx.getFirstAsync<{
        store_id: string;
        owner_id: string;
        conversation_id: string;
        request_json: string;
        result_json: string;
      }>(
        "SELECT * FROM copilot_tool_results WHERE operation_id=?",
        request.operationId,
      );
      if (old) {
        if (
          old.store_id !== ctx.storeId ||
          old.owner_id !== ctx.ownerId ||
          old.conversation_id !== ctx.conversationId
        )
          throw new ProductClassificationError("FORBIDDEN");
        if (old.request_json !== requestJson)
          throw new ProductClassificationError("OPERATION_CONFLICT");
        result = schema.parse(JSON.parse(old.result_json));
        if (result.userMessageId !== ctx.userMessageId)
          throw new ProductClassificationError("FORBIDDEN");
        return;
      }
      result = schema.parse(await work(tx, ctx));
      if (signal?.aborted) throw new ProductClassificationError("CANCELLED");
      await tx.runAsync(
        "INSERT INTO copilot_tool_results(operation_id,store_id,owner_id,conversation_id,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?)",
        request.operationId,
        ctx.storeId,
        ctx.ownerId,
        ctx.conversationId,
        requestJson,
        JSON.stringify(result),
        result.appliedAt,
      );
    });
  } catch (e) {
    if (e instanceof ProductClassificationError) throw e;
    throw new ProductClassificationError("UNAVAILABLE");
  }
  if (!result) throw new ProductClassificationError("UNAVAILABLE");
  return result;
}

export async function runReviewedProductTool<
  T extends { operationId: string; userMessageId: string; appliedAt: string },
>(
  db: OutboxDatabase & AtomicMutationDatabase,
  request: { operationId: string },
  rawAuthority: ProductClassificationAuthority,
  schema: z.ZodType<T>,
  work: (tx: OutboxDatabase, ctx: ProductClassificationAuthority) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const parsed = productClassificationAuthoritySchema.safeParse(rawAuthority);
  if (!parsed.success) throw new ProductClassificationError("FORBIDDEN");
  const { canManageProducts, ...scope } = parsed.data;
  return runReviewedStoreOperation(
    db,
    request,
    { ...scope, canExecute: canManageProducts },
    schema,
    (tx) => work(tx, parsed.data),
    signal,
  );
}
