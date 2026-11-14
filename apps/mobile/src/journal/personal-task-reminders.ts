import {
  personalTaskSchema,
  personalTaskInstant,
  personalTaskFingerprint,
  personalTaskNotificationSchema,
  type PersonalTask,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { PersonalScope } from "./personal-task-repository";
export type PersonalReminderState =
  | "OFF"
  | "SCHEDULED"
  | "PERMISSION_DENIED"
  | "NOT_AVAILABLE"
  | "PAST"
  | "FAILED"
  | "LIMIT"
  | "CONFLICT";
export type PersonalReminderAdapter = {
  permission(): Promise<boolean>;
  pending(): Promise<Array<{ identifier: string; data: unknown }>>;
  cancel(id: string): Promise<void>;
  schedule(t: PersonalTask, at: string): Promise<string>;
};
export async function personalReminderSetting(
  db: OutboxDatabase,
  scope: PersonalScope,
  id: string,
) {
  return db.getFirstAsync<{ enabled: number; status: PersonalReminderState }>(
    "SELECT enabled,status FROM personal_task_reminders WHERE task_id=? AND store_id=? AND owner_id=?",
    id,
    scope.storeId,
    scope.ownerId,
  );
}
/** Shared native lifecycle reconciles these device-local preferences, never the task's execution. */
export async function reconcilePersonalTaskReminders(
  db: OutboxDatabase,
  scope: PersonalScope | undefined,
  native: PersonalReminderAdapter | null,
  now: Date,
  current: () => boolean,
) {
  const rows = scope
    ? await db.getAllAsync<{
        payload_json: string;
        sync_state: string;
        enabled: number;
      }>(
        "SELECT t.payload_json,t.sync_state,r.enabled FROM personal_tasks t JOIN personal_task_reminders r ON r.task_id=t.id AND r.store_id=t.store_id AND r.owner_id=t.owner_id WHERE t.store_id=? AND t.owner_id=? AND r.enabled=1 ORDER BY t.planned_date,json_extract(t.payload_json,'$.time'),t.id",
        scope.storeId,
        scope.ownerId,
      )
    : [];
  if (!current()) return;
  let granted = false,
    adapterFailed = false;
  try {
    granted = native ? await native.permission() : false;
  } catch {
    adapterFailed = true;
  }
  const desired = new Map<string, { task: PersonalTask; at: string }>(),
    states = new Map<string, PersonalReminderState>();
  const snapshots = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const t = personalTaskSchema.parse(JSON.parse(row.payload_json));
    snapshots.set(t.id, row);
    if (t.ownerId !== scope?.ownerId || t.storeId !== scope.storeId)
      throw Error("PERSONAL_TASK_SCOPE_INVALID");
    let state: PersonalReminderState = "OFF",
      at: string | undefined;
    if (row.enabled && t.status === "TODO" && t.time) {
      try {
        at = personalTaskInstant(t.date, t.time);
        state =
          at <= now.toISOString()
            ? "PAST"
            : ["CONFLICT", "ERROR"].includes(row.sync_state)
              ? "CONFLICT"
              : !native
                ? "NOT_AVAILABLE"
                : adapterFailed
                  ? "FAILED"
                  : !granted
                    ? "PERMISSION_DENIED"
                    : desired.size >= 24
                      ? "LIMIT"
                      : "SCHEDULED";
      } catch {
        state = "FAILED";
      }
    }
    states.set(t.id, state);
    if (state === "SCHEDULED" && at) desired.set(t.id, { task: t, at });
  }
  if (!current()) return;
  const existing = new Map<string, string>();
  let pending: Awaited<ReturnType<PersonalReminderAdapter["pending"]>> = [];
  try {
    pending = native ? await native.pending() : [];
  } catch {
    adapterFailed = true;
    for (const [id, state] of states)
      if (state === "SCHEDULED") states.set(id, "FAILED");
    desired.clear();
  }
  for (const p of pending) {
    const n = personalTaskNotificationSchema.safeParse(p.data);
    if (!n.success) continue;
    if (!current()) return;
    const wanted = desired.get(n.data.taskId);
    if (
      !wanted ||
      n.data.ownerId !== scope?.ownerId ||
      n.data.storeId !== scope.storeId ||
      n.data.fingerprint !== personalTaskFingerprint(wanted.task) ||
      existing.has(n.data.taskId)
    )
      await native!.cancel(p.identifier);
    else existing.set(n.data.taskId, p.identifier);
  }
  if (scope && current())
    await db.runAsync(
      "UPDATE personal_task_reminders SET notification_id=NULL,fingerprint=NULL WHERE store_id=? AND owner_id=? AND enabled=0 AND notification_id IS NOT NULL",
      scope.storeId,
      scope.ownerId,
    );
  for (const [id, state] of states) {
    if (!current()) return;
    const snapshot = snapshots.get(id)!;
    const currentRow = await db.getFirstAsync<{
      payload_json: string;
      enabled: number;
      sync_state: string;
    }>(
      "SELECT t.payload_json,t.sync_state,r.enabled FROM personal_tasks t JOIN personal_task_reminders r ON r.task_id=t.id WHERE t.id=? AND t.store_id=? AND t.owner_id=? AND r.store_id=? AND r.owner_id=?",
      id,
      scope!.storeId,
      scope!.ownerId,
      scope!.storeId,
      scope!.ownerId,
    );
    if (
      !currentRow ||
      currentRow.payload_json !== snapshot.payload_json ||
      currentRow.enabled !== snapshot.enabled ||
      currentRow.sync_state !== snapshot.sync_state
    )
      continue;
    let result = state,
      identifier = existing.get(id) ?? null;
    const wanted = desired.get(id);
    if (wanted && !identifier && native) {
      try {
        identifier = await native.schedule(wanted.task, wanted.at);
      } catch {
        result = "FAILED";
      }
    }
    if (!current()) {
      if (identifier) await native?.cancel(identifier);
      return;
    }
    const written = await db.runAsync(
      "UPDATE personal_task_reminders SET status=?,notification_id=?,fingerprint=?,enabled=CASE WHEN ?='PAST' THEN 0 ELSE enabled END WHERE task_id=? AND store_id=? AND owner_id=? AND enabled=? AND EXISTS(SELECT 1 FROM personal_tasks t WHERE t.id=task_id AND t.store_id=? AND t.owner_id=? AND t.payload_json=? AND t.sync_state=?)",
      result,
      identifier,
      wanted ? personalTaskFingerprint(wanted.task) : null,
      result,
      id,
      scope!.storeId,
      scope!.ownerId,
      snapshot.enabled,
      scope!.storeId,
      scope!.ownerId,
      snapshot.payload_json,
      snapshot.sync_state,
    );
    if (Number(written.changes) !== 1 && identifier)
      await native?.cancel(identifier);
  }
}
