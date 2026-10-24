import {
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
  sameMembershipIdentity,
  sameSubstitutionIdentity,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";
import { readNeedConflictPolicy } from "./conflict-policy";

export const needConflictKinds = {
  NEED: { table: "need_units", entity: "need_unit", schema: needUnitSchema },
  MEMBERSHIP: {
    table: "need_memberships",
    entity: "need_membership",
    schema: needMembershipSchema,
  },
  SUBSTITUTION: {
    table: "product_substitutions",
    entity: "product_substitution",
    schema: productSubstitutionSchema,
  },
} as const;
export type NeedConflictKind = keyof typeof needConflictKinds;
export type NeedConflictResolutionContext = {
  storeId: string;
  commandId: string;
  remoteHistoryId: string;
  deviceId: string;
  reviewHash: string;
  canResolve: () => boolean;
  signal?: AbortSignal;
  reactivateRejected?: boolean;
};
/** A comparison only. Each canonical repository retains its own writer and
 * payload policy; no association, learning or identity is inferred here. */
export async function readNeedConflictReview(
  db: OutboxDatabase,
  storeId: string,
  kind: NeedConflictKind,
  conflictId: string,
  digest: (s: string) => Promise<string>,
) {
  const config = needConflictKinds[kind],
    requested = await new ConflictRepository(db).getById(conflictId);
  if (
    !requested ||
    requested.storeId !== storeId ||
    requested.entityType !== config.entity ||
    requested.status !== "OPEN"
  )
    throw Error("NEED_CONFLICT_INVALID");
  const row = await db.getFirstAsync<{
    id: string;
    store_id: string;
    payload_json: string;
    remote_payload_json: string | null;
    remote_version: number | null;
    sync_state: string;
    dirty: number;
  }>(
    `SELECT * FROM ${config.table} WHERE id=? AND store_id=?`,
    requested.entityId,
    storeId,
  );
  if (!row) throw Error("NEED_CONFLICT_INVALID");
  const local = config.schema.parse(JSON.parse(row.payload_json));
  if (local.id !== row.id || local.storeId !== storeId)
    throw Error("NEED_CONFLICT_INVALID");
  const cached = row.remote_payload_json
      ? config.schema.safeParse(JSON.parse(row.remote_payload_json))
      : null,
    current = {
      entity: local,
      syncState: row.sync_state,
      remoteVersion: row.remote_version,
      remote: cached?.success ? cached.data : null,
    },
    conflicts = await new ConflictRepository(db).listOpenForEntity(
      storeId,
      config.entity,
      local.id,
    ),
    group = reviewConflictVersions(
      conflicts,
      (raw) => {
        const parsed = config.schema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      },
      (candidate) => {
        if (candidate.id !== local.id || candidate.storeId !== storeId)
          return false;
        if (kind === "NEED")
          return (
            needUnitSchema.parse(candidate).createdBy ===
            needUnitSchema.parse(local).createdBy
          );
        if (kind === "MEMBERSHIP")
          return sameMembershipIdentity(
            needMembershipSchema.parse(local),
            needMembershipSchema.parse(candidate),
          );
        return sameSubstitutionIdentity(
          productSubstitutionSchema.parse(local),
          productSubstitutionSchema.parse(candidate),
        );
      },
      current.remote,
    ),
    remote = group.remote,
    policy = await readNeedConflictPolicy(db, kind, local, remote, digest),
    commands = await db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version FROM sync_outbox WHERE store_id=? AND entity_type=? AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence LIMIT 101",
      storeId,
      config.entity,
      local.id,
    );
  const sameOrigin =
    !!remote &&
    [
      ...conflicts.map((c) => c.remotePayload),
      ...(current.remote ? [current.remote] : []),
    ].every((raw) => {
      const parsed = config.schema.safeParse(raw);
      return (
        parsed.success &&
        parsed.data.createdAt === remote.createdAt &&
        (kind !== "NEED" ||
          needUnitSchema.parse(parsed.data).code ===
            needUnitSchema.parse(remote).code)
      );
    });
  const ready =
    group.valid &&
    !!remote &&
    sameOrigin &&
    policy.identityValid &&
    row.sync_state === "CONFLICT" &&
    (row.remote_version ?? 0) <= remote.version &&
    commands.length <= 100 &&
    !commands.some((c) => c.status === "SYNCING");
  const reason =
    group.reason ??
    (!sameOrigin
      ? "L’origine du besoin ou de l’association diffère. Aucune référence n’est réaffectée automatiquement."
      : !ready
        ? "La comparaison a changé ou un envoi est en cours. Relisez les versions avant de décider."
        : !policy.canKeep
          ? "La version locale ne peut pas être retenue : vérifiez l’identité, les fiches parentes et les règles d’apprentissage. La version synchronisée peut être adoptée."
          : null);
  const hash = await digest(
    JSON.stringify({ kind, row, conflicts, commands, remote, policy }),
  );
  return {
    current,
    group,
    policy,
    hash,
    ready,
    reason,
    canKeepLocal: ready && policy.canKeep,
    canAdoptRemote: ready && policy.canAdopt,
  };
}
export function requireNeedConflictDecision(
  review: Awaited<ReturnType<typeof readNeedConflictReview>>,
  useLocal: boolean,
  ctx: NeedConflictResolutionContext,
) {
  if (!ctx.canResolve() || ctx.signal?.aborted)
    throw Error("NEED_CONFLICT_FORBIDDEN");
  if (
    review.hash !== ctx.reviewHash ||
    !(useLocal ? review.canKeepLocal : review.canAdoptRemote)
  )
    throw Error("NEED_CONFLICT_CHANGED");
  if (
    (useLocal
      ? review.policy.reactivateLocal
      : review.policy.reactivateRemote) &&
    !ctx.reactivateRejected
  )
    throw Error("NEED_CONFLICT_REACTIVATION_REQUIRED");
}
