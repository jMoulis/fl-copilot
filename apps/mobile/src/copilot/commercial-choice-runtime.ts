import {
  choiceSaveRequestSchema,
  choiceSaveAuthoritySchema,
  choiceSaveResultSchema,
  commercialOfferChoiceSchema,
  ProductClassificationError,
  type ChoiceSaveAuthority,
} from "@fl-copilot/domain";
import {
  commercialChoiceProductUnitMatches,
  commercialChoiceId,
} from "@fl-copilot/commercial-core";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
  productToolRepository,
} from "./product-tool-transaction";
/** Internal tool. Scope, decision authority, clock and IDs come from app code. */
export class CopilotCommercialChoiceRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (text: string) => Promise<string>,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ChoiceSaveAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = choiceSaveRequestSchema.safeParse(raw),
      authority = choiceSaveAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canManageCommercialChoices, ...scope } = authority.data;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canManageCommercialChoices },
      choiceSaveResultSchema,
      async (tx, ctx) => {
        const repo = new CommercialChoiceRepository(
            joinedProductToolDatabase(tx),
            this.digest,
          ),
          input = request.input,
          id = await commercialChoiceId(
            ctx.storeId,
            input.draft.source,
            this.digest,
          ),
          before = await repo.get(ctx.storeId, id);
        if (before && ["CONFLICT", "ERROR"].includes(before.syncState))
          throw new ProductClassificationError("SYNC_CONFLICT");
        if ((before?.entity.version ?? null) !== input.expectedVersion)
          throw new ProductClassificationError("VERSION_CONFLICT");
        if (input.draft.status === "WITHDRAWN" && !before)
          throw new ProductClassificationError("COMMERCIAL_CHOICE_UNAVAILABLE");
        if (input.draft.status === "WITHDRAWN" && before) {
          const keys = [
            "productId",
            "saleStart",
            "saleEnd",
            "mechanism",
          ] as const;
          if (
            keys.some(
              (k) =>
                JSON.stringify(input.draft[k]) !==
                JSON.stringify(before.entity[k]),
            )
          )
            throw new ProductClassificationError("INVALID_INPUT");
        }
        if (input.draft.status === "RETAINED") {
          const p = await productToolRepository(tx).getProduct(
            input.draft.productId,
          );
          if (
            !p ||
            p.entity.storeId !== ctx.storeId ||
            p.entity.deletedAt ||
            p.entity.status !== "ACTIVE"
          )
            throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
          if (["ERROR", "CONFLICT"].includes(p.syncState))
            throw new ProductClassificationError("SYNC_CONFLICT");
          if (
            !commercialChoiceProductUnitMatches(input.draft, p.entity.salesUnit)
          )
            throw new ProductClassificationError(
              "COMMERCIAL_CHOICE_UNIT_MISMATCH",
            );
          if (p.entity.version !== input.productVersion)
            throw new ProductClassificationError("VERSION_CONFLICT");
        }
        const appliedAt = this.now(),
          after = commercialOfferChoiceSchema.safeParse({
            ...input.draft,
            id,
            storeId: ctx.storeId,
            version: (before?.entity.version ?? 0) + 1,
            createdAt: before?.entity.createdAt ?? appliedAt,
            updatedAt: appliedAt,
          });
        if (!after.success)
          throw new ProductClassificationError("INVALID_INPUT");
        const commandId = this.generateId();
        try {
          await repo.save(after.data, { commandId, deviceId: ctx.deviceId });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "COMMERCIAL_CHOICE_SOURCE_INVALID"
          )
            throw new ProductClassificationError("COMMERCIAL_SOURCE_INVALID");
          if (
            error instanceof Error &&
            error.message === "COMMERCIAL_CHOICE_DUPLICATE"
          )
            throw new ProductClassificationError("COMMERCIAL_CHOICE_DUPLICATE");
          throw error;
        }
        return {
          operationId: request.operationId,
          schemaVersion: 1 as const,
          tool: request.tool,
          status: "COMPLETED" as const,
          userMessageId: ctx.userMessageId,
          appliedAt,
          before: before?.entity ?? null,
          after: after.data,
          commandId,
          syncState: "PENDING" as const,
          message:
            after.data.status === "RETAINED"
              ? "Offre retenue localement. Aucune publication ou exécution du plan n’a été déclenchée."
              : "Choix retiré localement. Les versions et les références historiques sont conservées.",
        };
      },
      signal,
    );
  }
}
