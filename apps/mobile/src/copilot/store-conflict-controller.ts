import { isCatalogueConflictKind } from "@fl-copilot/domain";
import { ProductMasterConflictRepository } from "../products/conflict-repository";
import {
  isCommercialConflictKind,
  isCommercialDecisionConflictKind,
  type storeConflictInputSchema,
} from "@fl-copilot/domain";
import type { z } from "zod";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import { CommercialVersionDecisionRepository } from "../commercial/version-decision-repository";
import { CommercialExecutionRepository } from "../commercial/execution-repository";
import { isNeedConflictKind } from "@fl-copilot/domain";
import { NeedUnitRepository } from "../needs/repository";
import { NeedMembershipRepository } from "../needs/membership-repository";
import { ProductSubstitutionRepository } from "../needs/substitution-repository";
import {
  copilotConversationSchema,
  copilotMessageSchema,
  copilotMessageIsDeleted,
  readStoreConflictProposal,
  storeConflictRequestSchema,
  storeConflictResultSchema,
  storeConflictAuthoritySchema,
  storeConflictDecisionSchema,
  type StoreConflictAuthority,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import { StoreContextRepository } from "../store/context-repository";
import {
  joinedProductToolDatabase,
  runReviewedStoreOperation,
} from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
import {
  readStoreConflictCurrent,
  readStoreConflictReview,
} from "./store-conflict-review";
type Scope = {
  canManageProducts?: boolean;
  canManageCommercialChoices?: boolean;
  canPrepareCommercialWeek?: boolean;
  canValidateCommercialPlan?: boolean;
  canManageCommercialReferences?: boolean;
  canDeclareCommercialExecution?: boolean;
} & Pick<
  StoreConflictAuthority,
  | "storeId"
  | "ownerId"
  | "deviceId"
  | "canCaptureStoreEvents"
  | "canManageStoreSettings"
>;
function allowed(
  scope: Scope,
  kind: z.infer<typeof storeConflictInputSchema>["kind"],
) {
  if (isCatalogueConflictKind(kind)) return !!scope.canManageProducts;
  if (kind === "COMMERCIAL_REFERENCE")
    return !!scope.canManageCommercialReferences;
  if (kind === "COMMERCIAL_EXECUTION")
    return !!scope.canDeclareCommercialExecution;
  if (kind === "COMMERCIAL_CHOICE") return !!scope.canManageCommercialChoices;
  if (kind === "COMMERCIAL_PREPARATION")
    return !!scope.canPrepareCommercialWeek;
  if (kind === "COMMERCIAL_PLAN") return !!scope.canValidateCommercialPlan;
  if (isNeedConflictKind(kind)) return !!scope.canManageProducts;
  return kind === "FIELD_EVENT"
    ? scope.canCaptureStoreEvents
    : scope.canManageStoreSettings;
}
async function proof(
  db: OutboxDatabase,
  scope: {
    storeId: string;
    ownerId: string;
    conversationId: string;
    userMessageId: string;
  },
  id: string,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    id,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (!row) throw Error("STORE_CONFLICT_REVIEW_REQUIRED");
  const artifact = readStoreConflictProposal(JSON.parse(row.payload_json));
  await verifyPrivateToolRecord(
    db,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  if (artifact.message.replyToMessageId !== scope.userMessageId)
    throw Error("STORE_CONFLICT_SCOPE");
  const parent = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    scope.userMessageId,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  const topic = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
    scope.conversationId,
    scope.storeId,
    scope.ownerId,
  );
  const user = parent
    ? copilotMessageSchema.parse(JSON.parse(parent.payload_json))
    : null;
  if (
    !user ||
    user.role !== "USER" ||
    !topic ||
    copilotMessageIsDeleted(
      user,
      copilotConversationSchema.parse(JSON.parse(topic.payload_json)),
    )
  )
    throw Error("STORE_CONFLICT_PARENT_INVALID");
  return artifact;
}
export class CopilotStoreConflictRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now = () => new Date().toISOString(),
  ) {}
  async execute(raw: unknown, rawAuthority: unknown, signal?: AbortSignal) {
    const request = storeConflictRequestSchema.parse(raw),
      authority = storeConflictAuthoritySchema.parse(rawAuthority);
    if (!authority.comparisonReviewed || !allowed(authority, request.kind))
      throw Error("STORE_CONFLICT_FORBIDDEN");
    const {
      canCaptureStoreEvents,
      canManageStoreSettings,
      comparisonReviewed,
      canManageProducts,
      canManageCommercialChoices,
      canPrepareCommercialWeek,
      canValidateCommercialPlan,
      canManageCommercialReferences,
      canDeclareCommercialExecution,
      ...scope
    } = authority;
    void canCaptureStoreEvents;
    void canManageStoreSettings;
    void comparisonReviewed;
    void canManageProducts;
    void canManageCommercialChoices;
    void canPrepareCommercialWeek;
    void canValidateCommercialPlan;
    void canManageCommercialReferences;
    void canDeclareCommercialExecution;
    const initial = await proof(this.db, scope, request.operationId);
    if (
      initial.content.input.kind !== request.kind ||
      initial.content.basis.entityId !== request.entityId
    )
      throw Error("STORE_CONFLICT_SCOPE");
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: true },
      storeConflictResultSchema,
      async (tx, ctx) => {
        const { content } = await proof(tx, ctx, request.operationId),
          review = await readStoreConflictReview(tx, content, this.digest);
        if (
          review.status !== "READY" ||
          review.conflict?.id !== request.conflictId ||
          review.basisHash !== request.basisHash ||
          (request.decision === "KEEP_LOCAL"
            ? !review.canKeepLocal
            : !review.canAdoptRemote)
        )
          throw Error("STORE_CONFLICT_STALE");
        const reactivation =
          request.decision === "KEEP_LOCAL"
            ? review.needPolicy?.reactivateLocal ||
              review.cataloguePolicy?.reactivateLocal
            : review.needPolicy?.reactivateRemote ||
              review.cataloguePolicy?.reactivateRemote;
        if (reactivation && request.reactivateRejected !== true)
          throw Error("STORE_CONFLICT_REACTIVATION_REQUIRED");
        const activation =
          request.decision === "KEEP_LOCAL"
            ? review.cataloguePolicy?.activateLocal
            : review.cataloguePolicy?.activateRemote;
        if (activation && !request.activateProduct)
          throw Error("STORE_CONFLICT_ACTIVATION_REQUIRED");
        const retention =
          request.decision === "KEEP_LOCAL"
            ? review.commercialPolicy?.retainLocal
            : review.commercialPolicy?.retainRemote;
        if (retention && request.retainWithdrawn !== true)
          throw Error("STORE_CONFLICT_RETENTION_REQUIRED");
        const joined = joinedProductToolDatabase(tx),
          commandId = this.id(),
          appliedAt = this.now(),
          useLocal = request.decision === "KEEP_LOCAL";
        if (isCatalogueConflictKind(request.kind)) {
          const repository = new ProductMasterConflictRepository(
              joined,
              this.digest,
            ),
            canonical = await repository.review(
              ctx.storeId,
              request.conflictId,
            );
          await repository.resolve(ctx.storeId, request.conflictId, useLocal, {
            commandId,
            deviceId: ctx.deviceId,
            reviewHash: canonical.hash,
            jobId: this.id(),
            reactivateRejected: request.reactivateRejected,
            activateProduct: request.activateProduct,
            acceptRemoteDeletion: request.acceptRemoteDeletion,
            confirmLocalDeletionChoice: request.confirmLocalDeletionChoice,
            canResolve: () => allowed(authority, request.kind),
            signal,
          });
        } else if (request.kind === "COMMERCIAL_REFERENCE")
          await new CommercialVersionDecisionRepository(
            joined,
            this.digest,
          ).resolve(request.conflictId, useLocal, {
            commandId,
            deviceId: ctx.deviceId,
          });
        else if (request.kind === "COMMERCIAL_EXECUTION")
          await new CommercialExecutionRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        else if (request.kind === "COMMERCIAL_CHOICE")
          await new CommercialChoiceRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        else if (request.kind === "COMMERCIAL_PREPARATION")
          await new CommercialPreparationRepository(
            joined,
            this.digest,
          ).resolve(request.conflictId, useLocal, {
            commandId,
            deviceId: ctx.deviceId,
          });
        else if (request.kind === "COMMERCIAL_PLAN")
          await new CommercialPlanRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        else if (request.kind === "FIELD_EVENT")
          await new StoreProductEventRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            {
              commandId,
              deviceId: ctx.deviceId,
              capturedAt: appliedAt,
              storeId: ctx.storeId,
              reviewHash: review.eventReview!.hash,
              remoteHistoryId: this.id(),
              canResolve: () => allowed(authority, request.kind),
              signal,
            },
          );
        else if (request.kind === "SETTINGS")
          await new StoreContextRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            {
              commandId,
              deviceId: ctx.deviceId,
              storeId: ctx.storeId,
              reviewHash: review.settingsReview!.hash,
              remoteHistoryId: this.id(),
              canResolve: () => allowed(authority, request.kind),
              signal,
            },
          );
        else if (request.kind === "NEED")
          await new NeedUnitRepository(joined).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        else if (request.kind === "MEMBERSHIP")
          await new NeedMembershipRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        else
          await new ProductSubstitutionRepository(joined, this.digest).resolve(
            request.conflictId,
            useLocal,
            { commandId, deviceId: ctx.deviceId },
          );
        const after = await readStoreConflictCurrent(tx, content, this.digest);
        if (!after || !["PENDING", "SYNCED"].includes(after.syncState))
          throw Error("STORE_CONFLICT_RESULT_INVALID");
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt,
          commandId,
          beforeVersion: review.current.entity.version,
          afterVersion: after.entity.version,
          syncState: after.syncState as "PENDING" | "SYNCED",
        };
      },
      signal,
    );
  }
}
export class CopilotStoreConflictController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope,
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const artifact = readStoreConflictProposal(raw),
      { message, content } = artifact;
    if (!allowed(this.scope, content.input.kind))
      throw Error("STORE_CONFLICT_FORBIDDEN");
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    await proof(
      this.db,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
      },
      message.id,
    );
    const row = await this.db.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (row) {
      const result = storeConflictResultSchema.parse(
          JSON.parse(row.result_json),
        ),
        request = storeConflictRequestSchema.parse(
          JSON.parse(row.request_json),
        );
      if (
        row.store_id !== message.storeId ||
        row.owner_id !== message.ownerId ||
        row.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        result.entityId !== content.basis.entityId ||
        result.kind !== content.input.kind ||
        JSON.stringify(request) !==
          JSON.stringify(
            storeConflictRequestSchema.parse({
              operationId: result.operationId,
              conflictId: result.conflictId,
              entityId: result.entityId,
              kind: result.kind,
              basisHash: result.basisHash,
              decision: result.decision,
              ...(result.activateProduct !== undefined
                ? { activateProduct: result.activateProduct }
                : {}),
              ...(result.confirmLocalDeletionChoice !== undefined
                ? {
                    confirmLocalDeletionChoice:
                      result.confirmLocalDeletionChoice,
                  }
                : {}),
              ...(result.acceptRemoteDeletion !== undefined
                ? { acceptRemoteDeletion: result.acceptRemoteDeletion }
                : {}),
              ...(result.retainWithdrawn !== undefined
                ? { retainWithdrawn: result.retainWithdrawn }
                : {}),
              ...(result.reactivateRejected !== undefined
                ? { reactivateRejected: result.reactivateRejected }
                : {}),
            }),
          )
      )
        throw Error("STORE_CONFLICT_SCOPE");
      return {
        ...artifact,
        status: "COMPLETED" as const,
        review: null,
        result,
      };
    }
    const review = await readStoreConflictReview(this.db, content, this.digest);
    return { ...artifact, status: review.status, review, result: null };
  }
  async confirm(
    message: CopilotMessage,
    basisHash: string,
    rawDecision: unknown,
    reviewed: boolean,
    signal?: AbortSignal,
    consent: {
      reactivateRejected?: boolean;
      retainWithdrawn?: boolean;
      activateProduct?: boolean;
      acceptRemoteDeletion?: boolean;
      confirmLocalDeletionChoice?: boolean;
    } = {},
  ) {
    const {
      reactivateRejected = false,
      retainWithdrawn = false,
      activateProduct = false,
      acceptRemoteDeletion = false,
      confirmLocalDeletionChoice = false,
    } = consent;
    const decision = storeConflictDecisionSchema.parse(rawDecision),
      state = await this.open(message);
    if (!reviewed) throw Error("STORE_CONFLICT_REVIEW_REQUIRED");
    if (state.status === "COMPLETED") {
      if (state.result.decision !== decision)
        throw Error("STORE_CONFLICT_DECISION_CHANGED");
      return state;
    }
    if (
      state.status !== "READY" ||
      state.review?.basisHash !== basisHash ||
      !state.review.conflict
    )
      throw Error("STORE_CONFLICT_STALE");
    if (
      decision === "ADOPT_REMOTE" &&
      state.review.cataloguePolicy?.remoteDeleted &&
      !acceptRemoteDeletion
    )
      throw Error("STORE_CONFLICT_DELETION_CONFIRMATION_REQUIRED");
    if (
      state.review.cataloguePolicy?.localDeleted &&
      !state.review.cataloguePolicy.remoteDeleted &&
      !confirmLocalDeletionChoice
    )
      throw Error("STORE_CONFLICT_LOCAL_DELETION_CONFIRMATION_REQUIRED");
    const request = storeConflictRequestSchema.parse({
      operationId: message.id,
      conflictId: state.review.conflict.id,
      entityId: state.content.basis.entityId,
      kind: state.content.input.kind,
      basisHash,
      decision,
      ...(state.review.cataloguePolicy?.localDeleted &&
      !state.review.cataloguePolicy.remoteDeleted
        ? { confirmLocalDeletionChoice }
        : {}),
      ...(isCatalogueConflictKind(state.content.input.kind) &&
      state.review.cataloguePolicy?.remoteDeleted
        ? { acceptRemoteDeletion }
        : {}),
      ...(isCommercialConflictKind(state.content.input.kind) &&
      !isCommercialDecisionConflictKind(state.content.input.kind)
        ? { retainWithdrawn }
        : {}),
      ...(state.content.input.kind === "PRODUCT" ? { activateProduct } : {}),
      ...(isNeedConflictKind(state.content.input.kind) ||
      state.content.input.kind === "ALIAS"
        ? { reactivateRejected }
        : {}),
    });
    await new CopilotStoreConflictRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      request,
      {
        ...this.scope,
        canManageProducts: this.scope.canManageProducts ?? false,
        comparisonReviewed: true,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: JSON.stringify(request),
        decisionLevel: "REVIEWED",
      },
      signal,
    );
    return this.open(message);
  }
}
