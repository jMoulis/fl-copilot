import {
  preparationRequestSchema,
  preparationAuthoritySchema,
  preparationResultSchema,
  commercialWeekPreparationSchema,
  ProductClassificationError,
  type PreparationAuthority,
} from "@fl-copilot/domain";
import { commercialWeekPreparationId } from "@fl-copilot/commercial-core";
import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
/** Internal adapter; app supplies authority, IDs and clock. No offer publication. */
export class CopilotCommercialPreparationRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (text: string) => Promise<string>,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: PreparationAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = preparationRequestSchema.safeParse(raw),
      authority = preparationAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canPrepareCommercialWeek, ...scope } = authority.data;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canPrepareCommercialWeek },
      preparationResultSchema,
      async (tx, ctx) => {
        const repo = new CommercialPreparationRepository(
            joinedProductToolDatabase(tx),
            this.digest,
          ),
          input = request.input,
          before = await repo.get(ctx.storeId, input.draft.weekStart);
        if (
          before &&
          (before.syncState === "CONFLICT" || before.syncState === "ERROR")
        )
          throw new ProductClassificationError("SYNC_CONFLICT");
        if ((before?.entity.version ?? null) !== input.expectedVersion)
          throw new ProductClassificationError("VERSION_CONFLICT");
        const appliedAt = this.now(),
          after = commercialWeekPreparationSchema.safeParse({
            ...input.draft,
            id: await commercialWeekPreparationId(
              ctx.storeId,
              input.draft.weekStart,
              this.digest,
            ),
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
            error.message === "COMMERCIAL_PREPARATION_OFFERS_CHANGED"
          )
            throw new ProductClassificationError("COMMERCIAL_OFFERS_CHANGED");
          if (
            error instanceof Error &&
            error.message === "COMMERCIAL_PREPARATION_SOURCE_INVALID"
          )
            throw new ProductClassificationError("COMMERCIAL_SOURCE_INVALID");
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
            "Brouillon commercial enregistré localement. Les offres ne sont ni publiées ni exécutées.",
        };
      },
      signal,
    );
  }
}
