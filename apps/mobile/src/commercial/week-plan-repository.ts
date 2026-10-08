import {
  commercialWeekPlanSchema,
  type CommercialWeekPlan,
} from "@fl-copilot/sync-contracts";
import {
  commercialWeekPlanId,
  commercialPlanSameIdentity,
} from "@fl-copilot/commercial-core";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { readWeekPlanContext } from "./week-plan-context";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import { commercialPlanRevisionSchema } from "@fl-copilot/sync-contracts";
type Row = {
  id: string;
  store_id: string;
  week_start: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalCommercialPlan = {
  entity: CommercialWeekPlan;
  syncState: string;
  remoteVersion: number | null;
  remote: CommercialWeekPlan | null;
  lastErrorCode: string | null;
};
function mapped(row: Row): LocalCommercialPlan {
  return {
    entity: commercialWeekPlanSchema.parse(JSON.parse(row.payload_json)),
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    lastErrorCode: row.last_error_code ?? null,
    remote: row.remote_payload_json
      ? commercialWeekPlanSchema.parse(JSON.parse(row.remote_payload_json))
      : null,
  };
}
export async function applyCommercialPlan(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = commercialWeekPlanSchema.parse(payload);
  if (choice.storeId !== storeId) throw Error("COMMERCIAL_PLAN_STORE_INVALID");
  await applyCommercialPlanRevision(db, storeId, {
    id: choice.revisionId,
    storeId,
    plan: choice,
    version: 1,
  });
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM commercial_week_plans WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("COMMERCIAL_PLAN_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (
    local &&
    !commercialPlanSameIdentity(
      { ...local.entity, createdAt: choice.createdAt },
      choice,
    )
  )
    throw Error("COMMERCIAL_PLAN_IDENTITY_CHANGED");
  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    if (!local!.remote || choice.version >= local!.remote.version)
      await db.runAsync(
        "UPDATE commercial_week_plans SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO commercial_week_plans(id,store_id,week_start,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    choice.weekStart,
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
  await materializePlan(db, choice, "SYNCED");
}
export class CommercialPlanRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (text: string) => Promise<string>,
  ) {}
  async get(storeId: string, weekStart: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT p.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=p.store_id AND o.entity_id=p.id AND o.entity_type='commercial_week_plan' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_week_plans p WHERE p.store_id=? AND p.week_start=?",
      storeId,
      weekStart,
    );
    return row ? mapped(row) : null;
  }
  async save(
    input: CommercialWeekPlan,
    ctx: { commandId: string; deviceId: string },
  ) {
    const choice = commercialWeekPlanSchema.parse(input),
      id = await commercialWeekPlanId(
        choice.storeId,
        choice.weekStart,
        this.digest,
      );
    if (id !== choice.id) throw Error("COMMERCIAL_PLAN_ID_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM commercial_week_plans WHERE id=? AND store_id=?",
          id,
          choice.storeId,
        ),
        previous = row ? mapped(row) : null;
      if (row?.sync_state === "CONFLICT")
        throw Error("COMMERCIAL_PLAN_RESOLVE_REQUIRED");
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous && !commercialPlanSameIdentity(previous.entity, choice))
      )
        throw Error("COMMERCIAL_PLAN_REVISION_INVALID");
      const ctxData = await readWeekPlanContext(tx, choice.preparation);
      const rebuilt = await buildCommercialWeekPlan(
        {
          preparation: choice.preparation,
          version: choice.version,
          createdAt: choice.createdAt,
          validatedAt: choice.validatedAt,
        },
        ctxData,
        this.digest,
      );
      if (JSON.stringify(rebuilt) !== JSON.stringify(choice))
        throw Error("COMMERCIAL_PLAN_DATA_CHANGED");
      if (row?.sync_state === "ERROR") {
        const pending = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='commercial_week_plan' AND entity_id=? AND status='SYNCING'",
          id,
        );
        if (pending?.n) throw Error("COMMERCIAL_PLAN_SYNCING");
        await retireCommands(tx, choice.storeId, id);
      }
      await tx.runAsync(
        `INSERT INTO commercial_week_plans(id,store_id,week_start,payload_json,sync_state,dirty) VALUES(?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        id,
        choice.storeId,
        choice.weekStart,
        JSON.stringify(choice),
      );
      await materializePlan(tx, choice, "PENDING");
      await tx.runAsync(
        "INSERT INTO commercial_plan_history(action_id,plan_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        id,
        choice.storeId,
        JSON.stringify(choice),
        "VALIDATE_PLAN",
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "COMMERCIAL_WEEK_PLAN_UPSERT",
        entityType: "commercial_week_plan",
        entityId: id,
        expectedRemoteVersion: expected,
        payload: choice,
        createdAt: choice.updatedAt,
      });
    });
    return choice;
  }
  async resolve(
    conflictId: string,
    useLocal: boolean,
    ctx: { commandId: string; deviceId: string },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const conflict = await new ConflictRepository(tx).getById(conflictId);
      if (
        !conflict ||
        conflict.status !== "OPEN" ||
        conflict.entityType !== "commercial_week_plan"
      )
        throw Error("COMMERCIAL_PLAN_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM commercial_week_plans WHERE id=? AND store_id=?",
        conflict.entityId,
        conflict.storeId,
      );
      if (!row) throw Error("COMMERCIAL_PLAN_RESOLUTION_INVALID");
      const local = mapped(row).entity,
        parsed = commercialWeekPlanSchema.safeParse(conflict.remotePayload);
      const remote = parsed.success ? parsed.data : null;
      if (
        remote &&
        !commercialPlanSameIdentity(
          { ...local, createdAt: remote.createdAt },
          remote,
        )
      )
        throw Error("COMMERCIAL_PLAN_SOURCE_CHANGED");
      if (!useLocal && !remote) throw Error("COMMERCIAL_PLAN_REMOTE_MISSING");
      const syncing = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='commercial_week_plan' AND entity_id=? AND status='SYNCING'",
        local.storeId,
        local.id,
      );
      if (syncing?.n) throw Error("COMMERCIAL_PLAN_SYNCING");
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      const resolved = useLocal
        ? await buildCommercialWeekPlan(
            {
              preparation: local.preparation,
              version: (remote?.version ?? 0) + 1,
              createdAt: remote?.createdAt ?? local.createdAt,
              validatedAt: now,
            },
            await readWeekPlanContext(tx, local.preparation),
            this.digest,
          )
        : remote!;
      await tx.runAsync(
        "UPDATE commercial_week_plans SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        remote ? JSON.stringify(remote) : null,
        remote?.version ?? null,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      if (!useLocal)
        await applyCommercialPlanRevision(tx, local.storeId, {
          id: resolved.revisionId,
          storeId: local.storeId,
          plan: resolved,
          version: 1,
        });
      await materializePlan(tx, resolved, useLocal ? "PENDING" : "SYNCED");
      await tx.runAsync(
        "INSERT INTO commercial_plan_history(action_id,plan_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        local.id,
        local.storeId,
        JSON.stringify(local),
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        now,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='commercial_week_plan' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        now,
        local.storeId,
        local.id,
      );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COMMERCIAL_WEEK_PLAN_UPSERT",
          entityType: "commercial_week_plan",
          entityId: local.id,
          expectedRemoteVersion: remote?.version ?? null,
          payload: resolved,
          createdAt: now,
        });
    });
  }
}
async function retireCommands(tx: OutboxDatabase, storeId: string, id: string) {
  await tx.runAsync(
    "UPDATE sync_outbox SET status='FAILED',last_error_code='COMMERCIAL_PLAN_SUPERSEDED' WHERE store_id=? AND entity_type='commercial_week_plan' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}

async function materializePlan(
  db: OutboxDatabase,
  plan: CommercialWeekPlan,
  state: string,
) {
  for (const table of ["commercial_operations", "offers"])
    await db.runAsync(
      `DELETE FROM ${table} WHERE store_id=? AND plan_id=?`,
      plan.storeId,
      plan.id,
    );
  for (const op of plan.operations)
    await db.runAsync(
      "INSERT INTO commercial_operations(id,store_id,plan_id,payload_json,sync_state) VALUES(?,?,?,?,?)",
      op.id,
      plan.storeId,
      plan.id,
      JSON.stringify(op),
      state,
    );
  for (const offer of plan.offers)
    await db.runAsync(
      "INSERT INTO offers(id,store_id,plan_id,operation_id,payload_json,sync_state) VALUES(?,?,?,?,?,?)",
      offer.id,
      plan.storeId,
      plan.id,
      offer.operationId,
      JSON.stringify(offer),
      state,
    );
}
export async function applyCommercialPlanRevision(
  db: OutboxDatabase,
  storeId: string,
  input: unknown,
) {
  const revision = commercialPlanRevisionSchema.parse(input);
  if (revision.storeId !== storeId)
    throw Error("COMMERCIAL_PLAN_STORE_INVALID");
  const previous = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_plan_revisions WHERE id=?",
    revision.id,
  );
  if (
    previous &&
    JSON.stringify(
      commercialPlanRevisionSchema.parse(JSON.parse(previous.payload_json)),
    ) !== JSON.stringify(revision)
  )
    throw Error("COMMERCIAL_PLAN_REVISION_IMMUTABLE");
  await db.runAsync(
    "INSERT OR IGNORE INTO commercial_plan_revisions(id,store_id,plan_id,plan_version,payload_json) VALUES(?,?,?,?,?)",
    revision.id,
    storeId,
    revision.plan.id,
    revision.plan.version,
    JSON.stringify(revision),
  );
}
export async function readCommercialPlanRevisions(
  db: OutboxDatabase,
  storeId: string,
  planId: string,
) {
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_plan_revisions WHERE store_id=? AND plan_id=? ORDER BY plan_version DESC",
    storeId,
    planId,
  );
  return rows.map((r) =>
    commercialPlanRevisionSchema.parse(JSON.parse(r.payload_json)),
  );
}
