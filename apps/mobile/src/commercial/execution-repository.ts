import {
  commercialExecutionTaskSchema,
  commercialExecutionActualsNotFuture,
  executionActualsUpdate,
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
import {
  readCommercialConflictReview,
  requireCommercialConflictDecision,
  type CommercialConflictResolutionContext,
} from "./conflict-review";
import { commercialExecutionChecklist } from "@fl-copilot/commercial-core";
import { readCommercialExecutionPlan } from "./execution-plan-read";
export { readCommercialExecutionPlan };
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
  review(storeId: string, conflictId: string) {
    return readCommercialConflictReview(
      this.db,
      storeId,
      "COMMERCIAL_EXECUTION",
      conflictId,
      this.digest,
    );
  }
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
    let choice = commercialExecutionTaskSchema.parse(input);
    if (!commercialExecutionActualsNotFuture(choice.actuals, choice.updatedAt))
      throw Error("COMMERCIAL_EXECUTION_ACTUALS_INVALID");
    const id = await commercialExecutionTaskId(
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
      choice = commercialExecutionTaskSchema.parse({
        ...choice,
        ...executionActualsUpdate(previous?.entity, choice),
      });
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
    ctx: CommercialConflictResolutionContext,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("COMMERCIAL_CONFLICT_FORBIDDEN");
      const review = await readCommercialConflictReview(
        tx,
        ctx.storeId,
        "COMMERCIAL_EXECUTION",
        conflictId,
        this.digest,
      );
      requireCommercialConflictDecision(review, useLocal, ctx);
      const local = commercialExecutionTaskSchema.parse(review.current.entity),
        remote = commercialExecutionTaskSchema.parse(review.group.remote);
      await retireCommands(tx, local.storeId, local.id);
      const now = new Date().toISOString();
      if (useLocal) await assertTaskPlan(tx, local, this.digest);
      const resolved = useLocal
        ? commercialExecutionTaskSchema.parse({
            ...local,
            createdAt: remote.createdAt,
            version: remote.version + 1,
            updatedAt: now,
          })
        : remote;
      await tx.runAsync(
        "UPDATE commercial_execution_tasks SET payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=?",
        JSON.stringify(resolved),
        JSON.stringify(remote),
        remote.version,
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
      if (
        !review.group.conflicts.some(
          (c) =>
            JSON.stringify(
              commercialExecutionTaskSchema.parse(c.remotePayload),
            ) === JSON.stringify(remote),
        )
      )
        await tx.runAsync(
          "INSERT INTO commercial_execution_history(action_id,task_id,store_id,payload_json,action,created_at) VALUES(?,?,?,?,?,?)",
          ctx.remoteHistoryId,
          local.id,
          local.storeId,
          JSON.stringify(remote),
          "RESOLUTION_REMOTE_BASELINE",
          now,
        );
      for (const conflict of review.group.conflicts)
        await tx.runAsync(
          "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND store_id=? AND status='OPEN'",
          useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
          now,
          conflict.id,
          local.storeId,
        );
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: local.storeId,
          commandType: "COMMERCIAL_EXECUTION_TASK_UPSERT",
          entityType: "commercial_execution_task",
          entityId: local.id,
          expectedRemoteVersion: remote.version,
          payload: resolved,
          createdAt: now,
        });
      if (!ctx.canResolve() || ctx.signal?.aborted)
        throw Error("COMMERCIAL_CONFLICT_FORBIDDEN");
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
