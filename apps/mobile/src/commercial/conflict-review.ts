import {
  commercialOfferChoiceSchema,
  commercialWeekPreparationSchema,
  commercialWeekPlanSchema,
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import {
  commercialChoiceSameSource,
  commercialPreparationSameIdentity,
  commercialPlanSameIdentity,
  commercialVersionDecisionSameOriginalPair,
  commercialExecutionSameIdentity,
} from "@fl-copilot/commercial-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";
import { readCommercialConflictPolicy } from "./conflict-policy";
import { readCommercialDecisionConflictPolicy } from "./decision-conflict-policy";
export const commercialConflictKinds = {
  COMMERCIAL_CHOICE: {
    table: "commercial_offer_choices",
    entity: "commercial_offer_choice",
    schema: commercialOfferChoiceSchema,
  },
  COMMERCIAL_PREPARATION: {
    table: "commercial_week_preparations",
    entity: "commercial_week_preparation",
    schema: commercialWeekPreparationSchema,
  },
  COMMERCIAL_PLAN: {
    table: "commercial_week_plans",
    entity: "commercial_week_plan",
    schema: commercialWeekPlanSchema,
  },
  COMMERCIAL_REFERENCE: {
    table: "commercial_version_decisions",
    entity: "commercial_version_decision",
    schema: commercialVersionDecisionSchema,
  },
  COMMERCIAL_EXECUTION: {
    table: "commercial_execution_tasks",
    entity: "commercial_execution_task",
    schema: commercialExecutionTaskSchema,
  },
} as const;
export type CommercialConflictKind = keyof typeof commercialConflictKinds;
export function isReviewedCommercialConflictKind(
  kind: string,
): kind is CommercialConflictKind {
  return Object.hasOwn(commercialConflictKinds, kind);
}
export type CommercialConflictResolutionContext = {
  storeId: string;
  commandId: string;
  remoteHistoryId: string;
  deviceId: string;
  reviewHash: string;
  canResolve: () => boolean;
  signal?: AbortSignal;
  retainWithdrawn?: boolean;
};
/** Complete comparison only: existing domain writers retain source/preference,
 * derivation and execution policies. No commercial decision is synthesized. */
export async function readCommercialConflictReview(
  db: OutboxDatabase,
  storeId: string,
  kind: CommercialConflictKind,
  conflictId: string,
  digest: (s: string) => Promise<string>,
) {
  const config = commercialConflictKinds[kind],
    requested = await new ConflictRepository(db).getById(conflictId);
  if (
    !requested ||
    requested.storeId !== storeId ||
    requested.entityType !== config.entity ||
    requested.status !== "OPEN"
  )
    throw Error("COMMERCIAL_CONFLICT_INVALID");
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
  if (!row) throw Error("COMMERCIAL_CONFLICT_INVALID");
  const local = config.schema.parse(JSON.parse(row.payload_json));
  if (local.id !== row.id || local.storeId !== storeId)
    throw Error("COMMERCIAL_CONFLICT_INVALID");
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
        const p = config.schema.safeParse(raw);
        return p.success ? p.data : null;
      },
      (candidate) => {
        if (candidate.id !== local.id || candidate.storeId !== storeId)
          return false;
        if (kind === "COMMERCIAL_CHOICE") {
          const l = commercialOfferChoiceSchema.parse(local),
            r = commercialOfferChoiceSchema.parse(candidate);
          return commercialChoiceSameSource(
            { ...l, createdAt: r.createdAt },
            r,
          );
        }
        if (kind === "COMMERCIAL_PREPARATION") {
          const l = commercialWeekPreparationSchema.parse(local),
            r = commercialWeekPreparationSchema.parse(candidate);
          return commercialPreparationSameIdentity(
            { ...l, createdAt: r.createdAt },
            r,
          );
        }
        if (kind === "COMMERCIAL_PLAN") {
          const l = commercialWeekPlanSchema.parse(local),
            r = commercialWeekPlanSchema.parse(candidate);
          return commercialPlanSameIdentity(
            { ...l, createdAt: r.createdAt },
            r,
          );
        }
        if (kind === "COMMERCIAL_REFERENCE")
          return commercialVersionDecisionSameOriginalPair(
            commercialVersionDecisionSchema.parse(local),
            commercialVersionDecisionSchema.parse(candidate),
          );
        const l = commercialExecutionTaskSchema.parse(local),
          r = commercialExecutionTaskSchema.parse(candidate);
        return commercialExecutionSameIdentity(
          { ...l, createdAt: r.createdAt },
          r,
        );
      },
      current.remote,
    ),
    remote = group.remote,
    decisionPolicy =
      kind === "COMMERCIAL_REFERENCE" || kind === "COMMERCIAL_EXECUTION"
        ? await readCommercialDecisionConflictPolicy(
            db,
            kind,
            local,
            remote,
            digest,
          )
        : null,
    workflowPolicy = decisionPolicy
      ? null
      : await readCommercialConflictPolicy(db, kind, local, remote, digest),
    policy = decisionPolicy
      ? {
          ...decisionPolicy,
          retainLocal: false,
          retainRemote: false,
          products: {} as Record<string, string>,
          choices: {} as Record<string, string>,
        }
      : { ...workflowPolicy!, documents: {} as Record<string, string> },
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
      const p = config.schema.safeParse(raw);
      return p.success && p.data.createdAt === remote.createdAt;
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
      ? "L’origine des versions diffère. Aucune offre, source ou déclaration n’est réaffectée automatiquement."
      : !ready
        ? "La comparaison a changé ou un envoi est en cours. Relisez les versions avant de décider."
        : !policy.canKeep
          ? (policy.reason ??
            "Les sources ou dépendances actuelles ne permettent pas de retenir la version locale. Vous pouvez adopter la version synchronisée vérifiée.")
          : null);
  const hash = await digest(
    JSON.stringify({ kind, row, conflicts, commands, remote, policy }),
  );
  return {
    current,
    group,
    policy,
    workflowPolicy,
    decisionPolicy,
    hash,
    ready,
    reason,
    canKeepLocal: ready && policy.canKeep,
    canAdoptRemote: ready && policy.canAdopt,
  };
}
export function requireCommercialConflictDecision(
  review: Awaited<ReturnType<typeof readCommercialConflictReview>>,
  local: boolean,
  ctx: CommercialConflictResolutionContext,
) {
  if (!ctx.canResolve() || ctx.signal?.aborted)
    throw Error("COMMERCIAL_CONFLICT_FORBIDDEN");
  if (
    review.hash !== ctx.reviewHash ||
    !(local ? review.canKeepLocal : review.canAdoptRemote)
  )
    throw Error("COMMERCIAL_CONFLICT_CHANGED");
  if (
    (local ? review.policy.retainLocal : review.policy.retainRemote) &&
    !ctx.retainWithdrawn
  )
    throw Error("COMMERCIAL_CONFLICT_RETENTION_REQUIRED");
}
