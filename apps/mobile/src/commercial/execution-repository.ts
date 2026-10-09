import {
  commercialExecutionTaskSchema,
  type CommercialExecutionTask,
} from "@fl-copilot/sync-contracts";
import {
  commercialExecutionTaskId,
  commercialExecutionSameIdentity,
  commercialExecutionSameTarget,
} from "@fl-copilot/commercial-core";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  commercialExecutionChecklist,
  commercialExecutionPlanChecksum,
} from "@fl-copilot/commercial-core";
import {
  commercialPlanRevisionSchema,
  commercialWeekPlanSchema,
} from "@fl-copilot/sync-contracts";
type Row = {
  id: string;
  store_id: string;
  plan_id: string;
  plan_revision_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
  last_error_code?: string | null;
};
export type LocalCommercialExecution = {
  entity: CommercialExecutionTask;
  syncState: string;
  remoteVersion: number | null;
  remote: CommercialExecutionTask | null;
  lastErrorCode: string | null;
};
function mapped(row: Row): LocalCommercialExecution {
  return {
    entity: commercialExecutionTaskSchema.parse(JSON.parse(row.payload_json)),
    syncState: row.sync_state,
    remoteVersion: row.remote_version,
    lastErrorCode: row.last_error_code ?? null,
    remote: row.remote_payload_json
      ? commercialExecutionTaskSchema.parse(JSON.parse(row.remote_payload_json))
      : null,
  };
}
export async function applyCommercialExecution(
  db: OutboxDatabase,
  storeId: string,
  payload: unknown,
  ackVersion?: number,
) {
  const choice = commercialExecutionTaskSchema.parse(payload);
  if (choice.storeId !== storeId)
    throw Error("COMMERCIAL_EXECUTION_STORE_INVALID");
  const previous = await db.getFirstAsync<Row>(
    "SELECT * FROM commercial_execution_tasks WHERE id=?",
    choice.id,
  );
  if (previous && previous.store_id !== storeId)
    throw Error("COMMERCIAL_EXECUTION_STORE_INVALID");
  const local = previous ? mapped(previous) : null;
  if (
    local &&
    !commercialExecutionSameIdentity(
      { ...local.entity, createdAt: choice.createdAt },
      choice,
    )
  )
    throw Error("COMMERCIAL_EXECUTION_IDENTITY_CHANGED");
  if (
    previous?.dirty &&
    (ackVersion === undefined || local!.entity.version !== ackVersion)
  ) {
    if (!local!.remote || choice.version >= local!.remote.version)
      await db.runAsync(
        "UPDATE commercial_execution_tasks SET remote_payload_json=?,remote_version=CASE WHEN ? IS NULL THEN remote_version ELSE MAX(COALESCE(remote_version,0),?) END WHERE id=?",
        JSON.stringify(choice),
        ackVersion ?? null,
        choice.version,
        choice.id,
      );
    return;
  }
  if (local && (local.remoteVersion ?? 0) > choice.version) return;
  await db.runAsync(
    `INSERT INTO commercial_execution_tasks(id,store_id,plan_id,plan_revision_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0`,
    choice.id,
    storeId,
    choice.planId,
    choice.planRevisionId,
    JSON.stringify(choice),
    JSON.stringify(choice),
    choice.version,
  );
}
export class CommercialExecutionRepository {
  constructor(
    private db: AtomicMutationDatabase & OutboxDatabase,
    private digest: (text: string) => Promise<string>,
  ) {}
  async get(storeId: string, id: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT t.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=t.store_id AND o.entity_id=t.id AND o.entity_type='commercial_execution_task' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_execution_tasks t WHERE t.store_id=? AND t.id=?",
      storeId,
      id,
    );
    return row ? mapped(row) : null;
  }
  async list(storeId: string, revisionId: string) {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT t.*,(SELECT last_error_code FROM sync_outbox o WHERE o.store_id=t.store_id AND o.entity_id=t.id AND o.entity_type='commercial_execution_task' ORDER BY local_sequence DESC LIMIT 1) AS last_error_code FROM commercial_execution_tasks t WHERE t.store_id=? AND t.plan_revision_id=?",
      storeId,
      revisionId,
    );
    return rows.map(mapped);
  }
  async save(
    input: CommercialExecutionTask,
    ctx: { commandId: string; deviceId: string },
  ) {
    const choice = commercialExecutionTaskSchema.parse(input),
      id = await commercialExecutionTaskId(
        choice.storeId,
        choice.planRevisionId,
        choice.planChecksum,
        choice.kind,
        choice.targetId,
        this.digest,
      );
    if (id !== choice.id) throw Error("COMMERCIAL_EXECUTION_ID_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM commercial_execution_tasks WHERE id=? AND store_id=?",
          id,
          choice.storeId,
        ),
        previous = row ? mapped(row) : null;
      if (row?.sync_state === "CONFLICT")
        throw Error("COMMERCIAL_EXECUTION_RESOLVE_REQUIRED");
      const expected =
        row?.sync_state === "ERROR"
          ? row.remote_version
          : (previous?.entity.version ?? null);
      if (
        choice.version !== (expected ?? 0) + 1 ||
        (previous && !commercialExecutionSameIdentity(previous.entity, choice))
      )
        throw Error("COMMERCIAL_EXECUTION_REVISION_INVALID");
      await assertTaskPlan(tx, choice, this.digest);
      if (row?.sync_state === "ERROR") {
        const pending = await tx.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='commercial_execution_task' AND entity_id=? AND status='SYNCING'",
          id,
        );
        if (pending?.n) throw Error("COMMERCIAL_EXECUTION_SYNCING");
        await retireCommands(tx, choice.storeId, id);
      }
      await tx.runAsync(
        `INSERT INTO commercial_execution_tasks(id,store_id,plan_id,plan_revision_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1`,
        id,
        choice.storeId,
        choice.planId,
        choice.planRevisionId,
        JSON.stringify(choice),
      );
      await tx.runAsync(
        "INSERT INTO commercial_execution_history(action_id,task_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        id,
        choice.storeId,
        JSON.stringify(choice),
        "SAVE_TASK",
        choice.updatedAt,
      );
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: choice.storeId,
        commandType: "COMMERCIAL_EXECUTION_TASK_UPSERT",
        entityType: "commercial_execution_task",
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
        conflict.entityType !== "commercial_execution_task"
      )
        throw Error("COMMERCIAL_EXECUTION_RESOLUTION_INVALID");
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM commercial_execution_tasks WHERE id=? AND store_id=?",
        conflict.entityId,
        conflict.storeId,
      );
      if (!row) throw Error("COMMERCIAL_EXECUTION_RESOLUTION_INVALID");
      const local = mapped(row).entity,
        parsed = commercialExecutionTaskSchema.safeParse(
          conflict.remotePayload,
        );
      const remote = parsed.success ? parsed.data : null;
      if (
        remote &&
        !commercialExecutionSameIdentity(
          { ...local, createdAt: remote.createdAt },
          remote,
        )
      )
        throw Error("COMMERCIAL_EXECUTION_SOURCE_CHANGED");
      if (!useLocal && !remote)
        throw Error("COMMERCIAL_EXECUTION_REMOTE_MISSING");
      const syncing = await tx.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE store_id=? AND entity_type='commercial_execution_task' AND entity_id=? AND status='SYNCING'",
        local.storeId,
        local.id,
      );
      if (syncing?.n) throw Error("COMMERCIAL_EXECUTION_SYNCING");
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      if (useLocal) await assertTaskPlan(tx, local, this.digest);
      const resolved = useLocal
        ? commercialExecutionTaskSchema.parse({
            ...local,
            createdAt: remote?.createdAt ?? local.createdAt,
            version: (remote?.version ?? 0) + 1,
            updatedAt: now,
          })
        : remote!;
      await tx.runAsync(
        "UPDATE commercial_execution_tasks SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        remote ? JSON.stringify(remote) : null,
        remote?.version ?? null,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        local.id,
      );
      await tx.runAsync(
        "INSERT INTO commercial_execution_history(action_id,task_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
        ctx.commandId,
        local.id,
        local.storeId,
        JSON.stringify(local),
        useLocal ? "RESOLVE_LOCAL" : "RESOLVE_REMOTE",
        now,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='commercial_execution_task' AND entity_id=? AND status='OPEN'",
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
          commandType: "COMMERCIAL_EXECUTION_TASK_UPSERT",
          entityType: "commercial_execution_task",
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
    "UPDATE sync_outbox SET status='FAILED',last_error_code='COMMERCIAL_EXECUTION_SUPERSEDED' WHERE store_id=? AND entity_type='commercial_execution_task' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
    storeId,
    id,
  );
}

