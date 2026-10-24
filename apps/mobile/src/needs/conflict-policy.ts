import {
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
  sameMembershipIdentity,
  sameSubstitutionIdentity,
  needMembershipId,
  productSubstitutionId,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Local comparison policy only; canonical .resolve remains the sole writer. */
export async function readNeedConflictPolicy(
  db: OutboxDatabase,
  kind: string,
  local: unknown,
  rawRemote: unknown,
  digest: (s: string) => Promise<string>,
) {
  const names = {
    products: {} as Record<string, string>,
    needs: {} as Record<string, string>,
  };
  if (kind === "NEED") {
    const l = needUnitSchema.parse(local),
      r = needUnitSchema.safeParse(rawRemote);
    return {
      identityValid: !r.success || l.createdBy === r.data.createdBy,
      canKeep: r.success && l.code === r.data.code,
      canAdopt: r.success,
      reactivateLocal: false,
      reactivateRemote: false,
      parentSnapshots: [],
      names,
    };
  }
  const membership = kind === "MEMBERSHIP";
  const l = membership
      ? needMembershipSchema.parse(local)
      : productSubstitutionSchema.parse(local),
    parsed = membership
      ? needMembershipSchema.safeParse(rawRemote)
      : productSubstitutionSchema.safeParse(rawRemote),
    r = parsed.success ? parsed.data : null;
  const productIds =
    "productId" in l
      ? [l.productId]
      : [l.sourceProductId, l.substituteProductId];
  const products = await Promise.all(
    productIds.map(async (id) => {
      const row = await db.getFirstAsync<{
        id: string;
        store_id: string;
        label: string;
        status: string;
        deleted_at: string | null;
        version: number;
        sync_state: string;
        dirty: number;
      }>(
        "SELECT id,store_id,label,status,deleted_at,version,sync_state,dirty FROM products WHERE id=? AND store_id=?",
        id,
        l.storeId,
      );
      return row
        ? {
            entity: {
              id: row.id,
              storeId: row.store_id,
              label: row.label,
              status: row.status,
              deletedAt: row.deleted_at,
              version: row.version,
            },
            syncState: row.sync_state,
            dirty: row.dirty,
          }
        : null;
    }),
  );
  const needRow = await db.getFirstAsync<{
    payload_json: string;
    sync_state: string;
    dirty: number;
  }>(
    "SELECT payload_json,sync_state,dirty FROM need_units WHERE id=? AND store_id=?",
    l.needUnitId,
    l.storeId,
  );
  const need = needRow
    ? {
        entity: needUnitSchema.parse(JSON.parse(needRow.payload_json)),
        syncState: needRow.sync_state,
        dirty: needRow.dirty,
      }
    : null;
  for (const p of products)
    if (p?.entity.storeId === l.storeId)
      names.products[p.entity.id] = p.entity.label;
  if (need?.entity.storeId === l.storeId)
    names.needs[need.entity.id] = need.entity.name;
  const identityValid =
    !!r &&
    (membership
      ? sameMembershipIdentity(
          needMembershipSchema.parse(l),
          needMembershipSchema.parse(r),
        ) &&
        l.id ===
          (await needMembershipId(
            l.storeId,
            productIds[0]!,
            l.needUnitId,
            digest,
          ))
      : sameSubstitutionIdentity(
          productSubstitutionSchema.parse(l),
          productSubstitutionSchema.parse(r),
        ) &&
        l.id ===
          (await productSubstitutionId(
            l.storeId,
            productIds[0]!,
            productIds[1]!,
            l.needUnitId,
            digest,
          )));
  const parentsOwned =
      !!need &&
      need.entity.storeId === l.storeId &&
      products.every((p) => p && p.entity.storeId === l.storeId),
    parentsClear =
      !!need &&
      !["ERROR", "CONFLICT"].includes(need.syncState) &&
      products.every((p) => p && !["ERROR", "CONFLICT"].includes(p.syncState)),
    parentsActive =
      !!need &&
      need.entity.status === "ACTIVE" &&
      products.every(
        (p) => p?.entity.status === "ACTIVE" && !p.entity.deletedAt,
      );
  const parentsUsable =
    !!need &&
    need.entity.status !== "INACTIVE" &&
    products.every(
      (p) => p && p.entity.status !== "INACTIVE" && !p.entity.deletedAt,
    );
  const learningTransitionAllowed = !(
    l.status === "LEARNING" && r?.status !== "LEARNING"
  );
  return {
    identityValid,
    canKeep:
      identityValid &&
      parentsOwned &&
      parentsClear &&
      learningTransitionAllowed &&
      (l.status === "REJECTED" ||
        (l.status === "VALIDATED" ? parentsActive : parentsUsable)),
    canAdopt: identityValid,
    reactivateLocal: !!r && r.status === "REJECTED" && l.status !== "REJECTED",
    reactivateRemote: !!r && l.status === "REJECTED" && r.status !== "REJECTED",
    parentSnapshots: [need, ...products],
    names,
  };
}
