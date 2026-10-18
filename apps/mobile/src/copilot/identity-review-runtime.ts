import {
  identityReviewAuthoritySchema,
  identityReviewRequestSchema,
  identityReviewResultSchema,
  identityReviewAfter,
  readIdentityReviewProposal,
  identityReviewAliasReadiness,
  IDENTITY_REVIEW_PRODUCT_LIMIT,
  ProductClassificationError,
  type IdentityReviewAuthority,
  type IdentityReviewBasis,
  type IdentityReviewInput,
  type ProductAlias,
  type ProductIdentifier,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { productMutationExpectedRemoteVersion } from "../products/product-editor-service";
import {
  productToolRepository,
  runReviewedProductTool,
} from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
/** Rechecked inside the same exclusive transaction as the canonical child write. */
export async function checkIdentityReviewCurrent(
  db: OutboxDatabase,
  storeId: string,
  input: IdentityReviewInput,
  before: IdentityReviewBasis,
) {
  const repo = productToolRepository(db);
  const product = await repo.getProduct(input.productId),
    entry =
      input.kind === "ALIAS"
        ? await repo.getAlias(input.entryId)
        : await repo.getIdentifier(input.entryId);
  if (
    !product ||
    !entry ||
    product.entity.storeId !== storeId ||
    entry.entity.storeId !== storeId
  )
    throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
  if (
    [product, entry].some(
      (r) => r.syncState === "ERROR" || r.syncState === "CONFLICT",
    )
  )
    throw new ProductClassificationError("SYNC_CONFLICT");
  if (
    JSON.stringify(product.entity) !== JSON.stringify(before.product) ||
    JSON.stringify(entry.entity) !== JSON.stringify(before.entry)
  )
    throw new ProductClassificationError("VERSION_CONFLICT");
  if (input.decision === "VALIDATE") {
    if ("alias" in entry.entity) {
      const alias = entry.entity;
      const collision = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM product_aliases WHERE store_id=? AND product_id!=? AND normalized_alias=? AND status='VALIDATED' AND deleted_at IS NULL LIMIT 1",
        storeId,
        input.productId,
        alias.normalizedAlias,
      );
      const products = await db.getAllAsync<{ id: string; label: string }>(
        "SELECT id,label FROM products WHERE store_id=? AND status='ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT ?",
        storeId,
        IDENTITY_REVIEW_PRODUCT_LIMIT + 1,
      );
      if (
        identityReviewAliasReadiness(
          input.productId,
          alias.normalizedAlias,
          !!collision,
          products,
        ) !== "READY"
      )
        throw new ProductClassificationError("CHILD_CONFLICT");
    } else {
      const collision = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM product_identifiers WHERE store_id=? AND id!=? AND type=? AND value=? AND deleted_at IS NULL LIMIT 1",
        storeId,
        input.entryId,
        entry.entity.type,
        entry.entity.value,
      );
      if (collision)
        throw new ProductClassificationError("IDENTIFIER_CONFLICT");
    }
  }
  return entry;
}
export class CopilotIdentityReviewRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: IdentityReviewAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = identityReviewRequestSchema.safeParse(raw),
      authority = identityReviewAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { reactivateRejectedAlias, ...scope } = authority.data;
    if (
      request.input.decision === "VALIDATE" &&
      request.before.entry.status === "REJECTED" &&
      !reactivateRejectedAlias
    )
      throw new ProductClassificationError("ALIAS_REFUSED");
    const row = await this.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
      request.operationId,
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
    );
    if (!row) throw new ProductClassificationError("REVIEW_REQUIRED");
    const artifact = readIdentityReviewProposal(JSON.parse(row.payload_json));
    await verifyPrivateToolRecord(
      this.db,
      scope,
      artifact.message,
      artifact.content.assistantMessageId,
    );
    if (
      artifact.message.replyToMessageId !== scope.userMessageId ||
      JSON.stringify(artifact.request) !== JSON.stringify(request)
    )
      throw new ProductClassificationError("FORBIDDEN");

    return runReviewedProductTool(
      this.db,
      request,
      scope,
      identityReviewResultSchema,
      async (tx, ctx) => {
        const row = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          request.operationId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
        if (!row) throw new ProductClassificationError("REVIEW_REQUIRED");
        const artifact = readIdentityReviewProposal(
          JSON.parse(row.payload_json),
        );
        await verifyPrivateToolRecord(
          tx,
          ctx,
          artifact.message,
          artifact.content.assistantMessageId,
        );
        if (
          artifact.message.replyToMessageId !== ctx.userMessageId ||
          JSON.stringify(artifact.request) !== JSON.stringify(request)
        )
          throw new ProductClassificationError("FORBIDDEN");
        const before = await checkIdentityReviewCurrent(
            tx,
            ctx.storeId,
            request.input,
            request.before,
          ),
          appliedAt = this.now(),
          commandId = this.id();
        const after = identityReviewAfter(
            request.input,
            request.before,
            appliedAt,
          ),
          repo = productToolRepository(tx);
        const context = {
          commandId,
          deviceId: ctx.deviceId,
          expectedRemoteVersion: productMutationExpectedRemoteVersion<
            ProductAlias | ProductIdentifier
          >(before),
        };
        if ("alias" in after) await repo.upsertAlias(after, context);
        else await repo.upsertIdentifier(after, context);
        return {
          operationId: request.operationId,
          userMessageId: ctx.userMessageId,
          appliedAt,
          commandId,
          before: request.before,
          after,
        };
      },
      signal,
    );
  }
}
