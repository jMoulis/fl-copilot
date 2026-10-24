import {
  readVisualActionProposal,
  prepareVisualActionBasis,
  visualActionStatus,
  visualActionRequestSchema,
  visualActionResultSchema,
  visualRecoveryRequestSchema,
  visualRecoveryResultSchema,
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
  assignCapturedVisual,
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
import {
  localVisualSourcePhoto,
  type VisualSourcePhotoPort,
  type PreparedVisualSourcePhoto,
} from "./visual-source-photo";
import { VisualRecoveryRepository } from "../products/visual-recovery-repository";
import { productVisualRecoveryTargets } from "../products/visual-library-state";
import { withVisualFiles } from "../products/visual-file-lock";
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
  sourcePhoto?: NonNullable<
    import("@fl-copilot/domain").VisualActionBasis["sourcePhoto"]
  >,
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
    input.action === "ASSIGN_SOURCE" && sourcePhoto
      ? await localVisualSourcePhoto(tx, scope, sourcePhoto)
      : undefined,
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
async function readRecoveryReview(
  tx: OutboxDatabase,
  scope: Scope,
  artifact: Awaited<ReturnType<typeof storedProposal>>,
  hash: Hash,
  now: () => string,
) {
  const { input, basis } = artifact.content;
  if (input.action !== "REVIEW_RECOVERY")
    throw Error("VISUAL_RECOVERY_KIND_INVALID");
  const db = joinedProductToolDatabase(tx),
    repo = new VisualLibraryRepository(db);
  const product = await loadProductEditorSnapshot(
    new ProductMasterRepository(db),
    input.productId,
  );
  if (product && product.product.entity.storeId !== scope.storeId)
    throw Error("VISUAL_ACTION_SCOPE_INVALID");
  const localBasis = await prepareVisualActionBasis(
    scope.storeId,
    input,
    {
      product,
      currentLink: null,
      currentIdentity: null,
      currentAsset: null,
      selectedIdentity: null,
      selectedAsset: null,
    },
    hash,
  );
  const productChanged =
    !!basis.product &&
    !!localBasis.product &&
    JSON.stringify(basis.product) !== JSON.stringify(localBasis.product);
  const link = await repo.get(
    "product_visual_link",
    scope.storeId,
    await nativeVisualId("product_visual_link", scope.storeId, input.productId),
  );
  const identity = link
    ? await repo.get(
        "visual_identity",
        scope.storeId,
        link.entity.visualIdentityId,
      )
    : null;
  const assets = await Promise.all(
    [
      ...new Set(
        [link?.entity.overrideAssetId, identity?.entity.primaryAssetId].filter(
          (id): id is string => !!id,
        ),
      ),
    ].map((id) => repo.get("visual_asset", scope.storeId, id)),
  );
  if (link) await assertCanonicalVisualId("product_visual_link", link.entity);
  if (identity)
    await assertCanonicalVisualId("visual_identity", identity.entity);
  for (const asset of assets)
    if (asset) await assertCanonicalVisualId("visual_asset", asset.entity);
  const graph = {
    links: new Map(link ? [[input.productId, [link]]] : []),
    identities: new Map(identity ? [[identity.entity.id, identity]] : []),
    assets: new Map(
      assets.flatMap((asset) =>
        asset ? [[asset.entity.id, asset] as const] : [],
      ),
    ),
  };
  const targets = await Promise.all(
    productVisualRecoveryTargets(graph, input.productId).map(
      async (target) => ({
        ...target,
        review: await new VisualRecoveryRepository(db, hash, now).review(
          scope.storeId,
          target.kind,
          target.id,
          scope.ownerId,
        ),
      }),
    ),
  );
  const basisHash = await hash(
    JSON.stringify({
      localBasis,
      productChanged,
      graph: [link, identity, ...assets],
      targets: targets.map((t) => [t.kind, t.id, t.review.hash]),
    }),
  );
  return { product, productChanged, targets, basisHash };
}

export class CopilotVisualActionController {
  private sourcePhotos = new Map<
    string,
    { basisHash: string; prepared: PreparedVisualSourcePhoto }
  >();
  constructor(
    private db: Database,
    private scope: Scope,
    private hash: Hash,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
    private sourcePhotoPort?: VisualSourcePhotoPort,
  ) {}
  async open(raw: CopilotMessage) {
    const parsed = readVisualActionProposal(raw);
    if (parsed.content.input.action === "REVIEW_RECOVERY")
      throw Error("VISUAL_RECOVERY_REVIEW_REQUIRED");
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
        result.action !== content.input.action ||
        (content.input.action === "ASSIGN_SOURCE" &&
          (result.sourceDocumentId !== content.input.sourceDocumentId ||
            result.sourceChecksum !== content.basis.sourcePhoto?.checksum ||
            result.assetContentHash !== content.basis.sourcePhoto?.checksum ||
            result.assetId !==
              (await nativeVisualId(
                "visual_asset",
                this.scope.storeId,
                result.assetContentHash!,
              ))))
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
    const review = await readLocal(
      tx,
      this.scope,
      content.input,
      this.hash,
      content.basis.sourcePhoto ?? undefined,
    );
    const status =
      JSON.stringify(review.basis) !== JSON.stringify(content.basis)
        ? ("STALE" as const)
        : !review.available
          ? ("BLOCKED" as const)
          : ("READY" as const);
    return { ...artifact, status, result: null, request: null, review };
  }
  async openRecovery(raw: CopilotMessage) {
    const parsed = readVisualActionProposal(raw);
    let state:
      | Awaited<ReturnType<CopilotVisualActionController["readRecovery"]>>
      | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const artifact = await storedProposal(tx, this.scope, parsed.message.id);
      if (JSON.stringify(artifact.message) !== JSON.stringify(parsed.message))
        throw Error("VISUAL_ACTION_PROPOSAL_CHANGED");
      state = await this.readRecovery(tx, artifact);
    });
    return state!;
  }
  private async readRecovery(
    tx: OutboxDatabase,
    artifact: Awaited<ReturnType<typeof storedProposal>>,
  ) {
    const { message, content } = artifact;
    if (content.input.action !== "REVIEW_RECOVERY")
      throw Error("VISUAL_RECOVERY_KIND_INVALID");
    const old = await tx.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (old) {
      const result = visualRecoveryResultSchema.parse(
          JSON.parse(old.result_json),
        ),
        request = visualRecoveryRequestSchema.parse(
          JSON.parse(old.request_json),
        );
      if (
        old.store_id !== this.scope.storeId ||
        old.owner_id !== this.scope.ownerId ||
        old.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        result.productId !== content.input.productId ||
        Object.keys(request).some(
          (key) =>
            result[key as keyof typeof request] !==
            request[key as keyof typeof request],
        )
      )
        throw Error("VISUAL_ACTION_SCOPE_INVALID");
      return {
        ...artifact,
        status: "COMPLETED" as const,
        result,
        request,
        review: null,
      };
    }
    const review = await readRecoveryReview(
      tx,
      this.scope,
      artifact,
      this.hash,
      this.now,
    );
    return {
      ...artifact,
      status: review.productChanged
        ? ("STALE" as const)
        : !review.targets.length
          ? ("UNCHANGED" as const)
          : ("READY" as const),
      review,
      result: null,
      request: null,
    };
  }
  async confirmRecovery(
    message: CopilotMessage,
    input: Omit<
      ReturnType<typeof visualRecoveryRequestSchema.parse>,
      "operationId"
    >,
    signal?: AbortSignal,
    canContinue: () => boolean = () => true,
  ) {
    const check = () => {
      if (
        !this.scope.canManageVisualLibrary ||
        signal?.aborted ||
        !canContinue()
      )
        throw Error("VISUAL_ACTION_FORBIDDEN");
    };
    check();
    const request = visualRecoveryRequestSchema.parse({
      operationId: message.id,
      ...input,
    });
    const state = await this.openRecovery(message);
    check();
    if (state.status === "COMPLETED") {
      if (JSON.stringify(request) !== JSON.stringify(state.request))
        throw Error("VISUAL_ACTION_DECISION_CHANGED");
      return state;
    }
    if (
      state.status !== "READY" ||
      state.review?.basisHash !== request.basisHash
    )
      throw Error("VISUAL_ACTION_STALE");
    const { canManageVisualLibrary, ...scope } = this.scope;
    let result: ReturnType<typeof visualRecoveryResultSchema.parse> | undefined;
    await this.db.withExclusiveTransactionAsync(async (outer) => {
      check();
      const artifact = await storedProposal(outer, this.scope, message.id);
      if (JSON.stringify(artifact.message) !== JSON.stringify(message))
        throw Error("VISUAL_ACTION_PROPOSAL_CHANGED");
      result = await runReviewedStoreOperation(
        joinedProductToolDatabase(outer),
        request,
        {
          ...scope,
          canExecute: canManageVisualLibrary,
          conversationId: message.conversationId,
          userMessageId: message.replyToMessageId!,
          authorizedRequestJson: JSON.stringify(request),
          decisionLevel: "REVIEWED",
        },
        visualRecoveryResultSchema,
        async (tx, ctx) => {
          check();
          const review = await readRecoveryReview(
            tx,
            this.scope,
            artifact,
            this.hash,
            this.now,
          );
          if (review.productChanged || review.basisHash !== request.basisHash)
            throw Error("VISUAL_ACTION_STALE");
          const target = review.targets.find(
            (t) => t.kind === request.kind && t.id === request.entityId,
          );
          if (!target) throw Error("VISUAL_ACTION_SCOPE_INVALID");
          const db = joinedProductToolDatabase(tx),
            at = this.now();
          await new VisualRecoveryRepository(db, this.hash, () => at).recover(
            ctx.storeId,
            target.kind,
            target.id,
            request.recoveryAction,
            {
              actorId: ctx.ownerId,
              deviceId: ctx.deviceId,
              commandId: this.id(),
              reviewHash: target.review.hash,
              reactivate: request.reactivate,
              rightsConfirmed: request.rightsConfirmed,
              canWrite: () => {
                check();
                return true;
              },
              signal,
            },
          );
          const after = await new VisualLibraryRepository(db).get(
            target.kind,
            ctx.storeId,
            target.id,
          );
          check();
          if (!after || !["PENDING", "SYNCED"].includes(after.syncState))
            throw Error("VISUAL_RECOVERY_RESULT_INVALID");
          return visualRecoveryResultSchema.parse({
            ...request,
            action: "REVIEW_RECOVERY",
            productId: artifact.content.input.productId,
            userMessageId: ctx.userMessageId,
            appliedAt: at,
            version: after.entity.version,
            syncState: after.syncState,
            retryFileAssetId:
              target.kind === "visual_asset" &&
              ["RETRY_LOCAL", "ADOPT_REMOTE"].includes(
                request.recoveryAction,
              ) &&
              !after.entity.deletedAt &&
              "review" in after.entity &&
              after.entity.review.status === "APPROVED"
                ? after.entity.id
                : null,
          });
        },
        signal,
      );
      check();
    });
    return {
      ...state,
      status: "COMPLETED" as const,
      result: result!,
      request,
      review: null,
    };
  }
  async prepareSourcePhoto(
    message: CopilotMessage,
    signal?: AbortSignal,
    canContinue: () => boolean = () => true,
  ) {
    const check = () => {
      if (
        signal?.aborted ||
        !canContinue() ||
        !this.scope.canManageVisualLibrary
      )
        throw Error("VISUAL_ACTION_STALE");
    };
    check();
    const state = await this.open(message);
    if (
      state.status !== "READY" ||
      state.content.input.action !== "ASSIGN_SOURCE" ||
      !state.review?.basis.sourcePhoto ||
      !this.sourcePhotoPort
    )
      throw Error("VISUAL_ACTION_SOURCE_UNAVAILABLE");
    return withVisualFiles(this.scope.storeId, async () => {
      check();
      const prepared = await this.sourcePhotoPort!.prepare(
        state.review!.basis.sourcePhoto!,
        check,
      );
      const current = await this.open(message);
      check();
      if (
        current.status !== "READY" ||
        current.review?.basisHash !== state.review!.basisHash
      )
        throw Error("VISUAL_ACTION_STALE");
      this.sourcePhotos.set(message.id, {
        basisHash: current.review.basisHash,
        prepared,
      });
      return prepared;
    });
  }
  async confirm(
    message: CopilotMessage,
    basisHash: string,
    consent: {
      photoReviewed: boolean;
      confirmGlobalRevoke: boolean;
      restoreAssociation: boolean;
      rightsConfirmed?: boolean;
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
    const sourceSelection =
      state.content.input.action === "ASSIGN_SOURCE"
        ? this.sourcePhotos.get(message.id)
        : null;
    const execute = async () => {
      if (state.content.input.action === "ASSIGN_SOURCE") {
        if (
          !sourceSelection ||
          sourceSelection.basisHash !== basisHash ||
          !state.review?.basis.sourcePhoto ||
          !this.sourcePhotoPort
        )
          throw Error("VISUAL_SOURCE_ORIGINAL_REQUIRED");
        await this.sourcePhotoPort.verify(
          state.review.basis.sourcePhoto,
          sourceSelection.prepared,
          () => {
            if (signal?.aborted || !canContinue())
              throw Error("VISUAL_ACTION_STALE");
          },
        );
      }
      let result: ReturnType<typeof visualActionResultSchema.parse> | undefined;
      await this.db.withExclusiveTransactionAsync(async (outer) => {
        const artifact = await storedProposal(outer, this.scope, message.id);
        result = await runReviewedStoreOperation(
          joinedProductToolDatabase(outer),
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
            if (
              artifact.message.conversationId !== ctx.conversationId ||
              artifact.message.replyToMessageId !== ctx.userMessageId
            )
              throw Error("VISUAL_ACTION_SCOPE_INVALID");
            const { input } = artifact.content;
            if (input.action === "REVIEW_RECOVERY")
              throw Error("VISUAL_RECOVERY_REVIEW_REQUIRED");
            const review = await readLocal(
              tx,
              this.scope,
              input,
              this.hash,
              artifact.content.basis.sourcePhoto ?? undefined,
            );
            if (
              !canContinue() ||
              signal?.aborted ||
              !review.available ||
              review.basisHash !== request.basisHash ||
              JSON.stringify(review.basis) !==
                JSON.stringify(artifact.content.basis)
            )
              throw Error("VISUAL_ACTION_STALE");
            if (
              ["ASSIGN_LIBRARY", "ASSIGN_SOURCE"].includes(input.action) &&
              !request.photoReviewed
            )
              throw Error("VISUAL_PHOTO_REVIEW_REQUIRED");
            if (
              input.action === "REVOKE_CURRENT" &&
              !request.confirmGlobalRevoke
            )
              throw Error("VISUAL_GLOBAL_REVOKE_REQUIRED");
            if (
              ["ASSIGN_LIBRARY", "ASSIGN_SOURCE"].includes(input.action) &&
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
            let sourceAsset:
              Awaited<ReturnType<typeof assignCapturedVisual>> | undefined;
            if (input.action === "ASSIGN_SOURCE") {
              if (
                !request.rightsConfirmed ||
                !sourceSelection ||
                !review.product ||
                !review.basis.sourcePhoto
              )
                throw Error("VISUAL_RIGHTS_REQUIRED");
              sourceAsset = await assignCapturedVisual(
                db,
                { product: review.product, link: review.currentLink },
                sourceSelection.prepared.source,
                true,
                visualContext,
              );
            } else if (input.action === "ASSIGN_LIBRARY") {
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
              ...(sourceAsset
                ? {
                    sourceDocumentId: input.sourceDocumentId,
                    sourceChecksum: review.basis.sourcePhoto!.checksum,
                    assetId: sourceAsset.id,
                    assetContentHash: sourceAsset.contentHash,
                  }
                : {}),
              action: input.action,
              productId: input.productId,
              entityId,
              version: saved.entity.version,
              syncState:
                saved.syncState === "SYNCED"
                  ? ("SYNCED" as const)
                  : ("PENDING" as const),
            };
          },
          signal,
        );
        if (!canContinue() || signal?.aborted)
          throw Error("VISUAL_ACTION_STALE");
      });
      return {
        ...state,
        status: "COMPLETED" as const,
        result: result!,
        request,
      };
    };
    return state.content.input.action === "ASSIGN_SOURCE"
      ? withVisualFiles(this.scope.storeId, execute)
      : execute();
  }
}
