import { z } from "zod";
import {
  rebaseVisualChoice,
  visualReactivationRequired,
  type VisualEntityType,
  type VisualEntityMap,
} from "@fl-copilot/domain";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import {
  notifyOutboxChanged,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import {
  VisualLibraryRepository,
  applyVisualEntity,
  visualTables,
} from "./visual-library-repository";
import { readVisualParents } from "./visual-conflict-repository";
import { assertCanonicalVisualId } from "./visual-id";

type Database = OutboxDatabase & AtomicMutationDatabase;
type Entity = VisualEntityMap[VisualEntityType];
export type VisualRecoveryAction =
  "RETRY_LOCAL" | "REMOVE_LINK" | "RETIRE_LOCAL" | "ADOPT_REMOTE";
const SUPERSEDED = "VISUAL_LIBRARY_SUPERSEDED";
function proposal(
  kind: VisualEntityType,
  local: Entity,
  remote: Entity | null,
  actor: string,
  at: string,
  remove = false,
) {
  const choice =
    remove && "productId" in local
      ? {
          ...local,
          deletedAt: at,
          verification: "NEEDS_REVIEW" as const,
          verifiedBy: null,
          verifiedAt: null,
        }
      : remove
        ? {
            ...local,
            deletedAt: at,
            ...("review" in local
              ? { review: { status: "REVOKED" as const, actorId: actor, at } }
              : {}),
          }
        : local;
  return rebaseVisualChoice(kind, choice, remote, actor, at);
}
/** A rejected command is terminal. A reviewed retry gets a new command, never a fake ACK. */
export class VisualRecoveryRepository {
  constructor(
    private db: Database,
    private digest: (s: string) => Promise<string>,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async review(
    storeId: string,
    kind: VisualEntityType,
    id: string,
    actorId: string,
  ) {
    z.uuid().parse(actorId);
    const current = await new VisualLibraryRepository(this.db).get(
      kind,
      storeId,
      id,
    );
    if (!current || current.syncState !== "ERROR" || !current.dirty)
      throw Error("VISUAL_RECOVERY_UNAVAILABLE");
    await assertCanonicalVisualId(kind, current.entity);
    const remote = current.remote;
    if (remote) await assertCanonicalVisualId(kind, remote);
    const commands = await this.db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
      last_error_code: string | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version,last_error_code FROM sync_outbox WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','FAILED','SYNCING','CONFLICT') AND COALESCE(last_error_code,'')<>? ORDER BY local_sequence LIMIT 101",
      storeId,
      kind,
      id,
      SUPERSEDED,
    );
    const open = await this.db.getFirstAsync<{ id: string }>(
      "SELECT id FROM sync_conflicts WHERE store_id=? AND entity_type=? AND entity_id=? AND status='OPEN' LIMIT 1",
      storeId,
      kind,
      id,
    );
    const parents = await readVisualParents(this.db, current.entity, actorId);
    const blocked =
      !!open ||
      commands.length === 0 ||
      commands.length > 100 ||
      current.entity.updatedBy !== actorId ||
      !commands.some((c) => c.status === "FAILED") ||
      commands.some(
        (c) =>
          c.status === "SYNCING" ||
          c.status === "CONFLICT" ||
          (JSON.parse(c.payload_json) as Entity).updatedBy !== actorId,
      ) ||
      (!remote && current.remoteVersion !== null) ||
      (remote && remote.version < (current.remoteVersion ?? 0));
    let valid = true,
      removable = false;
    try {
      proposal(kind, current.entity, remote, actorId, this.now());
    } catch {
      valid = false;
    }
    if (kind === "product_visual_link" || !remote) {
      try {
        proposal(kind, current.entity, remote, actorId, this.now(), true);
        removable = true;
      } catch {
        /* No implicit creator/identity change. */
      }
    }
    return {
      kind,
      current,
      remote,
      commands,
      hash: await this.digest(
        JSON.stringify({
          actorId,
          kind,
          current,
          commands,
          open,
          parents: parents.snapshots,
        }),
      ),
      canRetry: !blocked && valid && parents.clear,
      canRemove: !blocked && removable && kind === "product_visual_link",
      canRetire:
        !blocked && removable && kind !== "product_visual_link" && !remote,
      canAdopt: !blocked && !!remote,
      retryReactivates:
        !!remote && visualReactivationRequired(remote, current.entity),
      adoptReactivates:
        !!remote && visualReactivationRequired(current.entity, remote),
      labels: parents.labels,
      preview: parents.preview,
      reason: blocked
        ? "Un envoi, un conflit ou une modification d’un autre compte doit d’abord être traité."
        : !parents.clear
          ? "Un produit ou un visuel lié a été retiré ou doit être corrigé. Vous pouvez abandonner cette association sans effacer la photo."
          : !valid
            ? "La provenance ou l’identité du choix ne peut pas être reprise telle quelle."
            : "La nouvelle tentative sera contrôlée par le serveur. Une version distante inconnue sera présentée comme conflit, jamais remplacée automatiquement.",
    };
  }
  async recover(
    storeId: string,
    kind: VisualEntityType,
    id: string,
    action: VisualRecoveryAction,
    ctx: {
      actorId: string;
      deviceId: string;
      commandId: string;
      reviewHash: string;
      reactivate?: boolean;
      rightsConfirmed?: boolean;
      canWrite(): boolean;
      signal?: AbortSignal;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const allowed = () => {
        if (!ctx.canWrite() || ctx.signal?.aborted)
          throw Error("VISUAL_ACCESS_INVALID");
      };
      allowed();
      z.uuid().parse(ctx.commandId);
      z.uuid().parse(ctx.deviceId);
      const review = await new VisualRecoveryRepository(
        joinedMutationDatabase(tx),
        this.digest,
        this.now,
      ).review(storeId, kind, id, ctx.actorId);
      if (
        review.hash !== ctx.reviewHash ||
        !(action === "RETRY_LOCAL"
          ? review.canRetry
          : action === "REMOVE_LINK"
            ? review.canRemove
            : action === "RETIRE_LOCAL"
              ? review.canRetire
              : action === "ADOPT_REMOTE" && review.canAdopt)
      )
        throw Error("VISUAL_RECOVERY_STALE");
      if (
        (action === "RETRY_LOCAL"
          ? review.retryReactivates
          : action === "ADOPT_REMOTE" && review.adoptReactivates) &&
        !ctx.reactivate
      )
        throw Error("VISUAL_CONFLICT_REACTIVATION_REQUIRED");
      if (
        action === "RETRY_LOCAL" &&
        !review.current.entity.deletedAt &&
        "provenance" in review.current.entity &&
        review.current.entity.provenance.type === "USER_UPLOAD" &&
        !ctx.rightsConfirmed
      )
        throw Error("VISUAL_RIGHTS_REQUIRED");
      const at = this.now(),
        { current, remote } = review;
      const after =
        action === "ADOPT_REMOTE"
          ? remote!
          : proposal(
              kind,
              current.entity,
              remote,
              ctx.actorId,
              at,
              action === "REMOVE_LINK" || action === "RETIRE_LOCAL",
            );
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code=? WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','FAILED') AND COALESCE(last_error_code,'')<>?",
        SUPERSEDED,
        storeId,
        kind,
        id,
        SUPERSEDED,
      );
      if (remote) {
        await tx.runAsync(
          `UPDATE ${visualTables[kind]} SET dirty=0,sync_state='SYNCED' WHERE id=? AND store_id=?`,
          id,
          storeId,
        );
        await applyVisualEntity(tx, storeId, kind, remote);
      } else {
        // Only the uncommitted local revision is reset, inside this transaction. Files and IDs stay put.
        // A null expected remote version is a strict create: a concurrent remote row will cause a conflict.
        await tx.runAsync(
          `DELETE FROM ${visualTables[kind]} WHERE id=? AND store_id=?`,
          id,
          storeId,
        );
      }
      if (action !== "ADOPT_REMOTE") {
        await new VisualLibraryRepository(joinedMutationDatabase(tx)).save(
          kind,
          after,
          {
            storeId,
            actorId: ctx.actorId,
            deviceId: ctx.deviceId,
            commandId: ctx.commandId,
            expectedLocalVersion: remote?.version ?? null,
            canWrite: ctx.canWrite(),
          },
        );
        if (kind === "visual_asset")
          await tx.runAsync(
            "UPDATE visual_assets SET offline_required=? WHERE id=? AND store_id=?",
            current.offlineRequired ? 1 : 0,
            id,
            storeId,
          );
      }
      await tx.runAsync(
        "INSERT INTO visual_conflict_history(action_id,store_id,entity_type,entity_id,local_json,remote_json,resolved_json,decision,actor_id,created_at,commands_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ctx.commandId,
        storeId,
        kind,
        id,
        JSON.stringify(current.entity),
        JSON.stringify(remote),
        JSON.stringify(after),
        action,
        ctx.actorId,
        at,
        JSON.stringify(review.commands),
      );
      if (
        after.deletedAt ||
        ("review" in after && after.review.status !== "APPROVED")
      )
        await tx.runAsync(
          "UPDATE local_jobs SET status='CANCELLED',updated_at=? WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.assetId')=? AND status IN ('PENDING','RETRY','FAILED')",
          at,
          storeId,
          ctx.actorId,
          id,
        );
      allowed();
    });
    notifyOutboxChanged();
  }
}
