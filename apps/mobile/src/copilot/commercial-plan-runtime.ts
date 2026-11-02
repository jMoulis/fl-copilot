import { saveReviewedCommercialPlan } from "../commercial/plan-review";
import {
  planValidateRequestSchema,
  planValidateAuthoritySchema,
  planValidateResultSchema,
  planPreviewResultSchema,
  ProductClassificationError,
  copilotMessageSchema,
  type PlanValidateAuthority,
} from "@fl-copilot/domain";
import {
  buildCommercialWeekPlan,
  commercialPlanIssues,
} from "@fl-copilot/commercial-core";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import { readWeekPlanContext } from "../commercial/week-plan-context";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
/** Validation consumes an owned persisted preview, never a model-authored plan. */
export class CopilotCommercialPlanRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (text: string) => Promise<string>,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: PlanValidateAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = planValidateRequestSchema.safeParse(raw),
      authority = planValidateAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canValidateCommercialPlan, ...scope } = authority.data;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canValidateCommercialPlan },
      planValidateResultSchema,
      async (tx, ctx) => {
        const row = await tx.getFirstAsync<{ result_json: string }>(
          "SELECT result_json FROM copilot_tool_results WHERE operation_id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          request.input.previewOperationId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
        const review = row
          ? planPreviewResultSchema.safeParse(JSON.parse(row.result_json))
          : null;
        if (
          !review?.success ||
          review.data.operationId !== request.input.previewOperationId ||
          review.data.issues.length ||
          !review.data.candidate ||
          review.data.candidate.storeId !== ctx.storeId
        )
          throw new ProductClassificationError(
            "COMMERCIAL_PLAN_REVIEW_REQUIRED",
          );
        const acceptedRow = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          ctx.userMessageId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
        const accepted = acceptedRow
          ? copilotMessageSchema.safeParse(JSON.parse(acceptedRow.payload_json))
          : null;
        if (
          !accepted?.success ||
          Date.parse(accepted.data.createdAt) <
            Date.parse(review.data.observedAt)
        )
          throw new ProductClassificationError(
            "COMMERCIAL_PLAN_REVIEW_REQUIRED",
          );
        const candidate = review.data.candidate,
          repo = new CommercialPlanRepository(
            joinedProductToolDatabase(tx),
            this.digest,
          ),
          before = await repo.get(ctx.storeId, candidate.weekStart);
        if (before && ["CONFLICT", "ERROR"].includes(before.syncState))
          throw new ProductClassificationError("SYNC_CONFLICT");
        if (
          (before?.entity.version ?? null) !== review.data.expectedPlanVersion
        )
          throw new ProductClassificationError("VERSION_CONFLICT");
        const appliedAt = this.now(),
          commandId = this.generateId();
        let after;
        if (review.data.reviewBasis) {
          after = await saveReviewedCommercialPlan(
            joinedProductToolDatabase(tx),
            candidate,
            review.data.reviewBasis,
            {
              commandId,
              deviceId: ctx.deviceId,
              generateId: this.generateId,
              appliedAt,
              canConfirm: () => canValidateCommercialPlan && !signal?.aborted,
            },
            this.digest,
          );
        } else {
          const current = await readWeekPlanContext(tx, candidate.preparation);
          if (commercialPlanIssues(candidate.preparation, current).length)
            throw new ProductClassificationError(
              "COMMERCIAL_PLAN_REVIEW_REQUIRED",
            );
          const rebuilt = await buildCommercialWeekPlan(
            {
              preparation: candidate.preparation,
              version: candidate.version,
              createdAt: candidate.createdAt,
              validatedAt: candidate.validatedAt,
            },
            current,
            this.digest,
          );
          if (JSON.stringify(rebuilt) !== JSON.stringify(candidate))
            throw new ProductClassificationError(
              "COMMERCIAL_PLAN_REVIEW_REQUIRED",
            );
          after = await buildCommercialWeekPlan(
            {
              preparation: candidate.preparation,
              version: candidate.version,
              createdAt: before?.entity.createdAt ?? appliedAt,
              validatedAt: appliedAt,
            },
            current,
            this.digest,
          );
          await repo.save(after, { commandId, deviceId: ctx.deviceId });
        }
        return {
          operationId: request.operationId,
          schemaVersion: 1 as const,
          tool: request.tool,
          status: "COMPLETED" as const,
          userMessageId: ctx.userMessageId,
          appliedAt,
          previewOperationId: request.input.previewOperationId,
          before: before?.entity ?? null,
          after,
          commandId,
          syncState: "PENDING" as const,
          message:
            "Plan commercial validé localement. Son exécution en rayon reste à enregistrer séparément.",
        };
      },
      signal,
    );
  }
}
