import {
  executionSaveRequestSchema,
  executionSaveAuthoritySchema,
  executionSaveResultSchema,
  commercialExecutionTaskSchema,
  executionActualsUpdate,
  commercialExecutionActualsNotFuture,
  ProductClassificationError,
  type ExecutionSaveAuthority,
} from "@fl-copilot/domain";
import {
  commercialExecutionChecklist,
  commercialExecutionSameTarget,
} from "@fl-copilot/commercial-core";
import { CommercialExecutionRepository } from "../commercial/execution-repository";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
/** Records a reviewed user declaration; it does not carry out physical work. */
export class CopilotCommercialExecutionRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (text: string) => Promise<string>,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ExecutionSaveAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = executionSaveRequestSchema.safeParse(raw),
      authority = executionSaveAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canDeclareCommercialExecution, ...scope } = authority.data;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canDeclareCommercialExecution },
      executionSaveResultSchema,
      async (tx, ctx) => {
        const db = joinedProductToolDatabase(tx),
          input = request.input,
          plan = await new CommercialPlanRepository(db, this.digest).get(
            ctx.storeId,
            input.weekStart,
          );
        if (!plan)
          throw new ProductClassificationError(
            "COMMERCIAL_EXECUTION_UNAVAILABLE",
          );
        if (["ERROR", "CONFLICT"].includes(plan.syncState))
          throw new ProductClassificationError("SYNC_CONFLICT");
        if (plan.entity.version !== input.planVersion)
          throw new ProductClassificationError("VERSION_CONFLICT");
        const proposal = (
          await commercialExecutionChecklist(plan.entity, this.digest)
        ).find((p) => p.id === input.taskId);
        if (!proposal)
          throw new ProductClassificationError(
            "COMMERCIAL_EXECUTION_UNAVAILABLE",
          );
        const repo = new CommercialExecutionRepository(db, this.digest),
          before = await repo.get(ctx.storeId, proposal.id);
        if (before && ["ERROR", "CONFLICT"].includes(before.syncState))
          throw new ProductClassificationError("SYNC_CONFLICT");
        if ((before?.entity.version ?? null) !== input.expectedVersion)
          throw new ProductClassificationError("VERSION_CONFLICT");
        if (before && !commercialExecutionSameTarget(before.entity, proposal))
          throw new ProductClassificationError(
            "COMMERCIAL_EXECUTION_UNAVAILABLE",
          );
        const appliedAt = this.now();
        if (!commercialExecutionActualsNotFuture(input.actuals, appliedAt))
          throw new ProductClassificationError("INVALID_INPUT");
        const common = {
          operationId: request.operationId,
          schemaVersion: 1 as const,
          tool: request.tool,
          status: "COMPLETED" as const,
          userMessageId: ctx.userMessageId,
          appliedAt,
          before: before?.entity ?? null,
        };
        if (
          before &&
          before.entity.status === input.status &&
          before.entity.note === input.note &&
          JSON.stringify(before.entity.actuals ?? null) ===
            JSON.stringify(
              executionActualsUpdate(before.entity, input).actuals ?? null,
            )
        )
          return {
            ...common,
            after: before.entity,
            commandId: null,
            syncState: before.syncState,
            message:
              "Cette déclaration est déjà enregistrée. Aucun changement supplémentaire.",
          };
        const after = commercialExecutionTaskSchema.parse({
            ...proposal,
            ...executionActualsUpdate(before?.entity, input),
            status: input.status,
            note: input.note,
            completedAt:
              input.status === "DONE"
                ? before?.entity.status === "DONE"
                  ? before.entity.completedAt
                  : appliedAt
                : null,
            version: (before?.entity.version ?? 0) + 1,
            createdAt: before?.entity.createdAt ?? appliedAt,
            updatedAt: appliedAt,
          }),
          commandId = this.generateId();
        await repo.save(after, { commandId, deviceId: ctx.deviceId });
        return {
          ...common,
          after,
          commandId,
          syncState: "PENDING" as const,
          message:
            "Déclaration de mise en place enregistrée localement. Le plan, les offres et les chiffres ne sont pas modifiés.",
        };
      },
      signal,
    );
  }
}
