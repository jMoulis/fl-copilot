import {
  personalTaskSchema,
  personalTaskFieldsSchema,
  samePersonalTask,
  type PersonalTask,
  type PersonalTaskFields,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { ConflictRepository } from "../sync/conflict-repository";
export type PersonalScope = { storeId: string; ownerId: string };
type Row = {
  id: string;
  store_id: string;
  owner_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
};
export type LocalPersonalTask = { entity: PersonalTask; syncState: string };
function scoped(e: PersonalScope, s: PersonalScope) {
  if (e.storeId !== s.storeId || e.ownerId !== s.ownerId)
    throw Error("PERSONAL_TASK_SCOPE_INVALID");
}
const mapped = (r: Row): LocalPersonalTask => {
  const entity = personalTaskSchema.parse(JSON.parse(r.payload_json));
  if (
    entity.id !== r.id ||
    entity.storeId !== r.store_id ||
    entity.ownerId !== r.owner_id
  )
    throw Error("PERSONAL_TASK_IDENTITY_INVALID");
  return { entity, syncState: r.sync_state };
};

async function remember(db: OutboxDatabase, t: PersonalTask, actionId: string) {
  await db.runAsync(
    "INSERT OR IGNORE INTO personal_task_history(action_id,task_id,store_id,owner_id,payload_json,created_at) VALUES(?,?,?,?,?,?)",
    actionId,
    t.id,
    t.storeId,
    t.ownerId,
    JSON.stringify(t),
    t.updatedAt,
  );
}
export async function applyPersonalTaskRecord(
  db: OutboxDatabase,
  scope: PersonalScope,
  raw: unknown,
  ackVersion?: number,
) {
  const t = personalTaskSchema.parse(raw);
  scoped(t, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM personal_tasks WHERE id=?",
    t.id,
  );
  if (old) {
    scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
    if (!samePersonalTask(mapped(old).entity, t))
      throw Error("PERSONAL_TASK_IDENTITY_INVALID");
  }
  await remember(db, t, `remote:${t.id}:${t.version}`);
  if (old && (old.remote_version ?? 0) > t.version) return;
  if (
    old?.dirty &&
    (ackVersion === undefined || mapped(old).entity.version !== ackVersion)
  ) {
    await db.runAsync(
      "UPDATE personal_tasks SET remote_payload_json=?,remote_version=? WHERE id=?",
      JSON.stringify(t),
      t.version,
      t.id,
    );
    return;
  }
  await db.runAsync(
    "INSERT INTO personal_tasks(id,store_id,owner_id,planned_date,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET planned_date=excluded.planned_date,payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    t.id,
    t.storeId,
    t.ownerId,
    t.date,
    JSON.stringify(t),
    JSON.stringify(t),
    t.version,
  );
}
async function taskReview(
  db: OutboxDatabase,
  scope: PersonalScope,
  id: string,
) {
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM personal_tasks WHERE id=? AND store_id=? AND owner_id=?",
    id,
    scope.storeId,
    scope.ownerId,
  );
  if (!row) throw Error("PERSONAL_TASK_MISSING");
  const local = mapped(row).entity;
  scoped(local, scope);
  const conflicts = await new ConflictRepository(db).listOpenForEntity(
    scope.storeId,
    "personal_task",
    id,
  );
  const commands = await db.getAllAsync<{
    command_id: string;
    payload_json: string;
    status: string;
  }>(
    "SELECT command_id,payload_json,status FROM sync_outbox WHERE store_id=? AND entity_type='personal_task' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') AND COALESCE(last_error_code,'')!='PERSONAL_TASK_SUPERSEDED' ORDER BY local_sequence LIMIT 101",
    scope.storeId,
    id,
  );
  const candidates: PersonalTask[] = [];
  if (row.remote_payload_json)
    candidates.push(
      personalTaskSchema.parse(JSON.parse(row.remote_payload_json)),
    );
  for (const c of conflicts) {
    const l = personalTaskSchema.parse(c.localPayload);
    if (!samePersonalTask(local, l))
      throw Error("PERSONAL_TASK_IDENTITY_INVALID");
    if (c.remotePayload) {
      const r = personalTaskSchema.parse(c.remotePayload);
      if (r.version !== c.remoteVersion)
        throw Error("PERSONAL_TASK_REVIEW_CHANGED");
      candidates.push(r);
    }
  }
  for (const c of commands)
    if (
      !samePersonalTask(
        local,
        personalTaskSchema.parse(JSON.parse(c.payload_json)),
      )
    )
      throw Error("PERSONAL_TASK_IDENTITY_INVALID");
  if (candidates.some((r) => !samePersonalTask(local, r)))
    throw Error("PERSONAL_TASK_IDENTITY_INVALID");
  candidates.sort((a, b) => b.version - a.version);
  const remote = candidates[0] ?? null;
  const ready =
    !!remote &&
    ["CONFLICT", "ERROR"].includes(row.sync_state) &&
    commands.length <= 100 &&
    conflicts.length <= 100 &&
    !commands.some((c) => c.status === "SYNCING") &&
    candidates.every(
      (c) =>
        c.version !== remote.version ||
        JSON.stringify(c) === JSON.stringify(remote),
    );
  return {
    local,
    remote,
    ready,
    token: JSON.stringify({ row, commands, conflicts }),
  };
}
export class PersonalTaskRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: PersonalScope,
  ) {}
  async get(id: string) {
    const r = await this.db.getFirstAsync<Row>(
      "SELECT * FROM personal_tasks WHERE id=? AND store_id=? AND owner_id=?",
      id,
      this.scope.storeId,
      this.scope.ownerId,
    );
    if (!r) return null;
    const t = mapped(r);
    scoped(t.entity, this.scope);
    return t;
  }
  async list(date: string, today: string) {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT * FROM personal_tasks WHERE store_id=? AND owner_id=? AND (planned_date=? OR (?=? AND planned_date<? AND json_extract(payload_json,'$.status')='TODO')) ORDER BY planned_date,id",
      this.scope.storeId,
      this.scope.ownerId,
      date,
      date,
      today,
      date,
    );
    return rows.map((r) => {
      const t = mapped(r);
      scoped(t.entity, this.scope);
      return t;
    });
  }
  async save(
    id: string,
    fields: PersonalTaskFields,
    expectedVersion: number | null,
    ctx: {
      deviceId: string;
      commandId: string;
      now: string;
      canWrite: () => boolean;
      reminder?: boolean;
    },
  ) {
    const data = personalTaskFieldsSchema.parse(fields);
    let saved: PersonalTask | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canWrite()) throw Error("PERSONAL_TASK_SCOPE_INVALID");
      const row = await tx.getFirstAsync<Row>(
          "SELECT * FROM personal_tasks WHERE id=?",
          id,
        ),
        old = row ? mapped(row).entity : null;
      if (row)
        scoped({ storeId: row.store_id, ownerId: row.owner_id }, this.scope);
      if (old) scoped(old, this.scope);
      if (
        (old?.version ?? null) !== expectedVersion ||
        (row && ["CONFLICT", "ERROR"].includes(row.sync_state))
      )
        throw Error("PERSONAL_TASK_REVIEW_REQUIRED");
      const task = personalTaskSchema.parse({
        ...data,
        id,
        ...this.scope,
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? ctx.now,
        updatedAt: ctx.now,
        completedAt:
          data.status === "DONE"
            ? old?.status === "DONE"
              ? old.completedAt
              : ctx.now
            : null,
        cancelledAt:
          data.status === "CANCELLED"
            ? old?.status === "CANCELLED"
              ? old.cancelledAt
              : ctx.now
            : null,
      });
      await tx.runAsync(
        "INSERT INTO personal_tasks(id,store_id,owner_id,planned_date,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET planned_date=excluded.planned_date,payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        id,
        task.storeId,
        task.ownerId,
        task.date,
        JSON.stringify(task),
      );
      await remember(tx, task, ctx.commandId);
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId: task.storeId,
        commandType: "PERSONAL_TASK_UPSERT",
        entityType: "personal_task",
        entityId: id,
        expectedRemoteVersion: old?.version ?? null,
        payload: task,
        createdAt: ctx.now,
      });
      if (ctx.reminder !== undefined)
        await tx.runAsync(
          "INSERT INTO personal_task_reminders(task_id,store_id,owner_id,enabled,status) VALUES(?,?,?,?,'OFF') ON CONFLICT(task_id) DO UPDATE SET enabled=excluded.enabled,status=CASE WHEN excluded.enabled=0 THEN 'OFF' ELSE status END",
          id,
          task.storeId,
          task.ownerId,
          ctx.reminder ? 1 : 0,
        );
      if (task.status !== "TODO" || !task.time)
        await tx.runAsync(
          "UPDATE personal_task_reminders SET enabled=0,status='OFF' WHERE task_id=? AND store_id=? AND owner_id=?",
          id,
          task.storeId,
          task.ownerId,
        );
      if (!ctx.canWrite()) throw Error("PERSONAL_TASK_SCOPE_INVALID");
      saved = task;
    });
    return saved!;
  }
  review(id: string) {
    return taskReview(this.db, this.scope, id);
  }
  async resolve(
    id: string,
    useLocal: boolean,
    token: string,
    ctx: {
      deviceId: string;
      commandId: string;
      now: string;
      canWrite: () => boolean;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!ctx.canWrite()) throw Error("PERSONAL_TASK_SCOPE_INVALID");
      const r = await taskReview(tx, this.scope, id);
      if (!r.ready || !r.remote || r.token !== token)
        throw Error("PERSONAL_TASK_REVIEW_CHANGED");
      const task = useLocal
        ? personalTaskSchema.parse({
            ...r.local,
            version: r.remote.version + 1,
            updatedAt: ctx.now,
          })
        : r.remote;
      await tx.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='PERSONAL_TASK_SUPERSEDED' WHERE store_id=? AND entity_type='personal_task' AND entity_id=? AND status IN ('PENDING','CONFLICT','FAILED')",
        this.scope.storeId,
        id,
      );
      await tx.runAsync(
        "UPDATE sync_conflicts SET status=?,resolved_at=? WHERE store_id=? AND entity_type='personal_task' AND entity_id=? AND status='OPEN'",
        useLocal ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE",
        ctx.now,
        this.scope.storeId,
        id,
      );
      await tx.runAsync(
        "UPDATE personal_tasks SET planned_date=?,payload_json=?,remote_payload_json=?,remote_version=?,sync_state=?,dirty=? WHERE id=? AND store_id=? AND owner_id=?",
        task.date,
        JSON.stringify(task),
        JSON.stringify(r.remote),
        r.remote.version,
        useLocal ? "PENDING" : "SYNCED",
        useLocal ? 1 : 0,
        id,
        this.scope.storeId,
        this.scope.ownerId,
      );
      await remember(tx, task, ctx.commandId);
      if (useLocal)
        await new OutboxRepository(tx).enqueue({
          commandId: ctx.commandId,
          deviceId: ctx.deviceId,
          storeId: task.storeId,
          commandType: "PERSONAL_TASK_UPSERT",
          entityType: "personal_task",
          entityId: id,
          expectedRemoteVersion: r.remote.version,
          payload: task,
          createdAt: ctx.now,
        });
      // A conflict decision never silently re-enables a reminder.
      await tx.runAsync(
        "UPDATE personal_task_reminders SET enabled=0,status='OFF' WHERE task_id=? AND store_id=? AND owner_id=?",
        id,
        this.scope.storeId,
        this.scope.ownerId,
      );
      if (!ctx.canWrite()) throw Error("PERSONAL_TASK_SCOPE_INVALID");
    });
  }
}
