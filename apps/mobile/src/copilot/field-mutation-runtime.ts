import {
  fieldToolRequestSchema,
  fieldToolResultSchema,
  fieldToolAuthoritySchema,
  ProductClassificationError,
  type FieldToolAuthority,
  type FieldToolResult,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
  productToolRepository,
} from "./product-tool-transaction";
export class CopilotFieldMutationRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: FieldToolAuthority,
    signal?: AbortSignal,
  ): Promise<FieldToolResult> {
    const parsed = fieldToolRequestSchema.safeParse(raw),
      authority = fieldToolAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canCaptureStoreEvents, ...scope } = authority.data;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canCaptureStoreEvents },
      fieldToolResultSchema,
      async (tx, ctx) => {
        const repo = new StoreProductEventRepository(
            joinedProductToolDatabase(tx),
          ),
          appliedAt = this.now(),
          common = {
            operationId: request.operationId,
            schemaVersion: 1 as const,
            status: "COMPLETED" as const,
            appliedAt,
            userMessageId: ctx.userMessageId,
          };
        if (request.tool === "store.event.capture") {
          const input = request.input,
            product = await productToolRepository(tx).getProduct(
              input.productId,
            );
          if (
            !product ||
            product.entity.storeId !== ctx.storeId ||
            product.entity.deletedAt ||
            product.entity.status !== "ACTIVE"
          )
            throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
          if (product.syncState === "CONFLICT" || product.syncState === "ERROR")
            throw new ProductClassificationError("SYNC_CONFLICT");
          if (product.entity.version !== input.productVersion)
            throw new ProductClassificationError("VERSION_CONFLICT", {
              productId: input.productId,
              expectedVersion: input.productVersion,
              actualVersion: product.entity.version,
            });
          if (
            Date.parse(input.startedAt) > Date.parse(appliedAt) ||
            (input.endedAt && Date.parse(input.endedAt) > Date.parse(appliedAt))
          )
            throw new ProductClassificationError("EVENT_DATE_INVALID");
          const commandId = this.generateId(),
            id = this.generateId(),
            after = await repo.create(
              ctx.storeId,
              {
                event: {
                  id,
                  productId: input.productId,
                  type: input.type,
                  startedAt: input.startedAt,
                  endedAt: input.endedAt,
                  severity: input.severity,
                  comment: input.comment,
                  clientCapturedAt: appliedAt,
                },
              },
              { commandId, deviceId: ctx.deviceId },
            );
          return {
            ...common,
            tool: request.tool,
            before: null,
            after,
            commandId,
            syncState: "PENDING",
            message:
              "Observation enregistrée localement. Elle ne représente pas un stock chiffré ni une cause démontrée.",
          };
        }
        const input = request.input,
          before = await repo.get(ctx.storeId, input.eventId);
        if (
          !before ||
          before.entity.storeId !== ctx.storeId ||
          before.entity.id !== input.eventId
        )
          throw new ProductClassificationError("EVENT_UNAVAILABLE");
        if (before.syncState === "CONFLICT" || before.syncState === "ERROR")
          throw new ProductClassificationError("SYNC_CONFLICT");
        if (before.entity.version !== input.expectedVersion)
          throw new ProductClassificationError("VERSION_CONFLICT");
        if (before.entity.source !== "USER")
          throw new ProductClassificationError("EVENT_SOURCE_READ_ONLY");
        if (
          input.endedAt < before.entity.startedAt ||
          Date.parse(input.endedAt) > Date.parse(appliedAt)
        )
          throw new ProductClassificationError("EVENT_DATE_INVALID");
        if (before.entity.status === "CLOSED") {
          if (before.entity.endedAt !== input.endedAt)
            throw new ProductClassificationError("EVENT_ALREADY_CLOSED");
          return {
            ...common,
            tool: request.tool,
            before: before.entity,
            after: before.entity,
            commandId: null,
            syncState: before.syncState,
            message:
              "L’observation est déjà clôturée à cette date. Aucun changement supplémentaire.",
          };
        }
        const commandId = this.generateId(),
          after = await repo.close(ctx.storeId, input.eventId, input.endedAt, {
            commandId,
            deviceId: ctx.deviceId,
            capturedAt: appliedAt,
          });
        return {
          ...common,
          tool: request.tool,
          before: before.entity,
          after,
          commandId,
          syncState: "PENDING",
          message:
            "Clôture enregistrée localement. La synchronisation et l’analyse des résultats restent distinctes.",
        };
      },
      signal,
    );
  }
}