export async function readCommercialExecutionPlan(
  db: OutboxDatabase,
  storeId: string,
  planId: string,
  revisionId: string,
  checksum: string,
  digest: (s: string) => Promise<string>,
) {
  const [archive, current, history] = await Promise.all([
    db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_plan_revisions WHERE store_id=? AND id=?",
      storeId,
      revisionId,
    ),
    db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_week_plans WHERE store_id=? AND id=?",
      storeId,
      planId,
    ),
    db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_plan_history WHERE store_id=? AND plan_id=? ORDER BY created_at DESC",
      storeId,
      planId,
    ),
  ]);
  const candidates = [
    ...(archive
      ? [
          commercialPlanRevisionSchema.parse(JSON.parse(archive.payload_json))
            .plan,
        ]
      : []),
    ...[current, ...history]
      .filter(Boolean)
      .map((row) =>
        commercialWeekPlanSchema.parse(JSON.parse(row!.payload_json)),
      ),
  ];
  for (const plan of candidates)
    if (
      plan.id === planId &&
      plan.storeId === storeId &&
      plan.revisionId === revisionId &&
      (await commercialExecutionPlanChecksum(plan, digest)) === checksum
    )
      return plan;
  return null;
}
async function assertTaskPlan(
  db: OutboxDatabase,
  task: CommercialExecutionTask,
  digest: (s: string) => Promise<string>,
) {
  const plan = await readCommercialExecutionPlan(
    db,
    task.storeId,
    task.planId,
    task.planRevisionId,
    task.planChecksum,
    digest,
  );
  if (!plan) throw Error("COMMERCIAL_EXECUTION_PLAN_CHANGED");
  const proposals = await commercialExecutionChecklist(plan, digest);
  if (!proposals.some((p) => commercialExecutionSameTarget(task, p)))
    throw Error("COMMERCIAL_EXECUTION_PLAN_CHANGED");
}
