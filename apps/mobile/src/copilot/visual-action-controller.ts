import {
  readVisualActionProposal,
  prepareVisualActionBasis,
  visualActionStatus,
  visualActionRequestSchema,
  visualActionResultSchema,
  type CopilotMessage,
  type VisualActionInput,
} from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import { loadProductEditorSnapshot } from "../products/product-editor-service";
import {
  VisualLibraryRepository,
  assertVisualRecordWritable,
} from "../products/visual-library-repository";
import { assertCanonicalVisualId, nativeVisualId } from "../products/visual-id";
import {
  assignLibraryVisual,
  removeProductVisual,
  revokeLibraryVisual,
  assertLibraryVisualCandidate,
} from "../products/visual-library-actions";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
type Database = OutboxDatabase & AtomicMutationDatabase;
type Scope = {
  storeId: string;
  ownerId: string;
  deviceId: string;
  canManageVisualLibrary: boolean;
};
type Hash = (value: string) => Promise<string>;
async function readLocal(
  tx: OutboxDatabase,
  scope: Scope,
  input: VisualActionInput,
  hash: Hash,
) {
  const db = joinedProductToolDatabase(tx),
    repo = new VisualLibraryRepository(db);
  const p = await loadProductEditorSnapshot(
      new ProductMasterRepository(db),
      input.productId,
    ),
    product = p?.product.entity.storeId === scope.storeId ? p : null;
  const currentLink = product
    ? await repo.get(
        "product_visual_link",
        scope.storeId,
        await nativeVisualId(
          "product_visual_link",
          scope.storeId,
          input.productId,
        ),
      )
    : null;
  const [currentIdentity, selectedIdentity] = product
    ? await Promise.all([
        currentLink
          ? repo.get(
              "visual_identity",
              scope.storeId,
              currentLink.entity.visualIdentityId,
            )
          : null,
        input.action === "ASSIGN_LIBRARY"
          ? repo.get("visual_identity", scope.storeId, input.visualIdentityId!)
          : null,
      ])
    : [null, null];
  const currentAssetId =
    currentLink?.entity.overrideAssetId ??
    currentIdentity?.entity.primaryAssetId;
  const [currentAsset, selectedAsset] = await Promise.all([
    currentAssetId
      ? repo.get("visual_asset", scope.storeId, currentAssetId)
      : null,
    selectedIdentity?.entity.primaryAssetId
      ? repo.get(
          "visual_asset",
          scope.storeId,
          selectedIdentity.entity.primaryAssetId,
        )
      : null,
  ]);
  const records = {
    currentLink,
    currentIdentity,
    currentAsset,
    selectedIdentity,
    selectedAsset,
  };
  for (const [key, record] of Object.entries(records))
    if (record) {
      if (record.entity.storeId !== scope.storeId)
        throw Error("VISUAL_ACTION_SCOPE_INVALID");
      await assertCanonicalVisualId(
        key === "currentLink"
          ? "product_visual_link"
          : key.endsWith("Identity")
            ? "visual_identity"
            : "visual_asset",
        record.entity,
      );
    }
  const basis = await prepareVisualActionBasis(
    scope.storeId,
    input,
    {
      product,
      currentLink: currentLink?.entity ?? null,
      currentIdentity: currentIdentity?.entity ?? null,
      currentAsset: currentAsset?.entity ?? null,
      selectedIdentity: selectedIdentity?.entity ?? null,
      selectedAsset: selectedAsset?.entity ?? null,
    },
    hash,
  );
  let available = visualActionStatus(input, basis) === "READY";
  try {
    if (input.action === "REVOKE_CURRENT")
      assertVisualRecordWritable(currentAsset, scope.ownerId);
    else {
      assertVisualRecordWritable(currentLink, scope.ownerId);
      if (
        product &&
        [product.product, ...product.identifiers, ...product.aliases].some(
          (r) => r.syncState === "ERROR" || r.syncState === "CONFLICT",
        )
      )
        available = false;
      if (input.action === "ASSIGN_LIBRARY") {
        if (selectedIdentity)
          assertLibraryVisualCandidate(
            selectedIdentity,
            selectedAsset,
            selectedIdentity,
            scope.ownerId,
          );
        else available = false;
      }
    }
  } catch {
    available = false;
  }
  const basisHash = await hash(JSON.stringify({ basis, available }));
  return { basis, basisHash, product, ...records, available };
}
async function storedProposal(tx: OutboxDatabase, scope: Scope, id: string) {
  const row = await tx.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=?",
    id,
    scope.storeId,
    scope.ownerId,
  );
  if (!row) throw Error("VISUAL_ACTION_PROPOSAL_UNAVAILABLE");
  const artifact = readVisualActionProposal(JSON.parse(row.payload_json));
  await verifyPrivateToolRecord(
    tx,
    scope,
    artifact.message,
    artifact.content.assistantMessageId,
  );
  return artifact;
}
export class CopilotVisualActionController {
  constructor(
    private db: Database,
    private scope: Scope,
    private hash: Hash,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async open(raw: CopilotMessage) {
    const parsed = readVisualActionProposal(raw);
    let result:
      Awaited<ReturnType<CopilotVisualActionController["read"]>> | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const saved = await storedProposal(tx, this.scope, parsed.message.id);
      if (JSON.stringify(saved.message) !== JSON.stringify(parsed.message))
        throw Error("VISUAL_ACTION_PROPOSAL_CHANGED");
      result = await this.read(tx, saved);
    });
    return result!;
  }
  private async read(
    tx: OutboxDatabase,
    artifact: ReturnType<typeof readVisualActionProposal>,
  ) {
    const { message, content } = artifact;
    const old = await tx.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      result_json: string;
      request_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (old) {
      const result = visualActionResultSchema.parse(
        JSON.parse(old.result_json),
      );
      if (
        old.store_id !== this.scope.storeId ||
        old.owner_id !== this.scope.ownerId ||
        old.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        result.productId !== content.input.productId ||
        result.action !== content.input.action
      )
        throw Error("VISUAL_ACTION_SCOPE_INVALID");
      const request = visualActionRequestSchema.parse(
        JSON.parse(old.request_json),
      );
      return {
        ...artifact,
        status: "COMPLETED" as const,
        result,
        request,
        review: null,
      };
    }
    const review = await readLocal(tx, this.scope, content.input, this.hash);
    const status =
      JSON.stringify(review.basis) !== JSON.stringify(content.basis)
        ? ("STALE" as const)
        : !review.available
          ? ("BLOCKED" as const)
          : ("READY" as const);
    return { ...artifact, status, result: null, request: null, review };
  }
  async confirm(
    message: CopilotMessage,
    basisHash: string,
    consent: {
      photoReviewed: boolean;
      confirmGlobalRevoke: boolean;
      restoreAssociation: boolean;
    },
    signal?: AbortSignal,
    canContinue: () => boolean = () => true,
  ) {
    if (!this.scope.canManageVisualLibrary || !canContinue())
      throw Error("VISUAL_ACTION_FORBIDDEN");
    const request = visualActionRequestSchema.parse({
      operationId: message.id,
      basisHash,
      ...consent,
    });
    const state = await this.open(message);
    if (state.status === "COMPLETED") {
      if (JSON.stringify(state.request) !== JSON.stringify(request))
        throw Error("VISUAL_ACTION_DECISION_CHANGED");
      return state;
    }
    if (state.status !== "READY" || state.review?.basisHash !== basisHash)
      throw Error("VISUAL_ACTION_STALE");
    const { canManageVisualLibrary, ...scope } = this.scope;
    const result = await runReviewedStoreOperation(
      this.db,
      request,
      {
        ...scope,
        canExecute: canManageVisualLibrary,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: JSON.stringify(request),
        decisionLevel: "REVIEWED",
      },
      visualActionResultSchema,
      async (tx, ctx) => {
        const artifact = await storedProposal(tx, this.scope, message.id);
        if (
          artifact.message.conversationId !== ctx.conversationId ||
          artifact.message.replyToMessageId !== ctx.userMessageId
        )
          throw Error("VISUAL_ACTION_SCOPE_INVALID");
        const { input } = artifact.content,
          review = await readLocal(tx, this.scope, input, this.hash);
        if (
          !canContinue() ||
          signal?.aborted ||
          !review.available ||
          review.basisHash !== request.basisHash ||
          JSON.stringify(review.basis) !==
            JSON.stringify(artifact.content.basis)
        )
          throw Error("VISUAL_ACTION_STALE");
        if (input.action === "ASSIGN_LIBRARY" && !request.photoReviewed)
          throw Error("VISUAL_PHOTO_REVIEW_REQUIRED");
        if (input.action === "REVOKE_CURRENT" && !request.confirmGlobalRevoke)
          throw Error("VISUAL_GLOBAL_REVOKE_REQUIRED");
        if (
          input.action === "ASSIGN_LIBRARY" &&
          review.currentLink?.entity.deletedAt &&
          !request.restoreAssociation
        )
          throw Error("VISUAL_REACTIVATION_REQUIRED");
        const db = joinedProductToolDatabase(tx),
          at = this.now(),
          visualContext = {
            storeId: ctx.storeId,
            actorId: ctx.ownerId,
            deviceId: ctx.deviceId,
            canWrite: () => canContinue() && !signal?.aborted,
            id: this.id,
            now: () => at,
          };
        if (input.action === "ASSIGN_LIBRARY") {
          if (!review.product || !review.selectedIdentity)
            throw Error("VISUAL_ACTION_STALE");
          await assignLibraryVisual(
            db,
            { product: review.product, link: review.currentLink },
            review.selectedIdentity,
            visualContext,
          );
        } else if (input.action === "REMOVE_PRODUCT") {
          if (!review.product) throw Error("VISUAL_ACTION_STALE");
          await removeProductVisual(
            db,
            { product: review.product, link: review.currentLink },
            visualContext,
          );
        } else {
          if (!review.currentAsset) throw Error("VISUAL_ACTION_STALE");
          await revokeLibraryVisual(db, review.currentAsset, visualContext);
        }
        const kind =
            input.action === "REVOKE_CURRENT"
              ? "visual_asset"
              : "product_visual_link",
          entityId =
            input.action === "REVOKE_CURRENT"
              ? review.currentAsset!.entity.id
              : await nativeVisualId(
                  "product_visual_link",
                  ctx.storeId,
                  input.productId,
                ),
          saved = await new VisualLibraryRepository(db).get(
            kind,
            ctx.storeId,
            entityId,
          );
        if (!saved || !canContinue()) throw Error("VISUAL_ACTION_STALE");
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt: at,
          action: input.action,
          productId: input.productId,
          entityId,
          version: saved.entity.version,
          syncState: saved.syncState === "SYNCED" ? "SYNCED" : "PENDING",
        };
      },
      signal,
    );
    return { ...state, status: "COMPLETED" as const, result, request };
  }
}
