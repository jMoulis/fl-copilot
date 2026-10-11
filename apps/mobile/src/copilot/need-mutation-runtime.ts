import {
  needToolRequestSchema,
  needToolResultSchema,
  needUnitSchema,
  needMembershipId,
  productSubstitutionId,
  ProductClassificationError,
  type ProductClassificationAuthority,
  type NeedToolResult,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { NeedUnitRepository } from "../needs/repository";
import { NeedMembershipRepository } from "../needs/membership-repository";
import { ProductSubstitutionRepository } from "../needs/substitution-repository";
import {
  runReviewedProductTool,
  joinedProductToolDatabase,
  productToolRepository,
} from "./product-tool-transaction";
export class CopilotNeedMutationRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private generateId: () => string,
    private digest: (s: string) => Promise<string>,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    authority: ProductClassificationAuthority,
    signal?: AbortSignal,
  ): Promise<NeedToolResult> {
    const parsed = needToolRequestSchema.safeParse(raw);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    const request = parsed.data;
    return runReviewedProductTool(
      this.db,
      request,
      authority,
      needToolResultSchema,
      async (tx, ctx) => {
        const db = joinedProductToolDatabase(tx),
          needs = new NeedUnitRepository(db),
          appliedAt = this.now(),
          commandId = this.generateId(),
          common = {
            operationId: request.operationId,
            schemaVersion: 1 as const,
            status: "COMPLETED" as const,
            appliedAt,
            userMessageId: ctx.userMessageId,
            commandId,
            syncState: "PENDING" as const,
          };
        if (request.tool === "need.save") {
          const input = request.input,
            before = input.needUnitId
              ? await needs.get(ctx.storeId, input.needUnitId)
              : null;
          if (input.mode === "UPDATE" && !before)
            throw new ProductClassificationError("NEED_UNAVAILABLE");
          if (before) {
            if (
              before.entity.id !== input.needUnitId ||
              before.entity.storeId !== ctx.storeId
            )
              throw new ProductClassificationError("FORBIDDEN");
            checkRevision(before, input.expectedVersion);
            if (before.entity.code !== input.code)
              throw new ProductClassificationError("NEED_CODE_IMMUTABLE");
          }
          if (
            (await needs.list(ctx.storeId)).some(
              (n) =>
                n.entity.code === input.code &&
                n.entity.id !== before?.entity.id,
            )
          )
            throw new ProductClassificationError("NEED_CODE_CONFLICT");
          const after = needUnitSchema.parse({
            id: before?.entity.id ?? this.generateId(),
            storeId: ctx.storeId,
            code: input.code,
            name: input.name,
            description: input.description,
            status: input.status,
            createdBy: before?.entity.createdBy ?? "USER",
            version: (before?.entity.version ?? 0) + 1,
            createdAt: before?.entity.createdAt ?? appliedAt,
            updatedAt: appliedAt,
          });
          await needs.save(after, { commandId, deviceId: ctx.deviceId });
          return {
            ...common,
            tool: request.tool,
            before: before?.entity ?? null,
            after,
            message:
              "Besoin client enregistré localement. La désactivation conserve son historique.",
          };
        }
        const input = request.input,
          need = await needs.get(ctx.storeId, input.needUnitId);
        if (!need) throw new ProductClassificationError("NEED_UNAVAILABLE");
        if (
          need.entity.id !== input.needUnitId ||
          need.entity.storeId !== ctx.storeId
        )
          throw new ProductClassificationError("FORBIDDEN");
        checkRevision(need, input.needVersion);
        const products = productToolRepository(tx),
          product = await products.getProduct(input.productId);
        if (!product || product.entity.storeId !== ctx.storeId)
          throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
        checkRevision(product, input.productVersion);
        if (input.decision !== "REJECTED") {
          if (product.entity.deletedAt || product.entity.status !== "ACTIVE")
            throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
          if (need.entity.status !== "ACTIVE")
            throw new ProductClassificationError("NEED_UNAVAILABLE");
        }
        if (request.tool === "need.membership") {
          const repo = new NeedMembershipRepository(db, this.digest),
            id = await needMembershipId(
              ctx.storeId,
              input.productId,
              input.needUnitId,
              this.digest,
            ),
            before = await repo.get(ctx.storeId, id);
          checkRevision(before, input.expectedVersion);
          checkRefusal(
            before?.entity.status,
            input.decision,
            input.allowReactivateRejected,
          );
          if (
            before &&
            before.entity.source !== "MANUAL" &&
            request.input.declaredConfidence !== null &&
            request.input.declaredConfidence !== before.entity.confidence
          )
            throw new ProductClassificationError("INVALID_INPUT");
          const after = {
            id,
            storeId: ctx.storeId,
            productId: input.productId,
            needUnitId: input.needUnitId,
            strength: request.input.strength,
            primary: request.input.primary,
            source: before?.entity.source ?? ("MANUAL" as const),
            confidence:
              request.input.declaredConfidence ?? before!.entity.confidence,
            status: input.decision,
            humanConfirmed: true,
            version: (before?.entity.version ?? 0) + 1,
            createdAt: before?.entity.createdAt ?? appliedAt,
            updatedAt: appliedAt,
          };
          await repo.save(after, { commandId, deviceId: ctx.deviceId });
          return {
            ...common,
            tool: request.tool,
            before: before?.entity ?? null,
            after,
            message: "Décision d’association enregistrée localement.",
          };
        }
        const target = await products.getProduct(
          request.input.substituteProductId,
        );
        if (!target || target.entity.storeId !== ctx.storeId)
          throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
        checkRevision(target, request.input.substituteProductVersion);
        if (
          input.decision !== "REJECTED" &&
          (target.entity.deletedAt || target.entity.status !== "ACTIVE")
        )
          throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
        const repo = new ProductSubstitutionRepository(db, this.digest),
          id = await productSubstitutionId(
            ctx.storeId,
            input.productId,
            request.input.substituteProductId,
            input.needUnitId,
            this.digest,
          ),
          before = await repo.get(ctx.storeId, id);
        checkRevision(before, input.expectedVersion);
        checkRefusal(
          before?.entity.status,
          input.decision,
          input.allowReactivateRejected,
        );
        const after = {
          id,
          storeId: ctx.storeId,
          sourceProductId: input.productId,
          substituteProductId: request.input.substituteProductId,
          needUnitId: input.needUnitId,
          needCompatibility: request.input.needCompatibility,
          usageCompatibility: request.input.usageCompatibility,
          priceCompatibility: request.input.priceCompatibility,
          packagingCompatibility: request.input.packagingCompatibility,
          observedSubstitution: before?.entity.observedSubstitution ?? null,
          relationshipScore: before?.entity.relationshipScore ?? null,
          confidence: before?.entity.confidence ?? null,
          evidenceCount: before?.entity.evidenceCount ?? 0,
          lastEvidenceAt: before?.entity.lastEvidenceAt ?? null,
          source: before?.entity.source ?? ("MANUAL" as const),
          status:
            input.decision === "VALIDATED" &&
            before?.entity.status === "LEARNING"
              ? ("LEARNING" as const)
              : input.decision,
          humanConfirmed: true,
          version: (before?.entity.version ?? 0) + 1,
          createdAt: before?.entity.createdAt ?? appliedAt,
          updatedAt: appliedAt,
        };
        await repo.save(after, { commandId, deviceId: ctx.deviceId });
        return {
          ...common,
          tool: request.tool,
          before: before?.entity ?? null,
          after,
          message:
            "Relation dirigée enregistrée localement. Les valeurs apprises sont conservées et ne sont pas recalculées par le copilote.",
        };
      },
      signal,
    );
  }
}
function checkRevision(
  record: { entity: { version: number }; syncState: string } | null,
  expected: number | null,
) {
  if (
    record &&
    (record.syncState === "CONFLICT" || record.syncState === "ERROR")
  )
    throw new ProductClassificationError("SYNC_CONFLICT");
  if ((record?.entity.version ?? null) !== expected)
    throw new ProductClassificationError("VERSION_CONFLICT");
}
function checkRefusal(
  previous: string | undefined,
  next: string,
  allowed: boolean,
) {
  if (previous === "REJECTED" && next !== "REJECTED" && !allowed)
    throw new ProductClassificationError("RELATION_REFUSAL_REQUIRED");
}
