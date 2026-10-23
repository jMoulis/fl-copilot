import {
  productCatalogueRequestSchema,
  productCatalogueResultSchema,
  ProductClassificationError,
  normalizeProductLabel,
  type ProductClassificationAuthority,
  type ProductCatalogueResult,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  loadProductEditorSnapshot,
  saveProductEditor,
  productMutationExpectedRemoteVersion,
} from "../products/product-editor-service";
import {
  runReviewedProductTool,
  productToolRepository,
  queueProductToolRecomputation,
} from "./product-tool-transaction";
export class CopilotProductCatalogueRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    authority: ProductClassificationAuthority,
    signal?: AbortSignal,
  ): Promise<ProductCatalogueResult> {
    const parsed = productCatalogueRequestSchema.safeParse(raw);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    const request = parsed.data;
    return runReviewedProductTool(
      this.db,
      request,
      authority,
      productCatalogueResultSchema,
      async (tx, ctx) => {
        const repo = productToolRepository(tx),
          appliedAt = this.now(),
          commandIds: string[] = [];
        const before = request.input.productId
          ? await loadProductEditorSnapshot(repo, request.input.productId)
          : null;
        if (
          request.tool === "product.retire" ||
          request.input.mode === "UPDATE"
        ) {
          if (
            !before ||
            before.product.entity.storeId !== ctx.storeId ||
            (request.tool === "product.retire" &&
              before.product.entity.status === "INACTIVE")
          )
            throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
          if (before.product.entity.version !== request.input.expectedVersion)
            throw new ProductClassificationError("VERSION_CONFLICT", {
              productId: before.product.entity.id,
              expectedVersion: request.input.expectedVersion!,
              actualVersion: before.product.entity.version,
            });
          if (
            [before.product, ...before.identifiers, ...before.aliases].some(
              (r) => r.syncState === "CONFLICT" || r.syncState === "ERROR",
            )
          )
            throw new ProductClassificationError("SYNC_CONFLICT", {
              productId: before.product.entity.id,
            });
          if (
            before.identifiers.some((r) => r.entity.storeId !== ctx.storeId) ||
            before.aliases.some((r) => r.entity.storeId !== ctx.storeId)
          )
            throw new ProductClassificationError("FORBIDDEN");
        }
        let productId: string;
        if (request.tool === "product.retire") {
          productId = request.input.productId;
          const commandId = this.generateId();
          commandIds.push(commandId);
          await repo.delete("product", productId, ctx.storeId, appliedAt, {
            commandId,
            deviceId: ctx.deviceId,
            expectedRemoteVersion: productMutationExpectedRemoteVersion(
              before!.product,
            ),
          });
          const after = (await repo.getProduct(productId))!.entity;
          const recomputationJobId = await queueProductToolRecomputation(
            tx,
            ctx.storeId,
            productId,
            this.generateId(),
            appliedAt,
          );
          return {
            operationId: request.operationId,
            schemaVersion: 1,
            tool: request.tool,
            status: "COMPLETED",
            userMessageId: ctx.userMessageId,
            appliedAt,
            message:
              "Produit retiré localement. Son historique reste conservé.",
            before: before!.product.entity,
            after,
            commandIds,
            recomputationJobId,
          };
        }
        if (before) {
          for (const key of ["identifiers", "aliases"] as const) {
            const expected = request.input.expectedChildren[key],
              actual = before[key];
            if (
              expected.length !== actual.length ||
              expected.some(
                (e) =>
                  !actual.some(
                    (a) =>
                      a.entity.id === e.id && a.entity.version === e.version,
                  ),
              )
            )
              throw new ProductClassificationError("CHILD_CONFLICT", {
                productId: before.product.entity.id,
              });
            if (
              request.input.draft[key].some(
                (e) => e.id && !actual.some((a) => a.entity.id === e.id),
              )
            )
              throw new ProductClassificationError("CHILD_CONFLICT", {
                productId: before.product.entity.id,
              });
          }
          if (
            request.input.draft.aliases.some(
              (a) =>
                !a.id &&
                before.aliases.some(
                  (r) =>
                    r.entity.status === "REJECTED" &&
                    r.entity.normalizedAlias === normalizeProductLabel(a.alias),
                ),
            )
          )
            throw new ProductClassificationError("ALIAS_REFUSED", {
              productId: before.product.entity.id,
            });
        }
        const identifiers = await repo.listIdentifiersByStore(ctx.storeId);
        if (
          request.input.draft.identifiers.some((i) =>
            identifiers.some(
              (existing) =>
                existing.entity.productId !== request.input.productId &&
                existing.entity.type === i.type &&
                existing.entity.value === i.value,
            ),
          )
        )
          throw new ProductClassificationError("IDENTIFIER_CONFLICT");
        const prior = await tx.getFirstAsync<{ n: number }>(
          "SELECT COALESCE(MAX(local_sequence),0) AS n FROM sync_outbox WHERE store_id=?",
          ctx.storeId,
        );
        productId = await saveProductEditor(repo, request.input.draft, {
          storeId: ctx.storeId,
          deviceId: ctx.deviceId,
          productId: request.input.productId ?? undefined,
          existing: before ?? undefined,
          now: () => appliedAt,
          generateId: this.generateId,
        });
        const commands = await tx.getAllAsync<{ command_id: string }>(
          "SELECT command_id FROM sync_outbox WHERE store_id=? AND local_sequence>? ORDER BY local_sequence",
          ctx.storeId,
          prior?.n ?? 0,
        );
        commandIds.push(...commands.map((c) => c.command_id));
        const after = await loadProductEditorSnapshot(repo, productId);
        if (!after) throw new ProductClassificationError("UNAVAILABLE");
        const recomputationJobId = await queueProductToolRecomputation(
          tx,
          ctx.storeId,
          productId,
          this.generateId(),
          appliedAt,
        );
        return {
          operationId: request.operationId,
          schemaVersion: 1,
          tool: request.tool,
          status: "COMPLETED",
          userMessageId: ctx.userMessageId,
          appliedAt,
          message:
            "Fiche enregistrée localement. La synchronisation reste distincte.",
          before,
          after,
          commandIds,
          recomputationJobId,
        };
      },
      signal,
    );
  }
}
